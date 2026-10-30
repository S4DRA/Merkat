/* Public assets only. Never cache authenticated HTML, API JSON or private media. */
const PUBLIC_CACHE = "merkat-public-20261030-1";
const PUBLIC_ASSETS = [
  "/offline.html",
  "/icons/merkat-192.png",
  "/icons/merkat-512.png",
  "/icons/merkat-180.png",
  "/icons/merkat-32.png",
  "/brand/merkat-white-transparent.png",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PUBLIC_CACHE)
      .then((cache) =>
        cache.addAll(
          PUBLIC_ASSETS.map(
            (url) => new Request(url, { cache: "reload", credentials: "omit" }),
          ),
        ),
      ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) =>
                  key.startsWith("merkat-public-") && key !== PUBLIC_CACHE,
              )
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        async () =>
          (await caches.match("/offline.html")) ??
          new Response("Offline. Reconnect to use Merkat.", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );
  } else if (
    url.pathname.startsWith("/_next/static/") ||
    (PUBLIC_ASSETS.includes(url.pathname) && !url.search)
  ) {
    event.respondWith(
      caches.open(PUBLIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type === "basic")
          await cache.put(request, response.clone());
        return response;
      }),
    );
  }
});
self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }
  if (
    !payload ||
    typeof payload.id !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.title !== "string" ||
    typeof payload.body !== "string" ||
    typeof payload.href !== "string" ||
    !/^\/plans\?event=[a-f0-9-]{36}$/.test(payload.href)
  )
    return;
  event.waitUntil(
    (async () => {
      // A delayed provider message must not disclose account A's content after
      // logout or a switch to account B. Verification is network-only/fail-closed.
      try {
        const response = await fetch("/api/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) return;
        const session = await response.json();
        if (session.user?.id !== payload.userId) return;
      } catch {
        return;
      }
      await self.registration.showNotification(payload.title.slice(0, 160), {
        body: payload.body.slice(0, 400),
        icon: "/icons/merkat-192.png",
        badge: "/icons/merkat-32.png",
        tag: "merkat:" + payload.id,
        data: { href: payload.href },
      });
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href;
  if (typeof href !== "string" || !/^\/plans\?event=[a-f0-9-]{36}$/.test(href))
    return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const target = new URL(href, self.location.origin).href;
        for (const client of windows) {
          if (new URL(client.url).origin === self.location.origin) {
            await client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "MERKAT_ACTIVATE_UPDATE") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type === "MERKAT_SIGN_OUT")
    event.waitUntil(
      self.registration
        .getNotifications()
        .then((notifications) => notifications.forEach((n) => n.close())),
    );
});
