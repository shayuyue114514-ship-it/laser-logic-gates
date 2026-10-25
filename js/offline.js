// offline.js：页面一打开就静默登记离线缓存，用户不需要任何操作。
// 首次访问顺手把整站存进本地，之后断网也能立刻打开；版本号一变，浏览器自动发现并换新。
"use strict";

// 登记离线缓存：只在浏览器支持、且以网页方式打开时才做
// file:// 打开的页面没有登记资格，本地静态服务器以外的环境也不硬试，失败就当没这回事
function startOfflineCache() {
  if (!("serviceWorker" in navigator)) return;
  const onHttp = location.protocol === "https:" ||
    location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!onHttp) return;

  // updateViaCache 设为 none：每次打开都绕过 HTTP 缓存直接取 sw.js，部署完的下一次打开就能用上新版
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then(function (registration) {
      // 浏览器自己最多隔一天才查一次更新，这里主动再查一次，缩短「部署了但用户还是旧版」的窗口
      return registration.update();
    })
    .catch(function () {
      // 登记失败不影响正常使用：联网照常打开，只是没有离线副本
    });
}

startOfflineCache();
