import { NextResponse } from "next/server";
import { z } from "zod";
import { coachContext } from "@/lib/coach/context";
import { decide } from "@/lib/coach/execute";
import { noteInConversation } from "@/lib/coach/run";

const body = z.object({ execution_id: z.uuid(), decision: z.enum(["confirm", "reject"]) });

export async function POST(req: Request) {
  const c = await coachContext();
  if (!c) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const r = await decide(parsed.data.execution_id, parsed.data.decision, c.ctx);
  if (r.status === "invalid") return NextResponse.json({ status: r.status, error: r.error }, { status: 409 });
  if (r.status === "awaiting_confirmation") return NextResponse.json({ status: r.status });
  const { data: ex } = await c.ctx.admin.from("ai_tool_executions").select("conversation_id,summary").eq("id", r.execution_id!).maybeSingle();
  if (ex?.conversation_id) {
    await noteInConversation(c.ctx.db, c.ctx.userId, ex.conversation_id,
      parsed.data.decision === "reject" ? `User cancelled: ${ex.summary}` : `${r.outcome.ok ? "Confirmed and done" : "Confirmed but FAILED"}: ${r.outcome.summary}`);
  }
  return NextResponse.json({ status: r.status, ok: r.outcome.ok, summary: r.outcome.summary, can_undo: r.status === "executed" && r.can_undo, execution_id: r.execution_id });
}
