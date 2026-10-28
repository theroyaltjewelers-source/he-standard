import { requireUser } from "@/lib/session";
import { env } from "@/lib/env";
import { CoachChat, type ActionCard, type ChatMessage } from "@/components/coach-chat";
import type { UserPreferences } from "@/lib/types";

export const metadata = { title: "The Coach" };

export default async function Coach({ searchParams }: PageProps<"/coach">) {
  const sp = await searchParams;
  const { supabase, profile } = await requireUser();
  const fresh = sp.new === "1";
  const { data: prefs } = await supabase.from("user_preferences").select("voice_replies,haptics").maybeSingle<Pick<UserPreferences, "voice_replies" | "haptics">>();

  let conversationId: string | null = null;
  let messages: ChatMessage[] = [];
  let actions: ActionCard[] = [];
  if (!fresh) {
    const since = new Date(new Date().getTime() - 12 * 3600_000).toISOString();
    const { data: conv } = await supabase.from("ai_conversations").select("id").gte("updated_at", since).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (conv) {
      conversationId = conv.id;
      const { data: msgs } = await supabase.from("ai_messages").select("role,display_text,input_method").eq("conversation_id", conv.id).not("display_text", "is", null).order("created_at").limit(60);
      messages = (msgs ?? []).map((m) => ({ role: m.role, text: m.display_text!, voice: m.input_method === "voice" }));
      const { data: pending } = await supabase.from("ai_tool_executions").select("id,tool,summary,confirmation_reason").eq("conversation_id", conv.id).eq("status", "awaiting_confirmation");
      actions = (pending ?? []).map((p) => ({ key: p.id, tool: p.tool, status: "awaiting_confirmation" as const, execution_id: p.id, summary: p.summary ?? p.tool, reason: p.confirmation_reason ?? undefined }));
    }
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="h-page">The Coach</h1>
        <p className="mt-1.5 text-sm text-ivory-dim">
          Schedules, reminders, check-ins and questions about your own record. Changes to your calendar and anything destructive wait for your confirmation{profile.ai_analysis_consent ? "." : ". Journal and check-in history stay private until you turn on AI analysis in Settings."}
        </p>
      </header>
      <CoachChat
        initialConversationId={conversationId}
        initialMessages={messages}
        initialActions={actions}
        aiReady={!!env.anthropicKey()}
        voiceRepliesDefault={prefs?.voice_replies ?? false}
        haptics={prefs?.haptics ?? true}
        initialPrompt={typeof sp.q === "string" ? sp.q.slice(0, 500) : ""}
      />
    </div>
  );
}
