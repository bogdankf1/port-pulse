import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AssistantConversation,
  AssistantMessage,
  AssistantRole,
} from "@/types";

const CONVERSATIONS = "assistant_conversations";
const MESSAGES = "assistant_messages";

export const MAX_TITLE_LENGTH = 60;

/**
 * Title a conversation from its first user message rather than asking the model
 * for one — that would be an extra billed call on every new conversation for a
 * string nobody reads closely.
 */
export function deriveTitle(firstMessage: string): string {
  const clean = firstMessage.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  if (clean.length <= MAX_TITLE_LENGTH) return clean;

  const cut = clean.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

export async function createConversation(
  supabase: SupabaseClient,
  userId: string,
  firstMessage: string,
): Promise<string> {
  const { data, error } = await supabase
    .from(CONVERSATIONS)
    .insert({ user_id: userId, title: deriveTitle(firstMessage) })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

export async function appendMessage(
  supabase: SupabaseClient,
  args: {
    conversationId: string;
    userId: string;
    role: AssistantRole;
    content: string;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from(MESSAGES)
    .insert({
      conversation_id: args.conversationId,
      user_id: args.userId,
      role: args.role,
      content: args.content,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Bump the conversation so the list orders by recency.
  await supabase
    .from(CONVERSATIONS)
    .update({ updated_at: new Date().toISOString() })
    .eq("id", args.conversationId);

  return String(data.id);
}

export async function loadMessages(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<AssistantMessage[]> {
  const { data, error } = await supabase
    .from(MESSAGES)
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    role: r.role as AssistantRole,
    content: String(r.content),
    createdAt: String(r.created_at),
  }));
}

export async function listConversations(
  supabase: SupabaseClient,
): Promise<AssistantConversation[]> {
  const { data, error } = await supabase
    .from(CONVERSATIONS)
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    title: r.title == null ? null : String(r.title),
    updatedAt: String(r.updated_at),
  }));
}
