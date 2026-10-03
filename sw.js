const CACHE_NAME = 'smartdesk-v1';

// File di base da salvare in memoria locale sul tablet
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './README.md'
];

// 1. Inizializzazione: Salva tutti i file nella cache del tablet
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Archiviazione risorse per offline...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 2. Attivazione immediata del Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// 3. Gestione della rete e Offline First
self.addEventListener('fetch', (event) => {
  // Ignora le richieste dirette all'Agent WebSocket sulla porta 8765
  if (event.request.url.includes(':8765')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Se il file è presente in cache sul tablet, caricalo da lì
      if (cachedResponse) {
        return cachedResponse;
      }
      // Altrimenti prova a scaricarlo dalla rete (quando il PC è acceso)
      return fetch(event.request).catch(() => {
        // Se il laptop è spento (offline), mostra comunque index.html
        return caches.match('./index.html');
      });
    })
  );
});