// Tiny change notifier so screens re-render when local data changes,
// including changes made in another tab.
type Listener = () => void;
const listeners = new Set<Listener>();
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("xoba-big-idea") : null;
channel?.addEventListener("message", () => listeners.forEach((l) => l()));
// Do not keep Node (tests) alive just for this channel.
(channel as unknown as { unref?: () => void } | null)?.unref?.();

export function onChange(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function emitChange() {
  listeners.forEach((l) => l());
  channel?.postMessage("change");
}
