self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() ?? "Tenés una nueva notificación." };
  }

  const title = typeof payload.title === "string" ? payload.title : "Mi Turno Ya Reservado";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "Tenés una nueva notificación.",
    icon: "/logo.png",
    badge: "/logo.png",
    tag: typeof payload.tag === "string" ? payload.tag : "mi-turno-notification",
    data: {
      url: typeof payload.url === "string" ? payload.url : "/",
    },
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedPath = event.notification.data?.url;
  const targetUrl = new URL(
    typeof requestedPath === "string" && requestedPath.startsWith("/") ? requestedPath : "/",
    self.location.origin,
  );
  const safeTargetUrl =
    targetUrl.origin === self.location.origin ? targetUrl : new URL("/", self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existing) {
        return existing.navigate(safeTargetUrl.href).then(() => existing.focus());
      }
      return self.clients.openWindow(safeTargetUrl.href);
    }),
  );
});
