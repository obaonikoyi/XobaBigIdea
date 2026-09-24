import { useEffect, useRef, useState } from "react";
import { canRecord, VoiceRecorder, type RecordingTarget } from "../lib/recorder";
import { fmtDuration } from "../lib/format";
import { syncNow } from "../lib/sync";

interface Props {
  target?: RecordingTarget;
  /** Text typed alongside, saved with the recording. */
  getText?: () => string;
  onSaved: (ideaId: string) => void;
  big?: boolean;
  label?: string;
  /** What the button does, for screen readers (e.g. "Record an answer"). */
  what?: string;
}

export function MicButton({ target, getText, onSaved, big, label = "Tap to speak", what = "recording" }: Props) {
  const rec = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(rec.current?.elapsedMs() ?? 0), 250);
    return () => clearInterval(t);
  }, [recording]);

  // Stop cleanly (and save) if the component goes away mid-recording.
  useEffect(() => () => void (rec.current?.active && rec.current.stop(getText?.())), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canRecord()) return <p className="muted small">Voice recording is not supported in this browser. You can still type.</p>;

  async function toggle() {
    setError("");
    if (busy) return;
    setBusy(true);
    try {
      if (!recording) {
        rec.current = new VoiceRecorder();
        await rec.current.start(target, getText?.() ?? "");
        setElapsed(0);
        setRecording(true);
      } else {
        const id = await rec.current!.stop(getText?.());
        setRecording(false);
        onSaved(id);
        void syncNow();
      }
    } catch (e) {
      setRecording(false);
      const name = (e as Error).name;
      setError(name === "NotAllowedError" ? "Microphone permission was denied. Allow it in your browser settings, or type instead." : `Could not record: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    await rec.current?.discard();
    setRecording(false);
  }

  return (
    <div className={`mic ${big ? "mic-big" : ""}`}>
      <button
        type="button"
        className={`mic-button ${recording ? "recording" : ""}`}
        onClick={toggle}
        disabled={busy}
        aria-label={recording ? `Stop and save ${what}` : `Start ${what}`}
        aria-pressed={recording}
      >
        {recording ? (
          <svg className="mic-icon" viewBox="0 0 24 24" aria-hidden>
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          </svg>
        ) : (
          <svg className="mic-icon" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
          </svg>
        )}
      </button>
      <div className="mic-label" aria-live="polite">
        {recording ? (
          <>
            <strong>Recording {fmtDuration(elapsed)}</strong> · tap to save{" "}
            <button type="button" className="link" onClick={cancel}>
              discard
            </button>
          </>
        ) : (
          label
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
