// settings.js：设置面板逻辑：运行速度滑块、两个开关、弹窗显隐渲染。
"use strict";

// 滑块刻度 → 微帧时长（秒）：最左端单独表示「零延迟」，往右走指数曲线
// 用指数而不是线性，是因为人对速度的感知本来就是倍率关系，线性映射会让慢速段挤成一团
function speedSliderToDt(v) {
  const t = v / CONFIG.speedSliderSteps;  // 归一化到 0~1
  if (t <= 0) return 0;                   // 最左端：不设延迟
  const k = CONFIG.speedDtMax / CONFIG.speedDtMin;
  return CONFIG.speedDtMin * Math.pow(k, t);
}

// 微帧时长 → 滑块刻度：上面那条映射的反函数，用于把默认速度换算成滑块的初始位置
function dtToSpeedSlider(dt) {
  if (dt <= CONFIG.speedDtMin) return 0;
  const k = CONFIG.speedDtMax / CONFIG.speedDtMin;
  return Math.round(CONFIG.speedSliderSteps * Math.log(dt / CONFIG.speedDtMin) / Math.log(k));
}

// 拖动「运行速度」滑块：把刻度换算成微帧时长，并清掉累加余数
// 余数是按旧时长攒下的，换了时长还留着就会多算或少算一个微帧，清零最干净
function onSpeedSliderInput() {
  S.microDt = speedSliderToDt(Number(S.speedSliderDom.value));
  S.microAcc = 0;
  updateSpeedValueLabel();
  S.sceneDirty = true;
  saveSettings();   // 调过的速度下次打开编辑器还在
}

// 设置存在本地存储的这一处：键名固定，存的是用户真正调过的那几项，与存档（电路内容）完全分开
const SETTINGS_KEY = "laser-gate:settings:v1";   // string：设置的本地存储键

// 把当前设置写进本地存储：速度、渲染精度、缩放刷新阈值、网格、高级渲染、滚轮行为
// 只写这六项：它们都是「工作环境偏好」，换个文档打开也该照旧；存档与视野属于文档内容，不进这里
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      speedStep: Number(S.speedSliderDom.value),   // 存滑块刻度而不是秒数：刻度与映射是一一对应的，读回来不必反算
      renderPrecision: S.renderPrecision,
      zoomRefresh: S.zoomRefreshLimit,
      grid: S.gridRenderOn,
      advanced: S.advancedRenderOn,
      wheelPan: S.wheelPanOn
    }));
  } catch (err) {
    // 存储不可用（隐私模式、配额满）时静默放弃：设置只在本次会话里生效，不影响页面继续用
  }
}

// 读回上次的设置并摆到控件上：每一项都单独校验，坏掉的那一项退回默认值，不因一条脏数据把整组设置作废
// 必须在控件范围与初始值都摆好之后才调用，滑块读回来才有地方落
function loadSettings() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
  } catch (err) {
    saved = null;   // 没存过或存的不是合法 JSON：当作什么都没调过
  }
  if (saved === null || typeof saved !== "object" || Array.isArray(saved)) return;
  if (typeof saved.grid === "boolean") {
    S.gridRenderOn = saved.grid;
    S.gridSwitchDom.classList.toggle("on", saved.grid);
  }
  if (typeof saved.advanced === "boolean") {
    S.advancedRenderOn = saved.advanced;
    S.advSwitchDom.classList.toggle("on", saved.advanced);
  }
  if (typeof saved.wheelPan === "boolean") {
    S.wheelPanOn = saved.wheelPan;
    S.wheelSwitchDom.classList.toggle("on", saved.wheelPan);
  }
  if (isFiniteNumber(saved.speedStep)) {
    S.speedSliderDom.value = String(clamp(Math.round(saved.speedStep), 0, CONFIG.speedSliderSteps));
    onSpeedSliderInput();   // 走同一段处理：速度、数值显示、余数清零只维护这一份
  }
  if (isFiniteNumber(saved.renderPrecision)) {
    const p = clamp(saved.renderPrecision, CONFIG.renderPrecisionMin, CONFIG.renderPrecisionMax);
    S.renderPrecisionSliderDom.value = String(p);
    onRenderPrecisionInput();
  }
  if (isFiniteNumber(saved.zoomRefresh)) {
    const z = clamp(saved.zoomRefresh, CONFIG.zoomRefreshMin, CONFIG.zoomRefreshMax);
    S.zoomRefreshSliderDom.value = String(z);
    onZoomRefreshInput();
  }
}

// 切换「滚轮平移」：默认关，滚轮仍是缩放；开了之后滚轮按普通滚动去平移画面
// 触控板双指捏合始终按缩放走，不受这一项影响，所以没有中键的设备也能两个方向都用
function toggleWheelPan() {
  S.wheelPanOn = flipSwitch(S.wheelSwitchDom);
  S.sceneDirty = true;
  saveSettings();
}

// 更新速度数值显示：零延迟单独写「极速」，其余一律用秒、固定两位小数，单位统一才好横向比较
function updateSpeedValueLabel() {
  S.speedValueDom.textContent = S.microDt <= 0 ? "极速" : S.microDt.toFixed(2) + "s";
}

// 拖动「渲染精度」滑块：精度除以 5 得到画布像素比上限，并把所有按像素比画出来的东西整体作废
// 画布位图、网格瓷砖、灯光晕纹理、元件贴图、元件缓存位图都是按像素比栅格化的，换了精度必须整体重来一遍
function onRenderPrecisionInput() {
  S.renderPrecision = Number(S.renderPrecisionSliderDom.value);
  S.renderScaleCap = S.renderPrecision / CONFIG.renderPrecisionPerX;   // 5→1×、10→2×、20→4×
  resizeCanvas();            // 画布位图尺寸与绘制坐标变换都按新像素比重设
  S.gridTileKey = "";          // 瓷砖随像素比栅格化，清掉指纹就等于要求重画
  S.lampGlowCacheKey = "";     // 灯光晕纹理同理
  S.elemSpriteMap.clear();     // 元件贴图是按像素比栅格化的，旧的一律作废
  invalidateElementCache();  // 元件缓存位图也是按像素比开的，标脏让它下一帧重建
  S.sceneDirty = true;
  updateRenderPrecisionLabel();
}

// 更新渲染精度读数：直接写滑块上的数，10 就是 2 倍像素比，20 就是 4 倍
// 这样读数与滑块刻度是同一个量，拖动时不会出现「数字变了但看不出在调什么」的断层
function updateRenderPrecisionLabel() {
  S.renderPrecisionValueDom.textContent = S.renderPrecision.toFixed(1);
}

// 拖动「缩放刷新速度」滑块：只改放大重画的阈值，不必作废任何已有缓存，标记重绘即可
// 阈值越小，缩放途中越频繁地重画缓存位图，画面越清晰也越费；相机停稳时总是重画，不受这条限制
function onZoomRefreshInput() {
  S.zoomRefreshLimit = Number(S.zoomRefreshSliderDom.value);
  updateZoomRefreshLabel();
  S.sceneDirty = true;
  saveSettings();
}

// 更新缩放刷新速度读数：带乘号、固定两位小数，1.40× 表示位图放到 1.4 倍时重画
function updateZoomRefreshLabel() {
  S.zoomRefreshValueDom.textContent = S.zoomRefreshLimit.toFixed(2) + "×";
}

// 翻转一个开关的外观，返回翻转后的状态：两个开关共用，开与关的样子只维护这一份
function flipSwitch(el) {
  const on = !el.classList.contains("on");
  el.classList.toggle("on", on);
  return on;
}

// 切换「渲染网格」：改状态、换开关外观并要求重绘
// 网格改成平铺图案后不必再作废任何缓存：下一帧要么整屏铺图案、要么只铺底色，两份成品都是当帧现算的
function toggleGridRender() {
  S.gridRenderOn = flipSwitch(S.gridSwitchDom);
  S.sceneDirty = true;
  saveSettings();
}

// 切换「高级渲染」：只改状态与开关外观；激光不在任何缓存里，标记重绘就能立刻看到变化
function toggleAdvancedRender() {
  S.advancedRenderOn = flipSwitch(S.advSwitchDom);
  S.sceneDirty = true;
  saveSettings();
}

// 每帧同步一个弹窗：位置跟着视口走，显隐与透明度直接取它锚定按钮的提亮进度
// 共用同一个进度标量，弹窗与按钮必然同步亮起、同步熄灭，不需要第二套动画状态
function renderPopup(dom, anim, anchorRect, vp) {
  const p = anim.cur;  // 0 全隐、1 全显，与按钮提亮同源
  if (p <= 0.001) {
    dom.style.display = "none";  // 收干净直接隐藏，不留下一个透明的空壳压住网格
    return;
  }
  if (dom.style.display === "none") dom.style.display = "block";
  const pos = popupPanelRect(vp, anchorRect);
  dom.style.left = pos.x + "px";
  dom.style.top = pos.y + "px";
  dom.style.width = pos.w + "px";
  dom.style.opacity = p;
}

// 每帧同步设置弹窗：锚定设置按钮
function renderPanels(vp) {
  renderPopup(S.settingsPanelDom, S.settingsLitAnim, settingsSlotRect(vp), vp);
}

// 每帧同步教程弹窗：位置由 CSS 居中，这里只管进度驱动的显隐与透明度
// 收干净就 display:none，不留一个透明的空壳压住网格，也顺带把它的指针拦截一起解掉
function renderTutorialPanel() {
  const p = S.tutorialModalAnim.cur;  // 0 全隐、1 全显，与教程按钮的提亮同源
  if (p <= 0.001) {
    S.tutorialPanelDom.style.display = "none";
    return;
  }
  // 显示时用 flex 而不是 block：窗口内部要靠弹性布局把内容区撑满取消按钮之外的高度
  // 这里比对的是 "flex" 而不是 "none"：内联样式没写过时读回来是空串，只认 "none" 会在首帧漏掉一次
  if (S.tutorialPanelDom.style.display !== "flex") S.tutorialPanelDom.style.display = "flex";
  S.tutorialPanelDom.style.opacity = p;
}

// 每帧同步确认弹窗：与教程弹窗同一套做法，位置由 CSS 居中，这里只管进度驱动的显隐与透明度
// 它是纯 DOM 浮层，不参与画布绘制，所以收干净时直接隐藏，不留一个透明的空壳挡住底下的点击
function renderConfirmPanel() {
  const p = S.confirmModalAnim.cur;  // 0 全隐、1 全显
  if (p <= 0.001) {
    S.confirmPanelDom.style.display = "none";
    return;
  }
  // 显示时用 flex：里面那句问话与按钮行要靠弹性布局纵向排开，与教程弹窗同一个道理
  if (S.confirmPanelDom.style.display !== "flex") S.confirmPanelDom.style.display = "flex";
  S.confirmPanelDom.style.opacity = p;
}

