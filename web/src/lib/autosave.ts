/**
 * Autosave with an offline queue.
 *
 * Every answer is written to localStorage immediately and POSTed straight away.
 * If the POST fails — offline, flaky signal, a sleeping laptop — the answer
 * stays in a pending queue that is flushed on reconnect and on a timer. The
 * server upserts, so replaying the queue in any order converges on the same
 * state; nothing is lost and nothing is double-counted.
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export interface PendingAnswer {
  no: number;
  value: number;
}

interface Snapshot {
  responseId: string;
  answers: Record<number, number>;
  pending: PendingAnswer[];
  page: number;
  updatedAt: number;
}

const KEY_PREFIX = 'ap:session:';
const FLUSH_INTERVAL_MS = 5000;

export class Autosave {
  private answers: Record<number, number> = {};
  private pending = new Map<number, number>();
  private page = 0;
  private state: SaveState = 'idle';
  private flushing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<(state: SaveState, pending: number) => void>();

  constructor(
    private readonly token: string,
    private responseId: string,
  ) {}

  // ------------------------------------------------------------ persistence

  private get key(): string {
    return `${KEY_PREFIX}${this.token}`;
  }

  /** Reads any local snapshot for this link, tolerating corrupt storage. */
  restore(): { answers: Record<number, number>; page: number } | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const snap = JSON.parse(raw) as Snapshot;
      if (snap.responseId && snap.responseId !== this.responseId) return null;
      this.answers = snap.answers ?? {};
      this.page = snap.page ?? 0;
      for (const p of snap.pending ?? []) this.pending.set(p.no, p.value);
      return { answers: this.answers, page: this.page };
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      const snap: Snapshot = {
        responseId: this.responseId,
        answers: this.answers,
        pending: [...this.pending].map(([no, value]) => ({ no, value })),
        page: this.page,
        updatedAt: Date.now(),
      };
      localStorage.setItem(this.key, JSON.stringify(snap));
    } catch {
      // Private browsing or a full quota — the server copy is authoritative,
      // so losing the mirror degrades resume rather than breaking the session.
    }
  }

  clearLocal(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* nothing to do */
    }
  }

  // ------------------------------------------------------------------- api

  setResponseId(id: string): void {
    this.responseId = id;
  }

  /** Seeds server state without marking it as needing a save. */
  hydrate(answers: Record<number, number>, page: number): void {
    this.answers = { ...answers, ...this.answers };
    this.page = Math.max(this.page, page);
    this.persist();
  }

  getAnswers(): Record<number, number> {
    return this.answers;
  }

  getPage(): number {
    return this.page;
  }

  setPage(page: number): void {
    this.page = page;
    this.persist();
  }

  record(no: number, value: number): void {
    this.answers[no] = value;
    this.pending.set(no, value);
    this.persist();
    void this.flush();
  }

  /**
   * Removes whole rows both here and on the server — a cohort respondent
   * saying "we don't really work together" about someone they had started to
   * rate. Not queued like an answer: a clear that silently failed would leave
   * a row the respondent believes is gone, and submit would then stop them on
   * it, so this reports failure to the caller instead.
   */
  async clear(memberNos: number[], itemCount: number): Promise<boolean> {
    if (memberNos.length === 0) return true;
    try {
      const res = await fetch(
        `/api/candidate/answers/${this.token}/clear?response=${encodeURIComponent(this.responseId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ memberNos, resumePage: this.page }),
        },
      );
      if (!res.ok) return false;
    } catch {
      return false;
    }

    for (const memberNo of memberNos) {
      for (let item = 1; item <= itemCount; item++) {
        const no = (memberNo - 1) * itemCount + item;
        delete this.answers[no];
        this.pending.delete(no);
      }
    }
    this.persist();
    this.emit('saved');
    return true;
  }

  onChange(fn: (state: SaveState, pending: number) => void): () => void {
    this.listeners.add(fn);
    fn(this.state, this.pending.size);
    return () => this.listeners.delete(fn);
  }

  private emit(state: SaveState): void {
    this.state = state;
    for (const fn of this.listeners) fn(state, this.pending.size);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('beforeunload', this.onUnload);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('beforeunload', this.onUnload);
  }

  private readonly onOnline = (): void => {
    void this.flush();
  };

  private readonly onUnload = (): void => {
    if (this.pending.size === 0) return;
    // A best-effort last gasp; the queue survives in localStorage regardless.
    try {
      navigator.sendBeacon?.(
        `/api/candidate/answers/${this.token}?response=${encodeURIComponent(this.responseId)}`,
        new Blob([JSON.stringify({ answers: this.snapshotPending(), resumePage: this.page })], {
          type: 'application/json',
        }),
      );
    } catch {
      /* best effort only */
    }
  };

  private snapshotPending(): PendingAnswer[] {
    return [...this.pending].map(([no, value]) => ({ no, value }));
  }

  /** Sends everything queued. Safe to call concurrently; overlaps are ignored. */
  async flush(): Promise<void> {
    if (this.flushing || this.pending.size === 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.emit('offline');
      return;
    }

    this.flushing = true;
    const batch = this.snapshotPending();
    this.emit('saving');

    try {
      const res = await fetch(
        `/api/candidate/answers/${this.token}?response=${encodeURIComponent(this.responseId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ answers: batch, resumePage: this.page }),
        },
      );

      if (res.ok) {
        // Only clear entries whose value we actually sent — an answer changed
        // mid-flight stays queued.
        for (const { no, value } of batch) {
          if (this.pending.get(no) === value) this.pending.delete(no);
        }
        this.persist();
        this.emit('saved');
      } else if (res.status === 409) {
        this.pending.clear();
        this.persist();
        this.emit('saved');
      } else {
        this.emit('error');
      }
    } catch {
      this.emit('offline');
    } finally {
      this.flushing = false;
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
