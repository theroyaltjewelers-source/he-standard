"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "unsupported" | "needs-install" | "denied" | "off" | "on" | "working";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/**
 * Turns push notifications on or off for this device. On iPhone, Web Push only
 * works once the app has been added to the Home Screen, so the control says so.
 */
export function PushToggle({ vapidKey, compact = false }: { vapidKey: string | null; compact?: boolean }) {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setStatus(isIos() && !isStandalone() ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setStatus("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "on" : "off");
    })().catch(() => setStatus("unsupported"));
  }, []);

  async function enable() {
    if (!vapidKey) return setMessage("Notifications aren't configured on the server yet (missing VAPID keys — see SETUP.md).");
    setStatus("working");
    setMessage(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, deviceLabel: deviceLabel() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Server rejected the subscription");
      setStatus("on");
      setMessage("This device will now receive reminders.");
    } catch (e) {
      setStatus("off");
      setMessage(`Couldn't turn on notifications: ${(e as Error).message}`);
    }
  }

  async function disable() {
    setStatus("working");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setStatus("off");
    setMessage("Reminders turned off for this device.");
  }

  async function test() {
    setMessage("Sending…");
    const res = await fetch("/api/push/test", { method: "POST" });
    const r = await res.json();
    if (!res.ok) return setMessage(`Test failed: ${r.error}`);
    if (r.subscriptions === 0) return setMessage("No devices are registered.");
    setMessage(
      r.accepted === r.subscriptions
        ? `Accepted by the push service for ${r.accepted} device${r.accepted > 1 ? "s" : ""}. It should appear within a few seconds; the delivery log below updates when a device confirms it was shown.`
        : `${r.accepted} of ${r.subscriptions} devices accepted. Errors: ${r.errors.join("; ")}`,
    );
  }

  if (compact && (status === "on" || status === "checking" || status === "unsupported")) return null;

  return (
    <div className={compact ? "rounded-[14px] border border-emerald-deep bg-emerald-deep/30 p-4" : "space-y-3"}>
      {status === "needs-install" && (
        <p className="text-sm text-ivory-dim">
          On iPhone, reminders need the app on your Home Screen: tap Share, then <span className="text-ivory">Add to Home Screen</span>, and open it from there.
        </p>
      )}
      {status === "unsupported" && <p className="text-sm text-ivory-dim">This browser can&apos;t receive push notifications.</p>}
      {status === "denied" && (
        <p className="text-sm text-ivory-dim">Notifications are blocked for this site. Allow them in your browser or system settings, then reload.</p>
      )}
      {(status === "off" || status === "working") && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ivory-dim">{compact ? "Reminders are off on this device." : "This device is not receiving reminders."}</p>
          <button onClick={enable} disabled={status === "working"} className="btn btn-primary">Turn on reminders</button>
        </div>
      )}
      {status === "on" && !compact && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-emerald">This device is registered for reminders.</p>
          <div className="flex gap-2">
            <button onClick={test} className="btn btn-quiet">Send a test</button>
            <button onClick={disable} className="btn btn-quiet">Turn off</button>
          </div>
        </div>
      )}
      {message && <p role="status" className="text-sm text-ivory-dim">{message}</p>}
    </div>
  );
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iphone|ipad/i.test(ua) ? "iPhone/iPad" : /android/i.test(ua) ? "Android" : /mac/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : "Device";
  const br = /edg/i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}
