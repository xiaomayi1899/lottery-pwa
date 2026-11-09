/* sw.js — v4：HTML/脚本/样式「在线优先、离线回退缓存」（更新即时生效）；
   图标/清单缓存优先；接口网络优先 + 运行时缓存兜底。
   注意：Service Worker 仅在 https 或 localhost 下注册。 */
const VER = "lph-v6c-20261109";
const SHELL_CACHE = "lph-shell-" + VER;
const API_CACHE = "lph-api-" + VER;
const SHELL = [
  "./",
  "./index.html",
  "./css/style.v6.css",
  "./js/engine.v6.js",
  "./js/app.v6.js",
  "./data/snapshot.v6.js",
  "./data/ssq.json",
  "./data/dlt.json",
  "./data/kl8.json",
  "./data/fc3d.json",
  "./data/p5.json",
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

  // HTML / 脚本 / 样式 / 数据：在线优先，离线才回退缓存 —— 保证线上更新即时到达
  const isDoc = req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/";
  const isCode = url.pathname.startsWith("/js/") || url.pathname.startsWith("/css/") || url.pathname.startsWith("/data/");
  if (isDoc || isCode) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || (isDoc ? caches.match("./index.html") : undefined))
        )
    );
    return;
  }

  // 其余（图标 / 清单 / 数据兜底）：缓存优先 + 后台更新
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
