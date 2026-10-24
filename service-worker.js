// Retires the service worker left on phones by the old Allen Field Radio (V3.5), which lived
// at this address and kept showing its cached copy. Browsers re-check this file on their own;
// when they load it, it clears the old caches, unregisters itself and reloads open tabs.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
  })());
});
