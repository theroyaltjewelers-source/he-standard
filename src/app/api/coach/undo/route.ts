import { NextResponse } from "next/server";
import { z } from "zod";
import { coachContext } from "@/lib/coach/context";
import { undo } from "@/lib/coach/execute";
import { noteInConversation } from "@/lib/coach/run";

export async function POST(req: Request) {
  const c = await coachContext();
  if (!c) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const parsed = z.object({ execution_id: z.uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const r = await undo(parsed.data.execution_id, c.ctx);
  if (r.status === "invalid") return NextResponse.json({ error: r.error }, { status: 409 });
  if (r.status === "awaiting_confirmation") return NextResponse.json({ status: r.status });
  const { data: ex } = await c.ctx.admin.from("ai_tool_executions").select("conversation_id").eq("id", parsed.data.execution_id).maybeSingle();
  if (ex?.conversation_id && r.outcome.ok) await noteInConversation(c.ctx.db, c.ctx.userId, ex.conversation_id, `User undid an action: ${r.outcome.summary}`);
  return NextResponse.json({ ok: r.outcome.ok, summary: r.outcome.summary });
}
