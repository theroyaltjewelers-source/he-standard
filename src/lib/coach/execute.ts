import "server-only";
import { toolByName, type ToolContext, type ToolOutcome } from "./tools";

/**
 * Executes model-requested tool calls with validation, confirmation gating,
 * persistence of every attempt, audit logging and undo.
 * All writes to ai_tool_executions / audit_logs use the service-role client
 * (users cannot forge them) but are always scoped to ctx.userId.
 */

export type ExecResult =
  | { status: "executed"; execution_id: string | null; outcome: ToolOutcome; can_undo: boolean }
  | { status: "failed"; execution_id: string | null; outcome: ToolOutcome }
  | { status: "awaiting_confirmation"; execution_id: string; summary: string; reason: string }
  | { status: "invalid"; error: string };

export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext, conversationId: string | null): Promise<ExecResult> {
  const tool = toolByName(name);
  if (!tool) return { status: "invalid", error: `Unknown tool ${name}` };
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) return { status: "invalid", error: `Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const input = parsed.data;

  if (tool.confirm) {
    const reason = await tool.confirm(input, ctx);
    if (reason) {
      const summary = tool.describe ? await tool.describe(input, ctx) : `${name}`;
      const { data, error } = await ctx.admin.from("ai_tool_executions").insert({
        user_id: ctx.userId, conversation_id: conversationId, tool: name, input, status: "awaiting_confirmation",
        requires_confirmation: true, confirmation_reason: reason, summary,
      }).select("id").single();
      if (error) return { status: "invalid", error: `Couldn't record the pending action: ${error.message}` };
      return { status: "awaiting_confirmation", execution_id: data.id, summary, reason };
    }
  }
  return run(tool.name, input, ctx, conversationId, null);
}

async function run(name: string, input: unknown, ctx: ToolContext, conversationId: string | null, existingId: string | null): Promise<ExecResult> {
  const tool = toolByName(name)!;
  let outcome: ToolOutcome;
  try {
    outcome = await tool.run(input as never, ctx);
  } catch (e) {
    outcome = { ok: false, summary: `Failed: ${(e as Error).message}`, result: { error: (e as Error).message } };
  }
  // Reads are not recorded as executions; writes always are.
  if (tool.kind === "read") return outcome.ok ? { status: "executed", execution_id: null, outcome, can_undo: false } : { status: "failed", execution_id: null, outcome };

  const row = {
    user_id: ctx.userId, conversation_id: conversationId, tool: name, input,
    status: outcome.ok ? "executed" : "failed", summary: outcome.summary, result: outcome.result,
    error: outcome.ok ? null : outcome.summary, undo: outcome.undo ?? null, executed_at: new Date().toISOString(),
  };
  let id = existingId;
  if (existingId) await ctx.admin.from("ai_tool_executions").update(row).eq("id", existingId).eq("user_id", ctx.userId);
  else {
    const { data } = await ctx.admin.from("ai_tool_executions").insert(row).select("id").single();
    id = data?.id ?? null;
  }
  if (outcome.ok) {
    await ctx.admin.from("audit_logs").insert({
      user_id: ctx.userId, actor: "ai", action: `coach.${name}`, entity_type: outcome.entity?.type ?? null, entity_id: outcome.entity?.id ?? null,
      detail: { summary: outcome.summary, execution_id: id },
    });
  }
  return outcome.ok ? { status: "executed", execution_id: id, outcome, can_undo: !!outcome.undo } : { status: "failed", execution_id: id, outcome };
}

export async function decide(executionId: string, decision: "confirm" | "reject", ctx: ToolContext): Promise<ExecResult> {
  const { data: ex } = await ctx.admin.from("ai_tool_executions").select("*").eq("id", executionId).eq("user_id", ctx.userId).maybeSingle();
  if (!ex) return { status: "invalid", error: "That action wasn't found." };
  if (ex.status !== "awaiting_confirmation") return { status: "invalid", error: `That action is already ${ex.status.replace("_", " ")}.` };
  if (Date.now() - Date.parse(ex.created_at) > 24 * 3600_000) {
    await ctx.admin.from("ai_tool_executions").update({ status: "expired" }).eq("id", ex.id);
    return { status: "invalid", error: "That confirmation expired. Ask again." };
  }
  // Atomic state transition: only one request can move it out of awaiting_confirmation,
  // so a double tap (or two devices) can never execute the action twice.
  const next = decision === "reject" ? "rejected" : "executing";
  const { data: claimed } = await ctx.admin.from("ai_tool_executions").update({ status: next })
    .eq("id", ex.id).eq("user_id", ctx.userId).eq("status", "awaiting_confirmation").select("id");
  if (!claimed?.length) return { status: "invalid", error: "That action was already handled." };
  if (decision === "reject") {
    return { status: "failed", execution_id: ex.id, outcome: { ok: false, summary: "Cancelled — nothing was changed.", result: { rejected: true } } };
  }
  const tool = toolByName(ex.tool);
  const parsed = tool?.schema.safeParse(ex.input);
  if (!tool || !parsed?.success) {
    await ctx.admin.from("ai_tool_executions").update({ status: "failed", error: "Stored action no longer valid" }).eq("id", ex.id);
    return { status: "invalid", error: "The stored action is no longer valid." };
  }
  return run(ex.tool, parsed.data, ctx, ex.conversation_id, ex.id);
}

export async function undo(executionId: string, ctx: ToolContext): Promise<ExecResult> {
  const { data: ex } = await ctx.admin.from("ai_tool_executions").select("*").eq("id", executionId).eq("user_id", ctx.userId).maybeSingle();
  if (!ex || ex.status !== "executed" || !ex.undo) return { status: "invalid", error: "Nothing to undo for that action." };
  const u = ex.undo as { tool: string; input: Record<string, unknown> };
  const tool = toolByName(u.tool);
  const parsed = tool?.schema.safeParse(u.input);
  if (!tool || !parsed?.success) return { status: "invalid", error: "Undo data is invalid." };
  const { data: claimed } = await ctx.admin.from("ai_tool_executions").update({ status: "undoing" })
    .eq("id", ex.id).eq("user_id", ctx.userId).eq("status", "executed").select("id");
  if (!claimed?.length) return { status: "invalid", error: "That action was already undone." };
  let outcome: ToolOutcome;
  try { outcome = await tool.run(parsed.data as never, ctx); } catch (e) { outcome = { ok: false, summary: (e as Error).message, result: {} }; }
  if (!outcome.ok) await ctx.admin.from("ai_tool_executions").update({ status: "executed" }).eq("id", ex.id); // undo failed: still executed
  if (outcome.ok) {
    await ctx.admin.from("ai_tool_executions").update({ status: "undone", undone_at: new Date().toISOString() }).eq("id", ex.id);
    await ctx.admin.from("audit_logs").insert({ user_id: ctx.userId, actor: "user", action: `undo.${ex.tool}`, detail: { execution_id: ex.id, summary: outcome.summary } });
  }
  return outcome.ok ? { status: "executed", execution_id: ex.id, outcome, can_undo: false } : { status: "failed", execution_id: ex.id, outcome };
}
