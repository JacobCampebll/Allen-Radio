// push-sw.js — shows lock-screen alerts from the radio. It only handles notifications;
// it never caches pages, so the app always loads fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || "Allen Radio", {
    body: d.body || "",
    tag: d.tag,
    renotify: true,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    requireInteraction: !!d.urgent,
    vibrate: d.urgent ? [400, 150, 400, 150, 400] : [150],
    data: { url: "/" },
  }));
});

// Tapping an alert opens the radio (or brings it to the front).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if ("focus" in w) return w.focus();
    return self.clients.openWindow("/");
  })());
});
