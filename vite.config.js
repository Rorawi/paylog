import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';

function paylogPwa() {
  return {
    name: 'paylog-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      const precacheUrls = [...new Set([
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/icons/paylog.svg',
        '/icons/paylog-192.png',
        '/icons/paylog-512.png',
        ...Object.values(bundle)
          .filter((file) => file.fileName !== 'sw.js')
          .map((file) => `/${file.fileName}`),
      ])];
      const version = createHash('sha1').update(precacheUrls.join('\n')).digest('hex').slice(0, 10);
      const worker = `
const CACHE_NAME = 'paylog-shell-${version}';
const PRECACHE_URLS = ${JSON.stringify(precacheUrls)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('paylog-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) await (await caches.open(CACHE_NAME)).put(request, response.clone());
        return response;
      } catch {
        return (await caches.match(request)) || (await caches.match('/index.html'));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
  })());
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker });
    },
  };
}

export default defineConfig({
  plugins: [react(), paylogPwa()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@supabase/')) return 'supabase';
        },
      },
    },
  },
});
