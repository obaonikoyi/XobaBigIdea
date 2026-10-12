// "Talk it through": a conversation with the AI about one idea.
// Every message is saved on the idea (so it syncs to your other devices);
// the AI only ever sees the recent part of the conversation.
import { CHAT_HISTORY_LIMIT, type Idea, type TakeContent } from "@xoba/shared";
import * as db from "./db";
import { api } from "./api";
import { addChatMessage, wordsFor } from "./ideas";
import { syncNow } from "./sync";

function takeFor(idea: Idea): TakeContent | undefined {
  const t = idea.take;
  if (!t || (!t.whatYouMean && !t.opinion)) return undefined;
  return { whatYouMean: t.whatYouMean, strengths: t.strengths, risks: t.risks, opinion: t.opinion, nextSteps: t.nextSteps };
}

/** True when the last message is mine and has no reply yet (for example after a failed send). */
export function awaitingReply(idea: Idea) {
  const last = idea.chat?.[idea.chat.length - 1];
  return last?.role === "me";
}

/**
 * Save my message (if any) straight away, then ask the AI for a reply.
 * Call with empty text to retry a message that did not get a reply.
 * Throws if the AI cannot be reached; my message stays saved either way.
 */
export async function sendChat(ideaId: string, text: string) {
  if (text.trim()) await addChatMessage(ideaId, "me", text.trim());
  const idea = await db.getIdea(ideaId);
  if (!idea || !awaitingReply(idea)) return;
  try {
    const r = await api.chat({
      words: wordsFor(idea),
      title: idea.title.value || undefined,
      type: idea.type.value,
      take: takeFor(idea),
      messages: (idea.chat ?? []).slice(-CHAT_HISTORY_LIMIT).map((m) => ({ role: m.role, text: m.text })),
    });
    await addChatMessage(ideaId, "ai", r.reply, r.provider);
  } finally {
    void syncNow();
  }
}
