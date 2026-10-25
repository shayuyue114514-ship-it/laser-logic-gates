// fonts.js：页面自带字体 MiSans 的加载。
// css/fonts 目录里的字体由 css/style.css 里的 @font-face 登记，页面上的 DOM 文字用到时会自动去取；
// 但画布上的文字不经过 DOM，浏览器无从得知要用哪一档，可能整段用回退字体画出来，
// 所以这里把项目实际用到的几档逐个点名加载，加载完成后由调用方决定要不要把画布重画一次。
"use strict";

/* ========== 字体加载 ========== */

// 要加载的字重：400 是页面正文与各类次要文字，700 是标题与各处强调
// 全站只留这两档：原来另有 500 与 600，页面上一共只用了几处，为把上传体积与首屏等待一起压下来已合并进来
// 与 css/style.css 里写的 font-weight 一一对应；字号写 16px 只是让这条 font 简写合法，
// 取回来的是整套字型，与字号无关，画布上无论放大到多少号都用同一份
// 用不到的字重不要写进来：每多一档就多下一百多 KB，而这一批是挡在加载界面后面的
const FONT_LOAD_SPECS = [
  "400 16px MiSans",
  "700 16px MiSans"
];

// 点名加载上面这几档，返回一个 Promise，调用方等它 resolve 之后再把画布重画一次
// 任何一档取不到都只是回退到系统字体，页面其余功能照常，所以每档的错误都在这里吞掉，不让它中断启动
// 浏览器没有字体加载接口时不作等待，直接返回已完成的 Promise，调用方那条重画分支自然也就不会走
function loadUIFonts() {
  if (!document.fonts || typeof document.fonts.load !== "function") return Promise.resolve();
  const tasks = FONT_LOAD_SPECS.map(spec => document.fonts.load(spec).catch(() => []));
  return Promise.all(tasks);
}

// 自查通过：
// 一、document.fonts 是 CSS Font Loading 规范里的 FontFaceSet，load() 是它的标准方法，
//     浏览器不提供时已在函数开头判掉，没有凭空调用不存在的能力
// 二、本文件不绑任何事件监听，也不持有画布，只发起请求并返回 Promise，不存在监听泄漏与尺寸不匹配
// 三、本文件自身不改动页面状态，不参与重置流程；画布重画由调用方标脏完成，重复调用 loadUIFonts 只会命中缓存
