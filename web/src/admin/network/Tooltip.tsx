/**
 * One tooltip for the whole debrief page.
 *
 * Every mark on the Insights page carries numbers a facilitator will be asked
 * about in the room — "how many is that?", "which function?" — and the answer
 * belongs at the pointer, not in a legend. Rather than six bespoke hover cards
 * this is a single layer with one shape: a title, an optional line under it,
 * and a short list of label/value rows.
 *
 * Two implementation notes that matter:
 *
 *   - It positions itself imperatively. Following the pointer through React
 *     state would re-render a page holding four force-laid SVG maps on every
 *     mousemove; instead the layer owns a DOM ref and writes `transform`
 *     directly, so pointing at a dot costs one style write.
 *   - It is `position: fixed`. The page it sits on scrolls, the cards clip
 *     their overflow, and full screen puts the whole explorer in its own
 *     stacking context — an absolutely positioned tip would be cut off in all
 *     three. Fixed plus the top of the z-scale is the only placement that
 *     survives them.
 */

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';

export interface TipContent {
  title: string;
  /** One quiet line under the title — function, quadrant, kind. */
  sub?: string;
  /** Label/value pairs. Keep it to three; this is a hint, not a panel. */
  rows?: [string, string][];
}

export interface TipApi {
  show: (content: TipContent, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  hide: () => void;
}

/** How long the pointer must rest before the tip appears. */
const OPEN_DELAY = 90;
/** Clearance from the pointer, and from the viewport edge before flipping. */
const OFFSET = 14;
const EDGE = 12;

export function useTooltip(): {
  show: (content: TipContent, e: { clientX: number; clientY: number }) => void;
  move: (e: { clientX: number; clientY: number }) => void;
  hide: () => void;
  layer: React.ReactElement;
} {
  const api = useRef<TipApi | null>(null);
  // Stable across renders, all of it — including the layer element. Callers
  // build their hover handlers from these, and handlers that changed identity
  // every render would defeat the memoisation on every map on the page.
  return useMemo(
    () => ({
      show: (content: TipContent, e: { clientX: number; clientY: number }) =>
        api.current?.show(content, e.clientX, e.clientY),
      move: (e: { clientX: number; clientY: number }) => api.current?.move(e.clientX, e.clientY),
      hide: () => api.current?.hide(),
      layer: <TooltipLayer handle={api} />,
    }),
    [],
  );
}

function TooltipLayer({ handle }: { handle: RefObject<TipApi | null> }) {
  const [content, setContent] = useState<TipContent | null>(null);
  const [open, setOpen] = useState(false);
  const el = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const at = useRef({ x: 0, y: 0 });

  const place = useCallback(() => {
    const node = el.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    const flipX = at.current.x + OFFSET + width > window.innerWidth - EDGE;
    const flipY = at.current.y + OFFSET + height > window.innerHeight - EDGE;
    const x = flipX ? Math.max(EDGE, at.current.x - OFFSET - width) : at.current.x + OFFSET;
    const y = flipY ? Math.max(EDGE, at.current.y - OFFSET - height) : at.current.y + OFFSET;
    node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }, []);

  useImperativeHandle(
    handle,
    () => ({
      show: (next, x, y) => {
        at.current = { x, y };
        setContent(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
      },
      move: (x, y) => {
        at.current = { x, y };
        place();
      },
      hide: () => {
        if (timer.current) clearTimeout(timer.current);
        setOpen(false);
        setContent(null);
      },
    }),
    [place],
  );

  // Position on the render that first paints the content, before it fades in.
  useEffect(() => {
    if (content) place();
  }, [content, open, place]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!content) return null;
  return (
    <div ref={el} className={`ins-tip${open ? ' is-open' : ''}`} role="presentation">
      <b>{content.title}</b>
      {content.sub ? <span className="ins-tip-sub">{content.sub}</span> : null}
      {content.rows && content.rows.length > 0 ? (
        <dl className="ins-tip-rows">
          {content.rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
