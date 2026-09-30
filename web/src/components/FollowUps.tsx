import { useState } from "react";
import type { Idea } from "@xoba/shared";
import { answerFollowUp, leaveFollowUpForLater } from "../lib/ideas";
import { syncNow } from "../lib/sync";
import { MicButton } from "./MicButton";

/** Optional questions from the AI (at most 2). "Leave for later" is always an option. */
export function FollowUps({ idea, includeLater = false }: { idea: Idea; includeLater?: boolean }) {
  const qs = idea.followUps.filter((f) => f.state === "open" || (includeLater && f.state === "later"));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  if (qs.length === 0) return null;
  const anyOpen = qs.some((q) => q.state === "open");

  return (
    <section className="followups" aria-label="Optional questions">
      <h3>A question or two, if you like</h3>
      {qs.map((f) => (
        <div key={f.id} className="followup">
          <p className="question">{f.question}</p>
          <textarea
            rows={2}
            value={answers[f.id] ?? ""}
            onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })}
            placeholder="Your answer (optional)"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="row">
            <button
              type="button"
              disabled={!answers[f.id]?.trim()}
              onClick={async () => {
                await answerFollowUp(idea.id, f.id, { text: answers[f.id] });
                setAnswers({ ...answers, [f.id]: "" });
                void syncNow();
              }}
            >
              Save answer
            </button>
            <MicButton target={{ ideaId: idea.id, followUpId: f.id }} onSaved={() => undefined} label="or say it" what="recording your answer" />
          </div>
        </div>
      ))}
      {anyOpen && (
        <button type="button" className="secondary" onClick={() => leaveFollowUpForLater(idea.id)}>
          Leave for later
        </button>
      )}
    </section>
  );
}
