import { ideaWords, type Idea, type IdeaStatus, type IdeaType } from "@xoba/shared";

export interface LibraryFilter {
  q: string;
  type: IdeaType | "all";
  /** "active" = everything except archived. */
  status: IdeaStatus | "active";
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Search matches every word, across title, summary, typed words, transcripts and questions. Accent-insensitive (Yoruba tone marks). */
export function filterIdeas(ideas: Idea[], f: LibraryFilter): Idea[] {
  const terms = norm(f.q).split(/\s+/).filter(Boolean);
  return ideas
    .filter((i) => (f.status === "active" ? i.status !== "archived" : i.status === f.status))
    .filter((i) => f.type === "all" || i.type.value === f.type)
    .filter((i) => {
      if (!terms.length) return true;
      const hay = norm([i.title.value, i.summary.value, ideaWords(i), ...i.entries.map((e) => e.question ?? ""), ...i.followUps.map((q) => q.question)].join(" "));
      return terms.every((t) => hay.includes(t));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Weekly review picks 3 ideas that are waiting (Captured or Later):
 * never-reviewed first, then the longest since last review, oldest capture first.
 */
export function pickReviewIdeas(ideas: Idea[], n = 3): Idea[] {
  return ideas
    .filter((i) => i.status === "captured" || i.status === "later")
    .sort((a, b) => (a.lastReviewedAt ?? "").localeCompare(b.lastReviewedAt ?? "") || a.createdAt.localeCompare(b.createdAt))
    .slice(0, n);
}
