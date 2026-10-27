/* THE STANDARD — service worker
 * Receives Web Push messages and shows them, then reports back to the server
 * that the notification was displayed (and later, clicked). The server only
 * records "displayed" when this report arrives.
 */
const CACHE = "standard-shell-v2";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL, "/icons/icon-192.png"])).then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

// Pages are always fetched fresh (private, per-user data). When the network is
// down, show the offline page instead of the browser's error screen.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()),
  );
});

async function ack(id, event) {
  if (!id) return;
  try {
    await fetch("/api/notifications/ack", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, event }),
    });
  } catch (_) {
    /* offline: the delivery log will simply show "accepted by push service" */
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "The Standard", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "The Standard";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.tag || data.id,
    renotify: true,
    // Action buttons appear on Android and desktop; iOS shows the notification without them.
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
    data: { url: data.url || "/today", id: data.id, reminder_id: data.reminder_id },
  };
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), ack(data.id, "displayed")]));
});

async function act(reminderId, notificationId, action) {
  try {
    const r = await fetch("/api/notifications/action", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reminder_id: reminderId, notification_id: notificationId, action }),
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, id, reminder_id } = event.notification.data || {};
  if (event.action && event.action !== "open" && reminder_id) {
    event.waitUntil(
      (async () => {
        await ack(id, "clicked");
        const ok = await act(reminder_id, id, event.action);
        if (!ok) {
          // Couldn't reach the server (offline or signed out): open the app instead of silently failing.
          return self.clients.openWindow(url || "/today");
        }
      })(),
    );
    return;
  }
  event.waitUntil(
    (async () => {
      await ack(id, "clicked");
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c) return c.navigate(url || "/today");
          return;
        }
      }
      return self.clients.openWindow(url || "/today");
    })(),
  );
});
