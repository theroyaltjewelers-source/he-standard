import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See SETUP.md.`);
  return v;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  cronSecret: () => required("CRON_SECRET"),
  vapidPublicKey: () => required("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
  vapidPrivateKey: () => required("VAPID_PRIVATE_KEY"),
  vapidSubject: () => process.env.VAPID_SUBJECT || "mailto:admin@example.com",
  anthropicKey: () => process.env.ANTHROPIC_API_KEY || null,
  anthropicModel: () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  appUrl: () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
};

export const pushConfigured = () =>
  !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
