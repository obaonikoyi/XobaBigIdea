import { useHashRoute } from "./lib/hooks";
import { Capture } from "./screens/Capture";
import { Library } from "./screens/Library";
import { IdeaCard } from "./screens/IdeaCard";
import { Review } from "./screens/Review";
import { Settings } from "./screens/Settings";
import { StatusBar } from "./components/StatusBar";

const NAV = [
  { path: "", label: "Capture" },
  { path: "library", label: "Library" },
  { path: "review", label: "Review" },
  { path: "settings", label: "Settings" },
];

export function App({ recovered }: { recovered: number }) {
  const [page, arg] = useHashRoute();
  const current = page ?? "";
  return (
    <>
      <header className="top">
        <a href="#/" className="brand">
          Xoba Big Idea
        </a>
        <nav>
          {NAV.map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={current === n.path || (n.path === "library" && current === "idea") ? "active" : ""}>
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      <StatusBar />
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
