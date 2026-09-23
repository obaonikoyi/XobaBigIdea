import { describe, expect, it } from "vitest";
import * as db from "../src/lib/db";
import { addThought, answerFollowUp, applyEnrichment, createIdea, displayTitle, leaveFollowUpForLater, setField, setPriority } from "../src/lib/ideas";

describe("capture", () => {
  it("saves immediately with the app's own timestamp, and survives reopening", async () => {
    const before = new Date().toISOString();
    const idea = await createIdea({ text: "Abeg, make we build market app for mama put" });
    await db.closeDb(); // simulate closing and reopening the app
    const again = await db.getIdea(idea.id);
    expect(again?.entries[0].text).toBe("Abeg, make we build market app for mama put");
    expect(again!.createdAt >= before).toBe(true);
    expect(again!.priority).toBeNull();
    expect(again!.status).toBe("captured");
    expect(await db.outboxIds()).toContain(idea.id);
  });

  it("uses the first words as a title until there is a card", async () => {
    const idea = await createIdea({ text: "Ọmọ mi, song about Lagos rain and traffic tonight" });
    expect(displayTitle(idea)).toBe("Ọmọ mi, song about Lagos rain and traffic");
  });
});

describe("card", () => {
  const ai = { title: "Lagos rain song", type: "song" as const, summary: "A song about rain.", questions: ["Who sings it?", "What tempo?", "Third?"], provider: "fake" };

  it("AI fills the card but never touches the original words", async () => {
    const idea = await createIdea({ text: "Rain dey fall for Lagos o" });
    const after = await applyEnrichment(idea.id, ai, 1);
    expect(after.title).toEqual({ value: "Lagos rain song", source: "ai" });
    expect(after.entries[0].text).toBe("Rain dey fall for Lagos o");
    expect(after.followUps).toHaveLength(2);
  });

  it("AI never overwrites fields I edited", async () => {
    const idea = await createIdea({ text: "x" });
    await setField(idea.id, "title", "My own title");
    const after = await applyEnrichment(idea.id, ai, 1);
    expect(after.title).toEqual({ value: "My own title", source: "me" });
    expect(after.summary.source).toBe("ai");
  });

  it("priority stays Not set until I choose", async () => {
    const idea = await createIdea({ text: "x" });
    expect((await applyEnrichment(idea.id, ai, 1)).priority).toBeNull();
    expect((await setPriority(idea.id, "high")).priority).toBe("high");
  });

  it("follow-ups can be answered or left for later", async () => {
    const idea = await createIdea({ text: "x" });
    const withQs = await applyEnrichment(idea.id, ai, 1);
    const [q1] = withQs.followUps;
    const answered = await answerFollowUp(idea.id, q1.id, { text: "Me and Tunde" });
    expect(answered.entries.at(-1)).toMatchObject({ kind: "answer", question: "Who sings it?", text: "Me and Tunde" });
    const later = await leaveFollowUpForLater(idea.id);
    expect(later.followUps.map((f) => f.state)).toEqual(["answered", "later"]);
  });

  it("adding a thought keeps earlier words and moves updatedAt forward", async () => {
    const idea = await createIdea({ text: "first" });
    const after = await addThought(idea.id, { text: "second" });
    expect(after.entries.map((e) => e.text)).toEqual(["first", "second"]);
    expect(after.updatedAt > idea.updatedAt).toBe(true);
  });
});
