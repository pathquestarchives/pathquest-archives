// ============================================================
// PathQuest Archives Service Worker
// Responsibilities:
//   1. Cache app shell (HTML, CSS, JS, icons) on install
//   2. Cache map tiles as they are fetched (tile cache)
//   3. Queue Firestore writes when offline, replay on reconnect
//   4. Persist offline queue to IndexedDB (survives SW kill on iOS)
// ============================================================

const SHELL_CACHE  = "pqa-shell-v3";
const TILE_CACHE   = "pqa-tiles-v3";
const QUEUE_KEY    = "pqa-offline-queue";

// App shell files to precache on install
const SHELL_FILES = [
  "/",
  "/index.html",
  "/manifest.json",
  "/app.js",
  "/style.css",
  "/styles/trail-effects.css",
  "/icons/compass-arrow.png",
  "/icons/checkpoint.png",
  "/icons/route-start.png",
  "/icons/route-end.png",
  "/icons/user-dot.png",
  "/icons/flag-mini.svg",
  "/icons/flag1.svg",
  "/icons/flag2.svg",
  "/icons/flag3.svg",
  "/icons/flag4.svg",
  "/icons/flag-gold1.svg",
  "/icons/flag-gold2.svg",
  "/icons/flag-gold3.svg",
  "/icons/flag-gold4.svg",
  "/audio/checkpoint-found.mp3",
  "/audio/page-flip.mp3",
  "/audio/parchment-open.mp3",
  "/textures/old-book-bg.png",
  "/textures/old-note-bg.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

// Tile hostnames to intercept and cache
const TILE_HOSTS = [
  "tile.openstreetmap.org",
  "a.tile.openstreetmap.org",
  "b.tile.openstreetmap.org",
  "c.tile.openstreetmap.org"
];

// ── INDEXEDDB: persist offline queue (survives SW kill on iOS) ──
const DB_NAME    = "pqa-offline";
const DB_STORE   = "queue";
const DB_KEY     = "writes";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadQueue() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function saveQueue(queue) {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(queue, DB_KEY);
  } catch {
    // non-critical — queue stays in memory
  }
}

// In-memory queue (synced to IndexedDB)
let offlineQueue = [];

// ── INSTALL: precache shell ──────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Use individual adds so one missing file doesn't break everything
      Promise.allSettled(SHELL_FILES.map(f => cache.add(f)))
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean up old caches + load persisted queue ─────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter(k => k !== SHELL_CACHE && k !== TILE_CACHE)
            .map(k => caches.delete(k))
        )
      ),
      loadQueue().then((q) => { offlineQueue = q; })
    ]).then(() => self.clients.claim())
  );
});

// ── FETCH: serve from cache, fall back to network ───────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Map tiles — cache-first with network fallback
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(tileStrategy(event.request));
    return;
  }

  // 2. Firebase / Google APIs — network only (never cache auth/Firestore)
  if (
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("firebaseapp.com") ||
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("identitytoolkit.googleapis.com") ||
    url.hostname.includes("gstatic.com")
  ) {
    return; // let browser handle it normally
  }

  // 3. CDN scripts (Leaflet etc) — cache-first
  if (url.hostname === "unpkg.com") {
    event.respondWith(cdnStrategy(event.request));
    return;
  }

  // 4. App shell — network-first with cache fallback
  event.respondWith(shellStrategy(event.request));
});

// ── STRATEGIES ───────────────────────────────────────────────

// Tiles: cache first, then network, store new tiles
async function tileStrategy(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not cached — return a transparent 1px PNG placeholder
    return new Response(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="),
      { headers: { "Content-Type": "image/png" } }
    );
  }
}

// CDN: cache first, network fallback
async function cdnStrategy(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// Shell: network first, cache fallback
async function shellStrategy(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Last resort: return index.html for navigation requests
    if (request.mode === "navigate") {
      return cache.match("/index.html");
    }
    return new Response("Offline", { status: 503 });
  }
}

// ── OFFLINE WRITE QUEUE ──────────────────────────────────────
// app.js posts messages here when a Firestore write fails offline.
// On reconnect, app.js sends a "flush-queue" message and we reply
// with the queued writes so app.js can replay them.
// Queue is persisted to IndexedDB so it survives SW kill on iOS.

self.addEventListener("message", (event) => {
  if (event.data?.type === "queue-write") {
    offlineQueue.push(event.data.payload);
    saveQueue(offlineQueue); // persist asynchronously (fire-and-forget)
  }

  if (event.data?.type === "flush-queue") {
    event.source.postMessage({ type: "queued-writes", writes: offlineQueue });
    offlineQueue = [];
    saveQueue([]); // clear persisted queue
  }
});