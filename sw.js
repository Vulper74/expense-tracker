// Lets the app open without a connection. Every file is fetched fresh when
// online and kept as a copy; offline, the copy is used. Your data isn't here:
// it lives in the browser's storage and never goes through this file.

const CACHE = 'expense-tracker-v3';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'js/accounts.js', 'js/accounts-view.js', 'js/app.js', 'js/banks.js', 'js/budgets.js', 'js/budgets-view.js', 'js/categorize.js',
  'js/charts.js', 'js/csv.js', 'js/currency.js', 'js/dashboard-view.js', 'js/fire.js', 'js/fire-view.js', 'js/flat-view.js',
  'js/import-view.js', 'js/importer.js', 'js/ledger.js', 'js/recurring.js', 'js/settings-view.js', 'js/setup.js', 'js/stats.js', 'js/storage.js',
  'js/transactions-view.js', 'js/util.js', 'js/xlsx.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request, { ignoreSearch: true })
      .then((hit) => hit ?? (request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
