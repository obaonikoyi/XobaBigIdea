import { describe, expect, it } from "vitest";
import { LiveTranscriber, type RecognitionLike } from "../src/lib/speech";

/** A stand-in for the browser's SpeechRecognition that tests can drive. */
class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: RecognitionLike["onresult"] = null;
  onerror: RecognitionLike["onerror"] = null;
  onend: RecognitionLike["onend"] = null;
  started = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  say(parts: [string, boolean][]) {
    const results = parts.map(([t, isFinal]) => ({ isFinal, 0: { transcript: t } }));
    this.onresult?.({ resultIndex: 0, results });
  }
}

const latest = () => FakeRecognition.instances.at(-1)!;

describe("live words", () => {
  it("shows words as they come, keeps them across the browser's automatic restarts, and returns them on stop", async () => {
    FakeRecognition.instances = [];
    const seen: string[] = [];
    const t = new LiveTranscriber("en-NG", (x) => seen.push(x), FakeRecognition);
    t.start();
    expect(latest().lang).toBe("en-NG");
    expect(latest().continuous).toBe(true);

    latest().say([["abeg make we", false]]);
    latest().say([["abeg make we build am", true]]);
    expect(seen.at(-1)).toBe("abeg make we build am");

    // Browser stops listening after a pause; we restart and keep earlier words.
    latest().onend?.();
    expect(FakeRecognition.instances).toHaveLength(2);
    latest().say([["for Lagos", false]]);
    expect(seen.at(-1)).toBe("abeg make we build am for Lagos");

    expect(await t.stop()).toBe("abeg make we build am for Lagos");
    expect(FakeRecognition.instances).toHaveLength(2); // no restart after stop
  });

  it("gives up quietly on a fatal error, keeping what it already heard", async () => {
    FakeRecognition.instances = [];
    const t = new LiveTranscriber("en-NG", () => undefined, FakeRecognition);
    t.start();
    latest().say([["na so", true]]);
    latest().onerror?.({ error: "network" });
    latest().onend?.();
    expect(t.failed).toBe("network");
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(await t.stop()).toBe("na so");
  });

  it("reports unsupported browsers without throwing", () => {
    const t = new LiveTranscriber("en-NG", () => undefined, undefined);
    t.start();
    expect(t.failed).toBe("unsupported");
  });
});
