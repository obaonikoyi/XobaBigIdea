import { useEffect, useState } from "react";
import { useHashRoute, useSyncState } from "./lib/hooks";
import { Login } from "./screens/Login";
import { Capture } from "./screens/Capture";
import { Library } from "./screens/Library";
import { IdeaCard } from "./screens/IdeaCard";
import { Review } from "./screens/Review";
import { Settings } from "./screens/Settings";
import { StatusBar, SyncBadge } from "./components/StatusBar";

const NAV = [
  { path: "", label: "Capture" },
  { path: "library", label: "Library" },
  { path: "review", label: "Review" },
  { path: "settings", label: "Settings" },
];

export function App({ recovered }: { recovered: number }) {
  const [page, arg] = useHashRoute();
  const current = page ?? "";
  const sync = useSyncState();
  // Sign-in shows when the server asks for it, unless skipped for this visit.
  const [skipped, setSkipped] = useState(() => sessionStorage.getItem("login.skipped") === "1");
  const [forced, setForced] = useState(false);
  const skip = () => {
    setForced(false);
    setSkipped(true);
    try {
      sessionStorage.setItem("login.skipped", "1");
    } catch {
      /* private mode */
    }
  };
  useEffect(() => {
    const open = () => setForced(true);
    // After a deliberate sign-out, don't push the sign-in screen straight back.
    const signedOut = () => skip();
    window.addEventListener("xoba:signin", open);
    window.addEventListener("xoba:signedout", signedOut);
    return () => {
      window.removeEventListener("xoba:signin", open);
      window.removeEventListener("xoba:signedout", signedOut);
    };
  }, []);
  const showLogin = forced || (!!sync.authNeeded && sync.online && !skipped);

  if (showLogin) {
    return (
      <Login
        onDone={() => setForced(false)}
        onSkip={skip}
      />
    );
  }

  return (
    <>
      <header className="top">
        <a href="#/" className="brand">
          Xoba Big Idea
        </a>
        <SyncBadge />
        <nav>
          {NAV.map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={current === n.path || (n.path === "library" && current === "idea") ? "active" : ""}>
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      <StatusBar onSignIn={() => setForced(true)} />
      {recovered > 0 && <div className="statusbar">Recovered {recovered} recording{recovered > 1 ? "s" : ""} that was interrupted. It is saved in your library.</div>}
      <main>
        {current === "" && <Capture />}
        {current === "library" && <Library />}
        {current === "idea" && arg && <IdeaCard id={arg} />}
        {current === "review" && <Review />}
        {current === "settings" && <Settings />}
      </main>
    </>
  );
}
