import "server-only";
import webpush from "web-push";
import { createAdminClient } from "./supabase/admin";

/**
 * Secrets the server manages itself, stored in the service-role-only
 * `app_config` table. Environment variables override them when set.
 */

const cache = new Map<string, string>();

async function read(key: string): Promise<string | null> {
  if (cache.has(key)) return cache.get(key)!;
  const { data, error } = await createAdminClient().from("app_config").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`app_config: ${error.message}`);
  if (data?.value) cache.set(key, data.value);
  return data?.value ?? null;
}

export async function getCronSecret(): Promise<string> {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  const v = await read("cron_secret");
  if (!v) throw new Error("No scheduler secret: run supabase/migrations/20261027000002_app_config.sql");
  return v;
}

/** VAPID keys for Web Push. Generated once on first use, then reused. */
export async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  let pub = await read("vapid_public_key");
  let priv = await read("vapid_private_key");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    const admin = createAdminClient();
    // Insert both; if another request won the race, keep theirs.
    await admin.from("app_config").upsert(
      [{ key: "vapid_public_key", value: k.publicKey }, { key: "vapid_private_key", value: k.privateKey }],
      { onConflict: "key", ignoreDuplicates: true },
    );
    cache.delete("vapid_public_key");
    cache.delete("vapid_private_key");
    pub = await read("vapid_public_key");
    priv = await read("vapid_private_key");
  }
  return { publicKey: pub!, privateKey: priv! };
}

/** Public key only, for the browser. Returns null rather than throwing so pages still render. */
export async function getVapidPublicKey(): Promise<string | null> {
  try {
    return (await getVapidKeys()).publicKey;
  } catch {
    return null;
  }
}
