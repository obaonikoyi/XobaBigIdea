import { useEffect, useRef, useState } from "react";
import { IDEA_TYPES, IDEA_TYPE_LABELS, STATUSES, STATUS_LABELS, type Entry, type Idea, type IdeaType, type Priority } from "@xoba/shared";
import { useIdea } from "../lib/hooks";
import { addThought, displayTitle, editTranscript, retryTranscript, setField, setPriority, setStatus, setType } from "../lib/ideas";
import { fmtDateTime, fmtDuration } from "../lib/format";
import { syncNow } from "../lib/sync";
import { AudioPlayer } from "../components/AudioPlayer";
import { MicButton } from "../components/MicButton";
import { FollowUps } from "../components/FollowUps";

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: null, label: "Not set" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

function SourceTag({ source, hasValue }: { source: "ai" | "me"; hasValue: boolean }) {
  if (!hasValue) return null;
  return source === "ai" ? <span className="tag ai">AI suggestion</span> : <span className="tag me">Yours</span>;
}

/** Text field that saves on blur, so typing is never interrupted by re-renders. */
function EditableText({ value, onSave, multiline, label, placeholder }: { value: string; onSave: (v: string) => void; multiline?: boolean; label: string; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const props = {
    value: draft,
    "aria-label": label,
    placeholder,
    onFocus: () => (focused.current = true),
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => {
      focused.current = false;
      if (draft !== value) onSave(draft);
    },
  };
  return multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />;
}

function EntryView({ idea, entry }: { idea: Idea; entry: Entry }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.transcript ?? "");
  const label = entry.kind === "capture" ? "Original capture" : entry.kind === "answer" ? "Answer" : "Added thought";
  return (
    <li className="entry" data-testid="entry">
      <div className="entry-head">
        <strong>{label}</strong> <span className="muted small">{fmtDateTime(entry.createdAt)}</span>
      </div>
      {entry.question && <p className="muted small">Q: {entry.question}</p>}
      {entry.text && <p className="words">{entry.text}</p>}
      {entry.audioId && (
        <>
          <AudioPlayer audioId={entry.audioId} ideaId={idea.id} />
          {entry.audioDurationMs ? <span className="muted small">{fmtDuration(entry.audioDurationMs)}</span> : null}
          <div className="transcript">
            <span className="muted small">
              Transcript (automatic{entry.transcriptEditedByMe ? ", corrected by you" : ""}). The recording is the original.
            </span>
            {editing ? (
              <>
                <textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} autoCorrect="off" spellCheck={false} aria-label="Correct transcript" />
                <div className="row">
                  <button type="button" onClick={async () => (await editTranscript(idea.id, entry.id, draft), setEditing(false), void syncNow())}>
                    Save transcript
                  </button>
                  <button type="button" className="link" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : entry.transcriptStatus === "done" ? (
              <>
                <p className="words transcript-text">{entry.transcript || <em className="muted">(no words heard)</em>}</p>
                <button type="button" className="link small" onClick={() => (setDraft(entry.transcript ?? ""), setEditing(true))}>
                  Correct transcript
                </button>
              </>
            ) : entry.transcriptStatus === "failed" ? (
              <p className="muted small">
                Could not transcribe this one.{" "}
                <button type="button" className="link" onClick={() => retryTranscript(idea.id, entry.id).then(() => syncNow())}>
                  Try again
                </button>{" "}
                or{" "}
                <button type="button" className="link" onClick={() => setEditing(true)}>
                  type it yourself
                </button>
              </p>
            ) : (
              <p className="muted small">Waiting for transcription. It happens when the server and AI are available.</p>
            )}
          </div>
        </>
      )}
    </li>
  );
}

export function IdeaCard({ id }: { id: string }) {
  const idea = useIdea(id);
  const [thought, setThought] = useState("");
  const thoughtRef = useRef(thought);
  thoughtRef.current = thought;

  if (idea === undefined) return <p className="muted">Loading…</p>;
  if (idea === null) return <p>That idea is not on this device. <a href="#/library">Back to library</a></p>;

  return (
    <article className="idea">
      <p className="muted small">
        Captured {fmtDateTime(idea.createdAt)} · <a href="#/library">Library</a>
      </p>

      <section className="card-fields" aria-label="Idea card">
        <label>
          <span className="field-label">
            Title <SourceTag source={idea.title.source} hasValue={!!idea.title.value} />
          </span>
          <EditableText label="Title" value={idea.title.value} placeholder={displayTitle(idea)} onSave={(v) => setField(idea.id, "title", v).then(() => syncNow())} />
        </label>
        <label>
          <span className="field-label">
            Type <SourceTag source={idea.type.source} hasValue={!!idea.ai || idea.type.source === "me"} />
          </span>
          <select aria-label="Type" value={idea.type.value} onChange={(e) => setType(idea.id, e.target.value as IdeaType).then(() => syncNow())}>
            {IDEA_TYPES.map((t) => (
              <option key={t} value={t}>
                {IDEA_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">
            Summary <SourceTag source={idea.summary.source} hasValue={!!idea.summary.value} />
          </span>
          <EditableText label="Summary" multiline value={idea.summary.value} placeholder="A line or two about this idea" onSave={(v) => setField(idea.id, "summary", v).then(() => syncNow())} />
        </label>

        <div className="field-label">Status</div>
        <div className="chips" role="group" aria-label="Status">
          {STATUSES.map((s) => (
            <button key={s} type="button" className={`chip ${idea.status === s ? "on" : ""}`} aria-pressed={idea.status === s} onClick={() => setStatus(idea.id, s).then(() => syncNow())}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="field-label">Priority</div>
        <div className="chips" role="group" aria-label="Priority">
          {PRIORITIES.map((p) => (
            <button key={p.label} type="button" className={`chip ${idea.priority === p.value ? "on" : ""}`} aria-pressed={idea.priority === p.value} onClick={() => setPriority(idea.id, p.value).then(() => syncNow())}>
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <FollowUps idea={idea} includeLater />

      <section className="words-section" aria-label="Your words">
        <h3>Your words</h3>
        <p className="muted small">Exactly as you said or typed them. AI never changes these.</p>
        <ul className="entries">
          {idea.entries.map((e) => (
            <EntryView key={e.id} idea={idea} entry={e} />
          ))}
        </ul>
      </section>

      <section className="add-thought" aria-label="Add a thought">
        <h3>Add a thought</h3>
        <textarea rows={3} value={thought} onChange={(e) => setThought(e.target.value)} placeholder="Something new about this idea" autoCorrect="off" spellCheck={false} aria-label="New thought" />
        <div className="row">
          <button
            type="button"
            disabled={!thought.trim()}
            onClick={async () => {
              await addThought(idea.id, { text: thought });
              setThought("");
              void syncNow();
            }}
          >
            Add thought
          </button>
          <MicButton target={{ ideaId: idea.id }} getText={() => thoughtRef.current} onSaved={() => setThought("")} label="or say it" what="recording a thought" />
        </div>
      </section>
    </article>
  );
}
