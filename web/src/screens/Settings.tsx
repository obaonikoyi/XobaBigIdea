import { useEffect, useRef, useState } from "react";
import type { HealthResponse } from "@xoba/shared";
import { api, getSettings, saveSettings, type Settings as S } from "../lib/api";
import { buildExport, downloadBytes, restoreExport } from "../lib/exportRestore";
import { syncNow } from "../lib/sync";
import { useIdeas, useSyncState } from "../lib/hooks";
import { audioMeta } from "../lib/db";
import { fmtDateTime } from "../lib/format";

export function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [msg, setMsg] = useState("");
  const [restoreMsg, setRestoreMsg] = useState("");
  const [audioMb, setAudioMb] = useState<number>();
  const [persisted, setPersisted] = useState<boolean>();
  const fileRef = useRef<HTMLInputElement>(null);
  const ideas = useIdeas();
  const sync = useSyncState();

  useEffect(() => {
    getSettings().then(setS);
    audioMeta().then((a) => setAudioMb(a.reduce((n, x) => n + x.size, 0) / 1024 / 1024));
    navigator.storage?.persisted?.().then(setPersisted);
  }, [ideas]);

  async function test() {
    if (!s) return;
    await saveSettings(s);
    setMsg("Checking…");
    try {
      setHealth(await api.health());
      setMsg("Connected.");
      void syncNow();
    } catch (e) {
      setHealth(null);
      setMsg(`Could not connect: ${(e as Error).message}`);
    }
  }

  async function doExport() {
    const bytes = await buildExport();
    downloadBytes(bytes, `xoba-big-idea-${new Date().toISOString().slice(0, 10)}.zip`);
  }

  async function doRestore(file: File) {
    setRestoreMsg("Restoring…");
    try {
      const r = await restoreExport(new Uint8Array(await file.arrayBuffer()));
      setRestoreMsg(`Restored: ${r.added} added, ${r.updated} updated, ${r.unchanged} already up to date, ${r.audioAdded} recordings added${r.skipped ? `, ${r.skipped} skipped` : ""}.`);
      void syncNow();
    } catch (e) {
      setRestoreMsg((e as Error).message);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  if (!s) return null;
  return (
    <div className="settings">
      <section>
        <h2>Your data</h2>
        <p>
          {ideas?.length ?? 0} ideas and {audioMb?.toFixed(1) ?? "…"} MB of audio on this device.
          {persisted === false && " The browser may clear storage if the device runs low; export regularly."}
        </p>
        <button type="button" className="primary" onClick={doExport}>
          Export everything (.zip)
        </button>
        <p className="muted small">The zip holds your ideas as JSON and as readable text, plus every original recording.</p>
        <label className="file-label">
          <span>Restore from an export</span>
          <input ref={fileRef} type="file" accept=".zip,application/zip" onChange={(e) => e.target.files?.[0] && doRestore(e.target.files[0])} data-testid="restore-input" />
        </label>
        <p className="muted small">Restore adds missing ideas and recordings and keeps the newest version of each idea. It never deletes anything.</p>
        {restoreMsg && <p role="status" data-testid="restore-msg">{restoreMsg}</p>}
      </section>

      <section>
        <h2>Sync server</h2>
        <label>
          Server address <span className="muted small">(leave empty if the app is served by it)</span>
          <input type="url" value={s.serverUrl} onChange={(e) => setS({ ...s, serverUrl: e.target.value })} placeholder="https://…" />
        </label>
        <label>
          App token
          <input type="password" value={s.token} onChange={(e) => setS({ ...s, token: e.target.value })} autoComplete="off" />
        </label>
        <div className="row">
          <button type="button" onClick={test}>
            Save and test
          </button>
          <button type="button" className="secondary" onClick={() => syncNow()}>
            Sync now
          </button>
        </div>
        {msg && <p role="status">{msg}</p>}
        <p className="muted small">
          {sync.lastSyncAt ? `Last synced ${fmtDateTime(sync.lastSyncAt)}.` : "Not synced yet."} {sync.pending ? `${sync.pending} changes waiting.` : ""}
          {sync.lastError && ` Last problem: ${sync.lastError}`}
        </p>
      </section>

      {(health?.ai ?? sync.ai) && (
        <section>
          <h2>AI</h2>
          {(() => {
            const ai = (health?.ai ?? sync.ai)!;
            return (
              <ul>
                <li>
                  Cards: {ai.enrich.available ? "on" : "off"} ({ai.enrich.provider}){ai.enrich.reason && ` · ${ai.enrich.reason}`}
                </li>
                <li>
                  Transcription: {ai.transcribe.available ? "on" : "off"} ({ai.transcribe.provider}){ai.transcribe.reason && ` · ${ai.transcribe.reason}`}
                </li>
                <li>
                  Spent this month: ${ai.spend.monthUsd.toFixed(2)} of ${ai.spend.capUsd.toFixed(2)} cap
                </li>
              </ul>
            );
          })()}
          <p className="muted small">When AI is off or over the cap, capture, browsing and replay keep working. Cards and transcripts catch up later.</p>
        </section>
      )}
    </div>
  );
}
