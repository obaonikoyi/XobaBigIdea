import type { Idea } from "@xoba/shared";
import { requestNewTake } from "../lib/ideas";
import { useSyncState } from "../lib/hooks";
import { syncNow } from "../lib/sync";
import { fmtDateTime } from "../lib/format";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h4>{title}</h4>
      <ul>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </>
  );
}

/** The AI's honest read on an idea. Shown apart from the user's own words and never mixed into them. */
export function AiTake({ idea }: { idea: Idea }) {
  const sync = useSyncState();
  const aiReady = sync.online && !!sync.ai?.enrich.available;
  const take = idea.take;
  const hasContent = !!take && (!!take.whatYouMean || !!take.opinion);
  const stale = !!take && take.basedOnEntries < idea.entries.length;
  const refresh = () => requestNewTake(idea.id).then(() => syncNow());

  return (
    <section className="ai-take" aria-label="AI take">
      <h3>
        AI take <span className="tag ai">AI</span>
      </h3>
      {hasContent ? (
        <>
          <h4>What you mean</h4>
          <p>{take.whatYouMean}</p>
          <List title="What's strong" items={take.strengths} />
          <List title="Risks and gaps" items={take.risks} />
          {take.opinion && (
            <>
              <h4>My opinion</h4>
              <p className="opinion">{take.opinion}</p>
            </>
          )}
          <List title="Next steps" items={take.nextSteps} />
          <p className="muted small">
            Written {fmtDateTime(take.generatedAt)}.{" "}
            {stale ? (aiReady ? "You have added more since; updating it now." : "You have added more since; it updates when AI is available.") : ""}
            {take.failed ? "The last update did not work. " : ""}
          </p>
        </>
      ) : take?.failed ? (
        <p className="muted small">The AI could not write a take for this idea.</p>
      ) : aiReady ? (
        <p className="muted small" data-testid="take-waiting">
          Writing the AI take…
        </p>
      ) : (
        <p className="muted small">The AI take appears here when AI is switched on and you are online. Your idea is saved either way.</p>
      )}
      {aiReady && take && !stale && (
        <button type="button" className="link small" onClick={refresh}>
          {take.failed ? "Try again" : "Get a fresh take"}
        </button>
      )}
    </section>
  );
}
