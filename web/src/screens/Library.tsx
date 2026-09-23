import { useMemo, useState } from "react";
import { IDEA_TYPES, IDEA_TYPE_LABELS, STATUSES, STATUS_LABELS } from "@xoba/shared";
import { useIdeas } from "../lib/hooks";
import { filterIdeas, type LibraryFilter } from "../lib/library";
import { displayTitle } from "../lib/ideas";
import { fmtDate } from "../lib/format";

export function Library() {
  const ideas = useIdeas();
  const [f, setF] = useState<LibraryFilter>({ q: "", type: "all", status: "active" });
  const shown = useMemo(() => filterIdeas(ideas ?? [], f), [ideas, f]);

  return (
    <div>
      <input
        type="search"
        className="search"
        placeholder="Search your ideas and words"
        value={f.q}
        onChange={(e) => setF({ ...f, q: e.target.value })}
        aria-label="Search"
      />
      <div className="chips" role="group" aria-label="Status">
        {(["active", ...STATUSES] as const).map((s) => (
          <button key={s} type="button" className={`chip ${f.status === s ? "on" : ""}`} aria-pressed={f.status === s} onClick={() => setF({ ...f, status: s })}>
            {s === "active" ? "All" : STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Category">
        {(["all", ...IDEA_TYPES] as const).map((t) => (
          <button key={t} type="button" className={`chip small ${f.type === t ? "on" : ""}`} aria-pressed={f.type === t} onClick={() => setF({ ...f, type: t })}>
            {t === "all" ? "Every type" : IDEA_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      {ideas === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">{ideas.length === 0 ? "No ideas yet. Capture one first." : "Nothing matches."}</p>
      ) : (
        <ul className="cards" data-testid="library-list">
          {shown.map((i) => (
            <li key={i.id}>
              <a className="card-link" href={`#/idea/${i.id}`}>
                <span className="card-title">
                  {displayTitle(i)}
                  {i.entries.some((e) => e.audioId) && <span className="tag me">audio</span>}
                </span>
                <span className="card-meta">
                  {IDEA_TYPE_LABELS[i.type.value]} · {STATUS_LABELS[i.status]} · {fmtDate(i.createdAt)}
                  {i.entries.length > 1 && ` · ${i.entries.length} entries`}
                </span>
                {i.summary.value && <span className="card-summary">{i.summary.value}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">{shown.length} shown</p>
    </div>
  );
}
