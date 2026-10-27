import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getCronSecret } from "@/lib/app-config";

/** Accepts `Authorization: Bearer <CRON_SECRET>` (Vercel Cron and pg_net both send this). */
export async function isAuthorizedCron(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${await getCronSecret()}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
