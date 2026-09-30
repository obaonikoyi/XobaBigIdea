import { useEffect, useState } from "react";
import { IDEA_TYPE_LABELS, type Idea } from "@xoba/shared";
import { useIdeas } from "../lib/hooks";
import { pickReviewIdeas } from "../lib/library";
import { displayTitle, markReviewed } from "../lib/ideas";
import { daysAgo, fmtDate } from "../lib/format";
import { getMeta, setMeta } from "../lib/db";
import { syncNow } from "../lib/sync";
import { AudioPlayer } from "../components/AudioPlayer";

interface LastReview {
  at: string;
  choice: "develop" | "later" | "current";
}

const THANKS: Record<LastReview["choice"], string> = {
  develop: "Good choice. That idea is now marked Chosen. The others are still here whenever you want them.",
  later: "Good choice. They are kept for later, safe and findable.",
  current: "Good choice. Finishing what you are on is how things get done. These ideas will wait.",
};

export function Review() {
  const ideas = useIdeas();
  const [picked, setPicked] = useState<Idea[] | null>(null);
  const [done, setDone] = useState<LastReview | null>(null);
  const [last, setLast] = useState<LastReview>();

  useEffect(() => {
    getMeta<LastReview>("review.last").then(setLast);
  }, [done]);

  // Pick once per visit so the list does not reshuffle while you decide.
  useEffect(() => {
    if (ideas && picked === null) setPicked(pickReviewIdeas(ideas));
  }, [ideas, picked]);

  async function finish(choice: LastReview["choice"], developId?: string) {
    const ids = (picked ?? []).map((i) => i.id);
    if (choice === "develop" && developId) {
      await markReviewed([developId], "chosen");
      await markReviewed(ids.filter((i) => i !== developId));
    } else if (choice === "later") await markReviewed(ids, "later");
    else await markReviewed(ids);
    const r = { at: new Date().toISOString(), choice };
    await setMeta("review.last", r);
    setDone(r);
    void syncNow();
  }

  if (!ideas || picked === null) return <p className="muted">Loading…</p>;

  return (
    <div className="review">
      <h2>Weekly review</h2>
      <p className="muted small">{last ? `Last review: ${daysAgo(last.at)}.` : "Your first review."} There are no wrong answers here.</p>

      {done ? (
        <section className="saved" data-testid="review-done">
          <p>{THANKS[done.choice]}</p>
          <button type="button" className="secondary" onClick={() => (setDone(null), setPicked(pickReviewIdeas(ideas)))}>
            Look at three more
          </button>
        </section>
      ) : picked.length === 0 ? (
        <p>Nothing waiting for review. Capture some ideas and come back.</p>
      ) : (
        <>
          <ul className="cards">
            {picked.map((i) => (
              <li key={i.id} className="review-card" data-testid="review-card">
                <a href={`#/idea/${i.id}`} className="card-title">
                  {displayTitle(i)}
                </a>
                <span className="card-meta">
                  {IDEA_TYPE_LABELS[i.type.value]} · {fmtDate(i.createdAt)}
                </span>
                {i.summary.value && <p className="card-summary">{i.summary.value}</p>}
                {i.entries[0]?.text && !i.summary.value && <p className="words">{i.entries[0].text.slice(0, 280)}</p>}
                {i.entries[0]?.audioId && <AudioPlayer audioId={i.entries[0].audioId} ideaId={i.id} />}
                <button type="button" className="secondary" onClick={() => finish("develop", i.id)}>
                  Develop this one
                </button>
              </li>
            ))}
          </ul>
          <div className="review-actions">
            <button type="button" className="secondary wide" onClick={() => finish("later")}>
              Keep them for later
            </button>
            <button type="button" className="secondary wide" onClick={() => finish("current")}>
              Continue my current project
            </button>
          </div>
        </>
      )}
    </div>
  );
}
