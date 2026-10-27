import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** Accepts `Authorization: Bearer <CRON_SECRET>` (Vercel Cron and pg_net both send this). */
export function isAuthorizedCron(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.cronSecret()}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
