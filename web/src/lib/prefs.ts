import type { SpeechLanguage } from "@xoba/shared";
import * as db from "./db";

export interface SpeechPrefs {
  /** Language used for live words and as a hint for server transcription. */
  lang: SpeechLanguage;
  /** Show words on screen while speaking. */
  live: boolean;
}

const KEY = "prefs.speech";
export const DEFAULT_SPEECH: SpeechPrefs = { lang: "en-NG", live: true };

export async function getSpeechPrefs(): Promise<SpeechPrefs> {
  return { ...DEFAULT_SPEECH, ...((await db.getMeta<SpeechPrefs>(KEY)) ?? {}) };
}

export const saveSpeechPrefs = (p: SpeechPrefs) => db.setMeta(KEY, p);
