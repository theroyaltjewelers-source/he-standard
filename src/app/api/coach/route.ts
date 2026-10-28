import { NextResponse } from "next/server";
import { z } from "zod";
import { coachContext } from "@/lib/coach/context";
import { runCoachTurn } from "@/lib/coach/run";

export const maxDuration = 60;

const body = z.object({
  message: z.string().trim().min(1).max(4000),
  conversation_id: z.uuid().nullable().optional(),
  input_method: z.enum(["typed", "voice"]).default("typed"),
  voice_reply: z.boolean().default(false),
  request_id: z.string().min(8).max(100).optional(),
});

export async function POST(req: Request) {
  const c = await coachContext();
  if (!c) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  // Idempotency: a retried request (same request_id) returns the first response
  // instead of running the tools again.
  const rid = parsed.data.request_id;
  if (rid) {
    const { error: claimErr } = await c.ctx.admin.from("ai_requests").insert({ request_id: `${c.ctx.userId}:${rid}`, user_id: c.ctx.userId });
    if (claimErr) {
      const { data: prior } = await c.ctx.admin.from("ai_requests").select("response").eq("request_id", `${c.ctx.userId}:${rid}`).maybeSingle();
      if (prior?.response) return NextResponse.json({ ...(prior.response as object), duplicate: true });
      return NextResponse.json({ error: "This message is still being processed." }, { status: 409 });
    }
  }
  try {
    const r = await runCoachTurn({
      db: c.ctx.db, admin: c.ctx.admin, profile: c.profile, today: c.ctx.today,
      conversationId: parsed.data.conversation_id ?? null, text: parsed.data.message,
      inputMethod: parsed.data.input_method, voiceReply: parsed.data.voice_reply,
    });
    const payload = {
      conversation_id: r.conversation_id,
      reply: r.reply,
      actions: r.actions.map((a) => a.status === "invalid"
        ? { tool: a.tool, status: a.status, error: a.error }
        : a.status === "awaiting_confirmation"
          ? { tool: a.tool, status: a.status, execution_id: a.execution_id, summary: a.summary, reason: a.reason }
          : { tool: a.tool, status: a.status, execution_id: a.execution_id, summary: a.outcome.summary, ok: a.outcome.ok, can_undo: a.status === "executed" && a.can_undo, kind: a.execution_id ? "write" : "read" }),
    };
    if (rid) await c.ctx.admin.from("ai_requests").update({ response: payload }).eq("request_id", `${c.ctx.userId}:${rid}`);
    return NextResponse.json(payload);
  } catch (e) {
    if (rid) await c.ctx.admin.from("ai_requests").delete().eq("request_id", `${c.ctx.userId}:${rid}`); // allow a retry
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
