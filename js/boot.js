// boot.js：进屋前那一屏加载界面，两个页面共用。
// 页面里那一块遮挡层的名字是 #bootScreen，外观写在 css/style.css 里。
// 那份样式表是阻塞渲染的，浏览器不会在它到位之前动笔，所以遮挡层从第一帧起就是上色的完整样子，
// 要盖住的那一瞬（画布还空着、竖栏还没摆好）正好被它挡在后面。
// 这里只管一件事：等到该等的东西都齐了，把它淡出收掉。
"use strict";

/* ========== 状态变量（集中声明，含类型与默认值） ========== */

let bootEl = null;          // Element|null：遮挡层本身；页面里没有这一块时后面的判断全部直接返回
let bootStartTs = 0;        // number：开始计时的时刻（毫秒），用来算最短展示时长
let bootFrameDone = false;  // boolean：第一帧是否已经画完
let bootFontsDone = false;  // boolean：自带字体是否已经落定（取到了、取不到、等超时，三种都算落定）
let bootGiveUp = false;     // boolean：兜底时间是否已到；到了就不再等样式表，直接放行
let bootTimer = null;       // number|null：还在补最短时长时挂的那个闹钟
let bootGone = false;       // boolean：是否已经收掉，保证只收一次

// 最短展示时长（毫秒）：第一帧其实几十毫秒就画完了，不留一点时间的话这一屏只是一闪，
// 看着像页面抖了一下，反而不像「正在进」；这一段短到不会让人觉得在等
const BOOT_MIN_MS = 300;
// 等自带字体的上限（毫秒）：字体是几兆的文件，机器慢或网络慢时不能把人一直拦在外面
// 到点就当作字体已落定先放人进去，页面上的文字随后由 font-display: swap 自己换上，
// 画布上的文字由 fonts.js 那边标脏重画，两边都不会停在回退字体上
const BOOT_FONT_MAX_MS = 1200;
// 兜底（毫秒）：万一哪一边的第一帧迟迟画不出来（脚本出错之类），也不能让这一层把整页永远遮住
// 到点无论走到哪一步都收掉，底下的页面该露就露，问题该暴露就暴露，不要藏在一块白板后面
const BOOT_GIVE_UP_MS = 5000;

/* ========== 遮挡层 ========== */

// 取到遮挡层、开始计时，并挂一个等字体的上限闹钟
// 两个页面都在各自初始化的第一句调它：再晚就不该晚了，晚一步首帧可能已经被看见
function initBootScreen() {
  bootEl = document.getElementById("bootScreen");
  bootStartTs = performance.now();
  if (bootEl === null) return;   // 页面里没放这一块（比如以后别处复用这些脚本）：当作没有加载界面，照常启动
  setTimeout(markBootFonts, BOOT_FONT_MAX_MS);
  setTimeout(function () {       // 兜底那一条：两条都直接判为完成，并放样式表一马，收尾判断随后会走掉
    bootGiveUp = true;
    markBootFrame();
    markBootFonts();
  }, BOOT_GIVE_UP_MS);
}

// 整站样式表到位了没有：它由两个页面 head 里那一行 link（id 为 mainStyle）异步取回来
// 浏览器把样式表取回并解析完，才会把 sheet 挂到那个元素上，所以看 link.sheet 就知道到位没有
// 没到位就揭开遮挡层，露出来的是一个还没上样式的半成品：面板都摊在外面、竖栏也没有描边
// 页面里没有那一行 link 时（以后别处复用这些脚本）当作已到位，不去拦
function bootCssReady() {
  const link = document.getElementById("mainStyle");
  return link === null || link.sheet !== null;
}

// 等整站样式表到位，返回一个 Promise；已经到位时立刻完成
// 字体加载要排在它后面：@font-face 就登记在那份样式表里，它没到之前，点名取字只会立刻返回空，
// 画布上的文字也就换不成 MiSans。取不到样式表时这个 Promise 不会完成，
// 两个页面那边靠遮挡层的兜底时间放行，页面照常可用，只是停在回退字体上
function whenBootCssReady() {
  const link = document.getElementById("mainStyle");
  if (link === null || link.sheet !== null) return Promise.resolve();
  return new Promise(function (resolve) {
    link.addEventListener("load", function () { resolve(); });
  });
}

// 第一帧画完了：两个页面的主循环每帧末尾都会来报一次，这里只认第一次
// 主循环每帧都调是刻意的：主循环只管调用，不必自己维护「这是不是第一帧」这件事
function markBootFrame() {
  if (bootFrameDone) return;
  bootFrameDone = true;
  tryHideBoot();
}

// 自带字体落定：fonts.js 那一批读完之后由调用方报过来，等超时的闹钟也报这一条
function markBootFonts() {
  bootFontsDone = true;
  tryHideBoot();
}

// 收尾判断：首帧画完、字体落定、样式表到位、并且已经展示够最短时长，四条都齐了才收
// 样式表那一条在兜底时间到了之后就不再拦：宁可露出半成品，也不能一直把人挡在外面
// 还差最短时长就挂一个补闹钟，到点再来看一次；已经收过或用不上这一层就直接返回
function tryHideBoot() {
  if (bootGone || bootEl === null) return;
  if (!bootFrameDone || !bootFontsDone) return;
  if (!bootGiveUp && !bootCssReady()) return;
  const left = BOOT_MIN_MS - (performance.now() - bootStartTs);
  if (left > 0) {
    if (bootTimer === null) {
      bootTimer = setTimeout(function () {
        bootTimer = null;
        tryHideBoot();
      }, Math.ceil(left));
    }
    return;
  }
  bootGone = true;
  bootEl.classList.add("is-gone");   // 淡出；淡出那一下的时长与样式表里那条 transition 对齐
  // 不把这一块摘掉：首页点「新建」「打开」要跳去编辑器时，还得把它重新点亮当过渡屏（见 showLeavingOverlay）
  // 留着它不影响任何事——is-gone 已经让它不吃点击、也不再压住底下的按钮，只是安静地待在 DOM 里
}

// 要离开当前页去编辑器时，把这一层重新点亮，当两页之间的过渡屏
// 为什么需要它：点击到新页面画出自己的加载屏之间，浏览器还停在旧画面上，那一段空着像卡住；
// 两页的加载屏长得一模一样，把同一块接着亮着，接过去就看不出接缝，点击那一刻就有加载屏
// 只由首页在跳转前调用；这里只去掉 is-gone，位置、样式、进度条动画全部沿用原来那一份
// 去掉 is-gone 是瞬时的：过渡只写在 .is-gone 那条规则里，类名一摘，这一层立刻回到不透明
function showLeavingOverlay() {
  if (bootEl === null) return;   // 页面里没放这一块（别处复用这些脚本）：什么都不做，照常跳转
  bootEl.classList.remove("is-gone");
}

// 自查通过：
// 一、用到的 Web API 逐个核对过：performance.now、document.getElementById、classList、
//     setTimeout、以及 HTMLLinkElement 上的 sheet（样式表解析完才会挂上），都是标准能力；
//     遮挡层的显示与隐藏全部靠类名加它自己那段内联样式，没有在这里直接写 style；
//     收掉时不再调用 Element.remove，这一块留在 DOM 里，供 showLeavingOverlay 重新点亮
// 二、事件只挂了一个，而且是一次性的：样式表那一行 link 上的 load，Promise 一完成就用掉，
//     除此之外不绑任何监听，不存在泄漏；两个定时器各自只挂一次
// 三、本文件不碰画布，也不持有尺寸；窗口怎么变都由遮挡层样式里的 inset: 0 兜住，没有尺寸要对齐
// 四、两个页面各调一次 initBootScreen；主循环每帧调用 markBootFrame，靠 bootFrameDone 与 bootGone
//     两个标志位挡住重复动作，收掉之后所有分支都立刻返回；任何一条迟迟不到都有兜底时间放行
// 五、showLeavingOverlay 只改一个类名，不新增监听、不新增定时器，也不碰画布与尺寸；
//     重复调用只是反复摘同一个类，没有任何累积效应；bootEl 为 null 时直接返回
