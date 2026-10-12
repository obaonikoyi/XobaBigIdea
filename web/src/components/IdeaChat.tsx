import { useEffect, useRef, useState } from "react";
import type { Idea } from "@xoba/shared";
import { useSyncState } from "../lib/hooks";
import { awaitingReply, sendChat } from "../lib/chat";
import { ApiError } from "../lib/api";

function errorText(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 402) return "The monthly AI limit is reached. Your message is saved.";
    if (e.status === 401) return "Sign in to talk to the AI. Your message is saved.";
    if (e.aiUnavailable) return "The AI is not available right now. Your message is saved.";
  }
  return "Could not reach the AI. Your message is saved.";
}

/** "Talk it through": a conversation about one idea, saved with the idea. */
export function IdeaChat({ idea }: { idea: Idea }) {
  const sync = useSyncState();
  const aiReady = sync.online && !!sync.ai?.enrich.available;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const messages = idea.chat ?? [];

  useEffect(() => {
    if (sending) endRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [messages.length, sending]);

  const send = async (text: string) => {
    setSending(true);
    setError("");
    if (text) setDraft("");
    try {
      await sendChat(idea.id, text);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="chat" aria-label="Talk it through">
      <h3>
        Talk it through <span className="tag ai">AI</span>
      </h3>
      {messages.length === 0 && <p className="muted small">Ask anything about this idea: is it worth it, who is it for, what to do first, what could go wrong.</p>}
      <ol className="messages">
        {messages.map((m) => (
          <li key={m.id} className={`msg ${m.role}`} data-testid={`chat-${m.role}`}>
            <span className="visually-hidden">{m.role === "me" ? "You:" : "AI:"}</span>
            {m.text}
          </li>
        ))}
        {sending && (
          <li className="msg ai thinking" aria-live="polite">
            Thinking…
          </li>
        )}
      </ol>
      <div ref={endRef} />
      {error && (
        <p className="error small" role="alert">
          {error}{" "}
          {awaitingReply(idea) && aiReady && (
            <button type="button" className="link" onClick={() => send("")}>
              Try again
            </button>
          )}
        </p>
      )}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && !sending) void send(draft);
        }}
      >
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && draft.trim() && !sending) {
              e.preventDefault();
              void send(draft);
            }
          }}
          placeholder={aiReady ? "Ask about this idea" : "The AI is off right now"}
          aria-label="Message to the AI"
          disabled={!aiReady}
        />
        <button type="submit" className="primary" disabled={!aiReady || sending || !draft.trim()}>
          Send
        </button>
      </form>
      {!error && !sending && awaitingReply(idea) && (
        <p className="muted small">
          Your last message is waiting for a reply.{" "}
          {aiReady && (
            <button type="button" className="link" onClick={() => send("")}>
              Get a reply
            </button>
          )}
        </p>
      )}
    </section>
  );
}
