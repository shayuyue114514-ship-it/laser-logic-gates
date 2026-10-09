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
  toggle: function () { setDebugPanelVisible(!debugPanelVisible); }
};

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
  perfDom = {
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
  if (perfDom === null || !debugPanelVisible) return;
  perfDom.fps.textContent = perfFps.toFixed(1);
  perfDom.interval.textContent = perfIntervalMs.toFixed(1) + "ms";
  perfDom.script.textContent = perfScriptMs.toFixed(2) + "ms";
  perfDom.total.textContent = elements.length;
  perfDom.drawn.textContent = drawnElementCount;
  perfDom.culled.textContent = culledElementCount;
  perfDom.scale.textContent = state.scale.toFixed(1);
}

// 把本帧计入统计窗口，窗口攒满就结算一次读数并刷新面板
// nowMs 用主循环拿到的 rAF 时间戳，它才是真正的帧间隔；scriptMs 是本帧全部脚本逻辑的耗时
// 分开统计两件事的原因：帧间隔说明「浏览器给到多少帧」，脚本耗时说明「其中你占用了多少」，两者一起看才知道有没有优化空间
function accumulatePerf(nowMs, scriptMs) {
  const gap = perfLastTs > 0 ? nowMs - perfLastTs : 0;
  perfLastTs = nowMs;
  // 空档帧与首帧整帧丢掉：它们不代表稳态，算进去会让读数忽高忽低
  if (gap > 0 && gap < PERF_MAX_GAP_MS) {
    perfWinFrames++;
    perfWinMs += gap;
    perfWinScriptMs += scriptMs;
  }
  if (perfWinFrames === 0 || perfWinMs < PERF_WINDOW_MS) return;
  perfFps = perfWinFrames * 1000 / perfWinMs;
  perfIntervalMs = perfWinMs / perfWinFrames;
  perfScriptMs = perfWinScriptMs / perfWinFrames;
  perfWinFrames = 0;
  perfWinMs = 0;
  perfWinScriptMs = 0;
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

// 把一组配色写到面板里对应的色块与色值文本上；group 是 paletteUI 里的那一组 DOM 引用
function refreshSwatch(group, c) {
  const css = hslCss(c);
  group.sw.style.background = css;
  group.code.textContent = css;
}

// 让所有已放置元件的配色缓存作废：元件配色在渲染时按当前色值现算，这里只把缓存键清掉逼下一帧重算
// 元件已不再挂 SVG 节点，所以不再逐个写节点属性，改配色只需让缓存失效
function applyElementColors() {
  for (let i = 0; i < elements.length; i++) {
    // 缓存键作废：若缓存还留着旧进度，下一帧会以为配色没变而跳过重算，颜色改了也不显示
    elements[i].litK = -1;
  }
  sceneDirty = true;  // 配色变了要重绘；否则静止判定会认为画面没变
}

// 把元件那两组沙盒配色写到面板里的色块与色值文本；元件实际颜色固定取 elementHSL，这里只刷新显示
function refreshElementColorUI() {
  if (paletteUI === null) return;
  refreshSwatch(paletteUI.fill, elementSandbox.fill);
  refreshSwatch(paletteUI.stroke, elementSandbox.stroke);
}

// 把一组 H/S/L 滑块接到一个配色对象上：target 直接是 {h,s,l}，prefix 是这组滑块的 id 前缀
// onChange 在每次拖动后调用；现在八组接的都是沙盒，所以它只负责把新值刷到面板显示上
function bindHSLGroup(target, prefix, onChange) {
  const parts = ["h", "s", "l"];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const slider = document.getElementById(prefix + part.toUpperCase());
    // 滑块初值取当前配色，保证面板显示和实际颜色一致
    slider.value = target[part];
    // input 事件在拖动过程中连续触发，配色实时跟随
    slider.addEventListener("input", function () {
      target[part] = Number(slider.value);
      onChange();
    });
  }
}

// 把沙盒配色写到面板里的色块与色值文本；底板实际颜色取 COLOR.panelFill，这里只刷新显示
function refreshPanelColorUI() {
  if (paletteUI === null) return;
  refreshSwatch(paletteUI.panel, panelHSL);
}

// 把槽填充的沙盒配色写到面板里的色块与色值文本；槽实际填充取 COLOR.slotFill，这里只刷新显示
function refreshSlotColorUI() {
  if (paletteUI === null) return;
  refreshSwatch(paletteUI.slot, slotHSL);
}

// 把设置那四组沙盒配色写到面板里的色块与色值文本；画面颜色固定取 settingsHSL，这里只刷新显示
// 所以拖这四组滑块不会改动画面上任何东西，纯粹是取色参考
function refreshSettingsColorUI() {
  if (paletteUI === null) return;
  refreshSwatch(paletteUI.gearFill, settingsSandbox.gearFill);
  refreshSwatch(paletteUI.gearStroke, settingsSandbox.gearStroke);
  refreshSwatch(paletteUI.setFill, settingsSandbox.slotFill);
  refreshSwatch(paletteUI.setStroke, settingsSandbox.slotStroke);
}

// 初始化调试面板：缓存根节点与色块引用、绑定四组滑块、同步一次显示（面板保持隐藏）
function setupDebugPanel() {
  debugPanelEl = document.getElementById("debugPanel");
  setupPerfReadout();  // 读数区的 DOM 引用与面板一起缓存，读数是面板的第一组内容
  paletteUI = {
    fill: {
      sw: document.getElementById("swFill"),
      code: document.getElementById("codeFill")
    },
    stroke: {
      sw: document.getElementById("swStroke"),
      code: document.getElementById("codeStroke")
    },
    panel: {
      sw: document.getElementById("swPanel"),
      code: document.getElementById("codePanel")
    },
    slot: {
      sw: document.getElementById("swSlot"),
      code: document.getElementById("codeSlot")
    },
    gearFill: {
      sw: document.getElementById("swGearFill"),
      code: document.getElementById("codeGearFill")
    },
    gearStroke: {
      sw: document.getElementById("swGearStroke"),
      code: document.getElementById("codeGearStroke")
    },
    setFill: {
      sw: document.getElementById("swSetFill"),
      code: document.getElementById("codeSetFill")
    },
    setStroke: {
      sw: document.getElementById("swSetStroke"),
      code: document.getElementById("codeSetStroke")
    }
  };
  // 面板里八组滑块现在全是取色沙盒：拖动只改色块与色值文本，画面颜色一律取各自的固定配色
  bindHSLGroup(elementSandbox.fill, "fill", refreshElementColorUI);
  bindHSLGroup(elementSandbox.stroke, "stroke", refreshElementColorUI);
  bindHSLGroup(panelHSL, "panel", refreshPanelColorUI);
  bindHSLGroup(slotHSL, "slot", refreshSlotColorUI);
  bindHSLGroup(settingsSandbox.gearFill, "gearFill", refreshSettingsColorUI);
  bindHSLGroup(settingsSandbox.gearStroke, "gearStroke", refreshSettingsColorUI);
  bindHSLGroup(settingsSandbox.slotFill, "setFill", refreshSettingsColorUI);
  bindHSLGroup(settingsSandbox.slotStroke, "setStroke", refreshSettingsColorUI);
  applyElementColors();
  refreshElementColorUI();
  refreshPanelColorUI();
  refreshSlotColorUI();
  refreshSettingsColorUI();
}

