/* sw.js — 离线缓存：应用壳 cache-first + 后台更新；接口 network-first + 运行时缓存兜底
   注意：Service Worker 仅在 https 或 localhost 下注册（iOS 局域网 http 打开时自动跳过） */
const VER = "lph-v3-20261105";
const SHELL_CACHE = "lph-shell-" + VER;
const API_CACHE = "lph-api-" + VER;
const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/engine.js",
  "./js/jc-core.js",
  "./js/app.js",
  "./data/snapshot.js",
  "./data/ssq.json",
  "./data/dlt.json",
  "./data/jc.json",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) =>
      Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: "reload" }))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 官方接口直连不拦

  const isApi = url.pathname.startsWith("/api/") || url.pathname === "/qr.png";

  if (isApi) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(API_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) =>
            hit || new Response(JSON.stringify({ error: "离线且无缓存" }), {
              status: 503,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            })
          )
        )
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const fetching = fetch(req).then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || fetching;
    })
  );
});
