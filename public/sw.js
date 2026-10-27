/* THE STANDARD — service worker
 * Receives Web Push messages and shows them, then reports back to the server
 * that the notification was displayed (and later, clicked). The server only
 * records "displayed" when this report arrives.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
    data: { url: data.url || "/today", id: data.id },
  };
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), ack(data.id, "displayed")]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, id } = event.notification.data || {};
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
