import { useEffect, useState } from "react";
import type { Idea } from "@xoba/shared";
import * as db from "./db";
import { onChange } from "./events";
import { getSyncState, onSyncState, type SyncState } from "./sync";

export function useIdeas(): Idea[] | null {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => db.allIdeas().then((i) => alive && setIdeas(i));
    load();
    const off = onChange(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return ideas;
}

export function useIdea(id: string | undefined): Idea | null | undefined {
  const [idea, setIdea] = useState<Idea | null | undefined>(undefined);
  useEffect(() => {
    if (!id) return setIdea(undefined);
    let alive = true;
    const load = () => db.getIdea(id).then((i) => alive && setIdea(i ?? null));
    load();
    const off = onChange(load);
    return () => {
      alive = false;
      off();
    };
  }, [id]);
  return idea;
}

export function useSyncState(): SyncState {
  const [s, setS] = useState(getSyncState());
  useEffect(() => onSyncState(setS), []);
  return s;
}

export function useHashRoute(): string[] {
  const parse = () => (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean);
  const [route, setRoute] = useState(parse());
  useEffect(() => {
    const f = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return route;
}

export const go = (path: string) => {
  location.hash = path;
};
