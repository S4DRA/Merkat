/* Notifications only. Authenticated pages, API responses and chats are never cached. */
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
    typeof payload.title !== "string" ||
    typeof payload.body !== "string" ||
    typeof payload.href !== "string" ||
    !/^\/plans\?event=[a-f0-9-]{36}$/.test(payload.href)
  )
    return;
  event.waitUntil(
    self.registration.showNotification(payload.title.slice(0, 160), {
      body: payload.body.slice(0, 400),
      icon: "/icons/merkat-192.png",
      badge: "/icons/merkat-32.png",
      tag: "merkat:" + payload.id,
      data: { href: payload.href },
    }),
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
  if (event.data?.type === "MERKAT_SIGN_OUT")
    event.waitUntil(
      self.registration
        .getNotifications()
        .then((notifications) => notifications.forEach((n) => n.close())),
    );
});
