// debug.js：调试面板与调色沙盒。
"use strict";

/* ========== 调试面板 ========== */

// 调试面板默认隐藏，避免干扰正常界面；需要时在控制台执行 debugPanel.show() 唤出
let debugPanelEl = null;      // HTMLElement：调试面板根节点
let debugPanelVisible = false; // boolean：面板当前是否可见

// 统一设置面板可见性：内联 display 覆盖 CSS 里的默认隐藏
function setDebugPanelVisible(visible) {
  debugPanelVisible = visible;
  debugPanelEl.style.display = visible ? "block" : "none";
  // 隐藏期间读数不刷新，重新显示时立刻补一次，否则刚打开的面板上挂的还是上次的旧数字
  if (visible) refreshPerfReadout();
}

// 对外接口：以后往面板里加别的调试控件（不限于 HSL）也从这个对象进出
window.debugPanel = {
  show: function () { setDebugPanelVisible(true); },
  hide: function () { setDebugPanelVisible(false); },
  toggle: function () { setDebugPanelVisible(!debugPanelVisible); },
  // 压力测试入口：一键铺满指定数量的元件，用来验证十万级规模下的帧率与交互
  // 用法：控制台执行 debugPanel.stress() 生成十万个，或 debugPanel.stress(200000) 指定数量
  stress: function (count) { runStressTest(count); }
};

// 逐层开关的对外入口：改完自动标脏，下一帧就按新开关重画
// 用法：perfLayers.set("lampGlow", true) 关掉灯光晕，改成 false 恢复
window.perfLayers = {
  skip: S.renderSkip,
  set: function (layer, on) { S.renderSkip[layer] = on; S.sceneDirty = true; }
};

/* ========== 压力测试 ========== */

// 元件类型轮转表：五种形状都摆出来，顺便让结算层真的有一批光源与门在动
const STRESS_TYPES = ["transmitter", "deflector", "inverter", "light", "lamp"];

// 一键生成大批元件：整批直写元件表，只在收尾重建一次索引、阻挡图与视野
// 为什么不逐个走正常放置流程：那样每放一个就记一步历史、标一次脏，十万次叠加起来光记账就卡死了
// 这里只调 placeElement 建数据（它本身只挂索引、置脏，不做别的），建完统一收口，开销集中在一次全表重建上
function runStressTest(count) {
  const n = Math.max(1, Math.floor(count || 100000));
  clearScene();   // 先清干净：压力测试要从一张空图起算，否则旧元件会与新阵列挤在同一格里
  const side = Math.ceil(Math.sqrt(n));   // 摆成正方阵，边长取平方根向上取整
  const half = Math.floor(side / 2);      // 阵列中心对齐世界原点，居中视野正好落在阵心
  for (let i = 0; i < n; i++) {
    const gx = (i % side) - half;          // 列号：逐行铺满，行内从左到右
    const gy = Math.floor(i / side) - half; // 行号：屏幕 Y 向下、世界 Y 向上，这里只是摆位，正负无关紧要
    const el = placeElement(gx + 0.5, gy + 0.5, i % 4, STRESS_TYPES[i % STRESS_TYPES.length]);
    el.on = (i % 997) === 0;   // 极少数光源打开：让结算层有链在传，又不至于把帧率读数整个盖住
  }
  rebuildCellIndex();    // 批量直写期间已逐条挂过索引，这里整张重建一次，保证与元件表完全对齐
  resetSimBuffers();     // 元件下标整批换过了，按旧下标存的发射表与接收表必须作废
  S.rayGraph.dirty = true; // 阻挡图留给下一微帧重建一趟，十万条也只重建这一次
  invalidateElementCache();  // 元件缓存位图整张作废，下一帧按新场景重画
  // 视野一步调到「整片阵列刚好装进视口」：不调的话默认缩放只看得到阵心一小块，看不出规模
  const vp = getViewport();
  const fit = Math.min(vp.w / side, vp.h / side) * 0.95;   // 留 5% 余量，边缘那圈元件不会被视口切掉
  const scale = Math.min(CONFIG.maxScale, Math.max(CONFIG.minScale, fit));  // 夹在缩放上下限内，与滚轮那一套保持一致
  state.scale = scale;
  state.logScale = Math.log(scale);
  state.tLogScale = state.logScale;   // 目标与当前相等：视野直接到位，不走平移动画
  state.anchorWX = 0;                 // 参考点取世界原点，也就是阵列中心
  state.anchorWY = 0;
  state.anchorSX = vp.x + vp.w / 2;   // 参考点的屏幕位置取视口正中，横向基准要用视口左边而不是窗口左边
  state.anchorSY = vp.y + vp.h / 2;
  state.tAnchorSX = state.anchorSX;   // 目标与当前相等，不产生平移动画
  state.tAnchorSY = state.anchorSY;
  S.sceneDirty = true;  // 强制下一帧重绘，否则静止判定可能直接跳过这一帧
  console.log("[压力测试] 已生成 " + n + " 个元件，阵列 " + side + " × " + side + " 格，缩放 " + scale.toFixed(2));
}

// 底板配色的 HSL 编辑器入口：唤出的就是上面这个调试面板，底板那组滑块在里面
// 单开一个入口是因为底板色属于界面而不是元件，调用点上写 panelColor.show() 比 debugPanel.show() 更明确
window.panelColor = {
  show: function () { setDebugPanelVisible(true); },
  hide: function () { setDebugPanelVisible(false); },
  toggle: function () { setDebugPanelVisible(!debugPanelVisible); }
};

/* ========== 性能读数 ========== */

// 统计窗口长度（毫秒）：250 毫秒约合 15 帧，数字跟得上操作，又不会每帧都跳得看不清
const PERF_WINDOW_MS = 250;

// 长于这个值的帧间隔不计入统计：切回标签页、拖动窗口这类空档不代表真实性能，算进去会把帧率拉垮
const PERF_MAX_GAP_MS = 200;

// 缓存读数区那几个 DOM 引用；面板即使隐藏着它们也存在，写一次文本的代价可以忽略
function setupPerfReadout() {
  S.perfDom = {
    fps: document.getElementById("perfFps"),
    interval: document.getElementById("perfFrame"),
    script: document.getElementById("perfScript"),
    total: document.getElementById("perfTotal"),
    drawn: document.getElementById("perfDrawn"),
    culled: document.getElementById("perfCulled"),
    scale: document.getElementById("perfScale")
  };
}

// 把最新读数写进面板
// 面板没显示时整个跳过：读数只在需要看的时候才付出写 DOM 的代价
function refreshPerfReadout() {
  if (S.perfDom === null || !debugPanelVisible) return;
  S.perfDom.fps.textContent = S.perfFps.toFixed(1);
  S.perfDom.interval.textContent = S.perfIntervalMs.toFixed(1) + "ms";
  S.perfDom.script.textContent = S.perfScriptMs.toFixed(2) + "ms";
  S.perfDom.total.textContent = S.elements.length;
  S.perfDom.drawn.textContent = S.drawnElementCount;
  S.perfDom.culled.textContent = S.culledElementCount;
  S.perfDom.scale.textContent = state.scale.toFixed(1);
}

// 把本帧计入统计窗口，窗口攒满就结算一次读数并刷新面板
// nowMs 用主循环拿到的 rAF 时间戳，它才是真正的帧间隔；scriptMs 是本帧全部脚本逻辑的耗时
// 分开统计两件事的原因：帧间隔说明「浏览器给到多少帧」，脚本耗时说明「其中你占用了多少」，两者一起看才知道有没有优化空间
function accumulatePerf(nowMs, scriptMs) {
  const gap = S.perfLastTs > 0 ? nowMs - S.perfLastTs : 0;
  S.perfLastTs = nowMs;
  // 空档帧与首帧整帧丢掉：它们不代表稳态，算进去会让读数忽高忽低
  if (gap > 0 && gap < PERF_MAX_GAP_MS) {
    S.perfWinFrames++;
    S.perfWinMs += gap;
    S.perfWinScriptMs += scriptMs;
  }
  if (S.perfWinFrames === 0 || S.perfWinMs < PERF_WINDOW_MS) return;
  S.perfFps = S.perfWinFrames * 1000 / S.perfWinMs;
  S.perfIntervalMs = S.perfWinMs / S.perfWinFrames;
  S.perfScriptMs = S.perfWinScriptMs / S.perfWinFrames;
  S.perfWinFrames = 0;
  S.perfWinMs = 0;
  S.perfWinScriptMs = 0;
  refreshPerfReadout();
}

// 颜色换算那六个函数（hslCss、mixHsl、mixHslTriple、hslToRgb、mixRgb、rgbCss）已整体移到 util.js
// 原因：config.js 在加载时就要用 hslToRgb 预先算出常态色、亮起色、选中色的 RGB 端点，
// 而 config.js 排在加载顺序第一位、本文件排在第十七位，函数留在这里会让整个页面在加载阶段就报错。
// 它们本来就是通用工具而不是调试面板的东西，所以搬去 util.js，并把 util.js 提到最前面加载。

// 把配色朝白色提亮 k（0 原色、1 全白）：只抬亮度、顺手压一点饱和度，色相不动
// 这样不管用户把设置按钮调成什么颜色，亮态都还是同一个色系，不会变成另一种颜色
function hslLit(c, k) {
  const l = c.l + (100 - c.l) * k;
  const s = c.s * (1 - k * 0.25);
  return "hsl(" + c.h + ", " + s + "%, " + l + "%)";
}

// 初始化调试面板：只缓存面板节点、接上性能读数，面板保持隐藏
// 面板里的调色滑块已全部删除，配色回到代码里的固定值，不再有取色沙盒
function setupDebugPanel() {
  debugPanelEl = document.getElementById("debugPanel");
  setupPerfReadout();  // 读数区的 DOM 引用与面板一起缓存，读数是面板的第一组内容
}

