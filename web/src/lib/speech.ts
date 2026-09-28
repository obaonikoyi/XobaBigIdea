// Live words while you speak, using the browser's own speech recognition
// (Google on Chrome/Android, Apple on Safari/iOS). Free, and it runs next to
// the recording: the audio is always kept, whatever happens here.

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}
export type RecognitionCtor = new () => RecognitionLike;

export function recognitionCtor(): RecognitionCtor | undefined {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const liveWordsSupported = () => !!recognitionCtor();

/** Errors that mean "stop trying"; anything else (like a pause in speech) just restarts. */
const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported"]);
const MAX_RESTARTS = 200;

export class LiveTranscriber {
  private rec?: RecognitionLike;
  private committed = ""; // finished text from earlier recognition sessions
  private sessionText = ""; // text from the current session (final + interim)
  private active = false;
  private restarts = 0;
  private ended?: () => void;
  failed?: string;

  constructor(
    private lang: string,
    private onText: (text: string) => void,
    private Ctor: RecognitionCtor | undefined = recognitionCtor(),
  ) {}

  get text() {
    return join(this.committed, this.sessionText);
  }

  start(track?: MediaStreamTrack) {
    if (!this.Ctor) {
      this.failed = "unsupported";
      return;
    }
    this.active = true;
    this.track = track;
    this.startSession();
  }

  private track?: MediaStreamTrack;

  private startSession() {
    const rec = new this.Ctor!();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text = join(text, e.results[i][0].transcript);
      this.sessionText = text;
      this.onText(this.text);
    };
    rec.onerror = (e) => {
      if (FATAL.has(e.error)) {
        this.failed = e.error;
        this.active = false;
        this.onText(this.text);
      }
    };
    rec.onend = () => {
      // Browsers end recognition after a pause; keep what we have and carry on.
      this.committed = this.text;
      this.sessionText = "";
      if (this.active && this.restarts++ < MAX_RESTARTS) {
        try {
          this.startSession();
          return;
        } catch {
          this.active = false;
        }
      }
      this.ended?.();
    };
    this.rec = rec;
    try {
      // Newer Chrome can listen to the same microphone track as the recorder.
      if (this.track) rec.start(this.track);
      else rec.start();
    } catch {
      try {
        rec.start();
      } catch (err) {
        this.failed = (err as Error).message || "start-failed";
        this.active = false;
      }
    }
  }

  /** Stop and return everything heard. Waits briefly for the last words. */
  async stop(): Promise<string> {
    if (!this.rec) return this.text.trim();
    this.active = false;
    const done = new Promise<void>((resolve) => {
      this.ended = resolve;
      setTimeout(resolve, 1500);
    });
    try {
      this.rec.stop();
    } catch {
      /* already stopped */
    }
    await done;
    return this.text.trim();
  }

  abort() {
    this.active = false;
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
  }
}

function join(a: string, b: string) {
  const x = a.trim();
  const y = b.trim();
  return x && y ? `${x} ${y}` : x || y;
}
