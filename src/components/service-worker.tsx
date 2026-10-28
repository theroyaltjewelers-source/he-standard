"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that receives push notifications, and makes
 * sure this device's notification subscription belongs to the account that is
 * signed in now. A phone that was used with another account (a second or test
 * account) would otherwise keep receiving that account's reminders — e.g. its
 * prayer times in another city — after switching back.
 */
export function ServiceWorker({ userId }: { userId: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    if (!("PushManager" in window) || !("Notification" in window) || Notification.permission !== "granted") return;
    const key = `push-owner:${userId}`;
    try { if (sessionStorage.getItem(key)) return; } catch { /* private mode: just re-sync */ }
    (async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, deviceLabel: navigator.userAgent.slice(0, 80) }),
      });
      if (res.ok) { try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ } }
    })().catch(() => {});
  }, [userId]);
  return null;
}

/**
 * Sign out that also detaches this device's notifications from the account,
 * so nobody keeps receiving reminders for an account they signed out of.
 */
export function SignOutButton({ className, children }: { className?: string; children: React.ReactNode }) {
  async function detach(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    e.preventDefault();
    try {
      if ("serviceWorker" in navigator && "PushManager" in window) {
        const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 800))]);
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub) (form.elements.namedItem("endpoint") as HTMLInputElement).value = sub.endpoint;
      }
      sessionStorage.clear();
    } catch { /* sign out regardless */ }
    form.submit();
  }
  return (
    <form action="/auth/signout" method="post" onSubmit={detach} className={className}>
      <input type="hidden" name="endpoint" defaultValue="" />
      {children}
    </form>
  );
}
