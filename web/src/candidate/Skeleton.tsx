/**
 * What a candidate sees for the half-second before their screen arrives.
 *
 * Shaped like the thing it precedes — a card with a title, a couple of lines
 * and a row of five scale buttons — so the layout does not jump when the real
 * content lands. `aria-hidden` with a live region beside it: a screen reader
 * should hear "loading", not a description of grey rectangles.
 */

export function ScreenSkeleton({ scale = true }: { scale?: boolean }) {
  return (
    <div className="stage">
      <div className="sk-card" aria-hidden="true">
        <span className="sk sk-line is-title" />
        <span className="sk sk-line is-mid" />
        <span className="sk sk-line" />
        <span className="sk sk-line is-short" />
        {scale ? (
          <div className="sk-row">
            {[0, 1, 2, 3, 4].map((i) => (
              <span className="sk sk-block" key={i} />
            ))}
          </div>
        ) : null}
      </div>
      <p className="visually-hidden" role="status">
        Loading…
      </p>
    </div>
  );
}

/** The report page: a heading, a paragraph and a stack of bars. */
export function ReportSkeleton() {
  return (
    <div className="stage">
      <div className="sk-card" aria-hidden="true">
        <span className="sk sk-line is-title" />
        <span className="sk sk-line" />
        <span className="sk sk-line is-mid" />
        <div style={{ marginTop: 22 }}>
          {[0, 1, 2, 3].map((i) => (
            <span className="sk sk-line" key={i} style={{ height: 22, marginBottom: 14 }} />
          ))}
        </div>
      </div>
      <p className="visually-hidden" role="status">
        Loading…
      </p>
    </div>
  );
}
