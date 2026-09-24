import { useSyncState } from "../lib/hooks";

export function StatusBar() {
  const s = useSyncState();
  const bits: string[] = [];
  if (!s.online) bits.push("Offline: saving on this device");
  else if (s.serverReachable === false) bits.push("Server not reachable: saving on this device");
  else if (s.lastError) bits.push(`Not syncing (${s.lastError}). Check Settings. Everything is saved on this device`);
  if (s.pending > 0) bits.push(`${s.pending} waiting to sync`);
  if (s.ai && s.serverReachable) {
    if (s.ai.spend.overCap) bits.push("AI paused: monthly cap reached");
    else if (!s.ai.enrich.available && !s.ai.transcribe.available) bits.push("AI off");
  }
  if (bits.length === 0) return null;
  return (
    <div className="statusbar" role="status" data-testid="statusbar">
      {bits.join(" · ")}
    </div>
  );
}
