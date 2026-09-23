import { useEffect, useState } from "react";
import { loadAudio } from "../lib/sync";

export function AudioPlayer({ audioId, ideaId }: { audioId: string; ideaId: string }) {
  const [url, setUrl] = useState<string>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let u: string | undefined;
    let alive = true;
    loadAudio(audioId, ideaId).then((a) => {
      if (!alive) return;
      if (!a) return setMissing(true);
      u = URL.createObjectURL(new Blob([a.bytes], { type: a.mime }));
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [audioId, ideaId]);

  if (missing) return <p className="muted small">Audio is not on this device yet. It will download when the server is reachable.</p>;
  if (!url) return <p className="muted small">Loading audio…</p>;
  return <audio controls preload="metadata" src={url} className="player" data-testid="audio-player" />;
}
