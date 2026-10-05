import { useSyncState } from "../lib/hooks";

export function StatusBar({ onSignIn }: { onSignIn?: () => void }) {
  const s = useSyncState();
  const bits: string[] = [];
  if (!s.online) bits.push("Offline: saving on this device");
  else if (s.authNeeded) bits.push("Not signed in: ideas stay on this device");
  else if (s.serverReachable === false) bits.push("Server not reachable: saving on this device");
  else if (s.lastError) bits.push(`Not syncing (${s.lastError}). Everything is saved on this device`);
  if (s.pending > 0) bits.push(`${s.pending} waiting to sync`);
  if (s.ai && s.serverReachable && !s.authNeeded) {
    if (s.ai.spend.overCap) bits.push("AI paused: monthly cap reached");
    else if (!s.ai.enrich.available && !s.ai.transcribe.available) bits.push("AI off");
  }
  if (bits.length === 0) return null;
  return (
    <div className="statusbar" role="status" data-testid="statusbar">
      {bits.join(" · ")}
      {s.authNeeded && s.online && onSignIn && (
        <>
          {" · "}
          <button type="button" className="link" onClick={onSignIn}>
            Sign in
          </button>
        </>
      )}
    </div>
  );
}

/** Small "Synced 14:32" in the header so you can see your devices are in step. */
export function SyncBadge() {
  const s = useSyncState();
  let text = "";
  if (s.running) text = "Syncing…";
  else if (!s.online) text = "Offline";
  else if (s.authNeeded) text = "";
  else if (s.lastSyncAt && s.pending === 0) text = `Synced ${new Date(s.lastSyncAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  if (!text) return null;
  return (
    <span className="sync-badge" data-testid="sync-badge">
      {text}
    </span>
  );
}
