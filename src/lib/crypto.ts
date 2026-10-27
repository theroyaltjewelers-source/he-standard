import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for stored OAuth tokens. The key is derived from a
 * server-only secret (TOKEN_ENCRYPTION_KEY, or the Supabase JWT secret the
 * Vercel integration provides). It never lives in the database, so a database
 * dump alone does not expose usable tokens.
 */
function key(): Buffer {
  const material = process.env.TOKEN_ENCRYPTION_KEY || process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!material) throw new Error("No server secret available for token encryption");
  return Buffer.from(hkdfSync("sha256", material, "the-standard", "oauth-token-encryption-v1", 32));
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function decrypt(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1") throw new Error("Unknown token format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
