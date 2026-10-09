// worker.js：静态资源前面的一道关卡：只放行页面内发起的脚本与样式请求，
// 把「直接在地址栏输入 js、css 网址」这类访问拦掉。
// 它不是安全手段：浏览器必须下载脚本才能执行，开发者工具里始终看得到内容，
// 用 curl 之类工具也不会带下面判断用的请求头，所以它只提高闲逛式访问的门槛。
"use strict";

// 这几个 Sec-Fetch-Dest 取值都表示浏览器把目标当成页面本身在打开：
// 地址栏直接回车是 document，被别的页面用 iframe 嵌进来是 iframe。
// 而页面里 <script> 发起时是 script，<link rel=stylesheet> 发起时是 style，都要放行。
const NAVIGATION_DESTS = ["document", "iframe", "embed", "object"];

export default {
  async fetch(request, env) {
    const dest = request.headers.get("Sec-Fetch-Dest");
    if (NAVIGATION_DESTS.includes(dest)) {
      // 回 404 而不是 403：不告诉访问者这个文件其实存在，只给出「没有这个地址」一个信息
      return new Response("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
    // 其余请求原样交给静态资源，路径处理与未命中时的规则仍由它负责
    return env.ASSETS.fetch(request);
  }
};
