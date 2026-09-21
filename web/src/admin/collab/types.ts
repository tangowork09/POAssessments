/** What the Collaboration Tests panel receives from the run routes. */

export interface RunListItem {
  id: string;
  name: string;
  organisation: string;
  status: 'draft' | 'open' | 'closed';
  min_segment: number;
  anonymous: number;
  created_at: string;
  closed_at: string | null;
  round_no: number;
  round_label: string | null;
  wave_count: number;
  completed: number;
}

export interface Turnout {
  /** Ways in a facilitator handed out. Zero on a run answered through one
   *  shared link, where there is no honest denominator. */
  invited: number;
  started: number;
  completed: number;
}

export interface Band {
  key: 'healthy' | 'friction' | 'barriers' | 'breaking';
  minTotal: number;
  maxTotal: number;
  name: string;
  reading: string;
}

export interface SectionScore {
  key: string;
  name: string;
  short: string;
  color: string;
  /** Converted mean, 1..5. */
  mean: number;
  /** Spread across respondents; null below two responses. */
  spread: number | null;
}

export interface ItemStat {
  no: number;
  sectionKey: string;
  counts: [number, number, number, number, number];
  mean: number;
  sd: number | null;
  lowShare: number;
  highShare: number;
  split: boolean;
}

export interface Statement {
  no: number;
  text: string;
  direction: 'direct' | 'reverse';
  section: string;
}

export interface Segment {
  name: string;
  n: number;
  sections: SectionScore[] | null;
  perItem: number | null;
  /** Below the run's floor: the figures are withheld, the name is not. */
  suppressed: boolean;
}

export interface Cut {
  key: string;
  label: string;
  segments: Segment[];
}

export interface RunResults {
  run: { id: string; name: string; organisation: string; anonymous: boolean };
  wave: number;
  minSegment: number;
  statements: Statement[];
  group: {
    n: number;
    incomplete: number;
    sections: SectionScore[];
    items: ItemStat[];
    total: number;
    perItem: number;
    band: Band;
    gap: { strongestKey: string; weakestKey: string; value: number };
    attention: number[];
    strengths: number[];
    split: number[];
  };
  cuts: Cut[];
  turnout: Turnout;
}
