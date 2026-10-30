// Registers the service worker that keeps BotBench working without a connection.
// Not in dev, and not on localhost, where a cached copy only gets in the way.
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

if (!import.meta.env.DEV && !local && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline mode is a bonus, the site works without it */ });
  });
}
