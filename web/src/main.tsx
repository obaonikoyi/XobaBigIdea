import { createRoot } from "react-dom/client";
import { App } from "./App";
import { recoverInterruptedRecordings } from "./lib/recorder";
import { refreshPending, startBackgroundSync } from "./lib/sync";
import "./styles.css";

async function boot() {
  // Ask the browser not to evict our data under storage pressure.
  void navigator.storage?.persist?.();
  let recovered = 0;
  try {
    recovered = await recoverInterruptedRecordings();
  } catch (e) {
    console.error("recovery failed", e);
  }
  createRoot(document.getElementById("root")!).render(<App recovered={recovered} />);
  await refreshPending();
  startBackgroundSync();
}

void boot();
