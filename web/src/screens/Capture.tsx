import { useRef, useState } from "react";
import { createIdea, displayTitle } from "../lib/ideas";
import { go, useIdea, useIdeas, useSyncState } from "../lib/hooks";
import { fmtDateTime } from "../lib/format";
import { syncNow } from "../lib/sync";
import { MicButton } from "../components/MicButton";
import { FollowUps } from "../components/FollowUps";

export function Capture() {
  const [text, setText] = useState("");
  const textRef = useRef(text);
  textRef.current = text;
  const [savedId, setSavedId] = useState<string>();
  const saved = useIdea(savedId);
  const ideas = useIdeas();
  const sync = useSyncState();

  async function saveText() {
    if (!text.trim()) return;
    const idea = await createIdea({ text });
    setText("");
    setSavedId(idea.id);
    void syncNow();
  }

  const aiWorking = sync.ai?.enrich.available && sync.serverReachable;
  const recent = (ideas ?? []).filter((i) => i.id !== savedId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);

  return (
    <div className="capture">
      <p className="tagline">Speak it. Save it. Come back to it.</p>
      <MicButton
        big
        getText={() => textRef.current}
        onSaved={(id) => {
          setText("");
          setSavedId(id);
        }}
      />
      <label className="visually-hidden" htmlFor="capture-text">
        Type your idea
      </label>
      <textarea
        id="capture-text"
        className="capture-text"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && saveText()}
        placeholder="…or type it here"
        autoCorrect="off"
        autoCapitalize="sentences"
        spellCheck={false}
      />
      <button type="button" className="primary wide" onClick={saveText} disabled={!text.trim()}>
        Save idea
      </button>

      {saved && (
        <section className="saved" aria-live="polite" data-testid="saved-panel">
          <p className="saved-line">
            ✓ Saved on this device · {fmtDateTime(saved.createdAt)}
          </p>
          <p>
            <a href={`#/idea/${saved.id}`}>
              <strong>{displayTitle(saved)}</strong>
            </a>
            {saved.title.source === "ai" && saved.title.value && <span className="tag">AI title</span>}
          </p>
          {!saved.ai && (
            <p className="muted small">
              {aiWorking ? "Making your card…" : "Your card will be tidied up by AI when it is available. Nothing is lost meanwhile."}
            </p>
          )}
          <FollowUps idea={saved} />
          <div className="row">
            <button type="button" className="secondary" onClick={() => go(`/idea/${saved.id}`)}>
              Open card
            </button>
            <button type="button" className="link" onClick={() => setSavedId(undefined)}>
              New idea
            </button>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="recent">
          <h3>Recent</h3>
          <ul className="idea-list">
            {recent.map((i) => (
              <li key={i.id}>
                <a href={`#/idea/${i.id}`}>{displayTitle(i)}</a>
                <span className="muted small"> · {fmtDateTime(i.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
