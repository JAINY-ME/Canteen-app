self.addEventListener("push", function (event) {
  let payload = {};
  try {
    payload = event.data.json();
  } catch (e) {
    payload = {
      title: "Notification",
      body: event.data ? event.data.text() : "You have a new message",
    };
  }

  const title =
    payload.notification && payload.notification.title
      ? payload.notification.title
      : payload.title || "Notification";
  const options = {
    body:
      (payload.notification && payload.notification.body) ||
      payload.body ||
      payload.message ||
      "",
    data: payload.data || {},
    icon: "/images/icon-192.png",
    badge: "/images/icon-72.png",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const url =
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "/";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    }),
  );
});
