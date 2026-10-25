// sw-template.js：离线缓存脚本的模板，由 tools/build-dist.py 填出版本号后写成 dist/sw.js。
// 不要直接把这个文件当 sw.js 部署：里面的 __APP_VERSION__ 没被替换时缓存库名永远不变，更新也就永远发现不了。
// 之所以要单独生成一份，是因为浏览器判定「有没有新版」看的是 sw.js 自身的字节：版本号必须写进这份脚本里。
"use strict";

// 版本号取自 js/config.js 的 appVersion，同时充当缓存库的名字。
// 部署时版本号一动，这份脚本的字节就跟着变，浏览器才会重新下载下面的清单并删掉旧缓存。
const VERSION = "__APP_VERSION__";
const CACHE = "laser-gate-" + VERSION;
const CACHE_PREFIX = "laser-gate-";

// 预缓存清单：两个页面、样式表、两档字体、两份压缩脚本，就是整站的全部文件。
// 缓存齐了之后，断网打开也能完整看到画面，不用等网络。
const ASSETS = [
  "/",
  "/editor",
  "/css/style.css",
  "/css/fonts/MiSans-Regular.woff2",
  "/css/fonts/MiSans-Bold.woff2",
  "/favicon.svg",
  "/js/home.min.js",
  "/js/editor.min.js"
];

// 安装：把清单一次性存进本版本的缓存库，存好就接班，不等旧标签页关掉
// 逐个存而不是整批存：某一个文件没拿到，不至于让整份离线缓存全部作废
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        return Promise.all(ASSETS.map(function (path) {
          return cache.add(path).catch(function () { return null; });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

// 激活：只留本版本的缓存库，同前缀的旧库整个删掉；再把已打开的标签页接管过来
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE) return caches.delete(key);
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// 取文件：页面本身先问网络（联网时拿到最新那一版），拿不到就回缓存；
// 其它文件先回缓存、后台顺手更新，所以断网打开是瞬时的，联网时下次打开自动换新。
self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 打开页面：网络优先；断网时退回缓存，缓存里也没有就退回首页
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(function () {
        return caches.match(request).then(function (hit) {
          return hit || caches.match("/");
        });
      })
    );
    return;
  }

  // 静态文件：缓存优先，命中后同时在后台拉一次新的写回缓存
  event.respondWith(
    caches.match(request).then(function (hit) {
      const fresh = fetch(request).then(function (response) {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () { return hit; });
      return hit || fresh;
    })
  );
});
