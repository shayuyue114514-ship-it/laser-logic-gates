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
  microDt = speedSliderToDt(Number(speedSliderDom.value));
  microAcc = 0;
  updateSpeedValueLabel();
  sceneDirty = true;
}

// 更新速度数值显示：零延迟单独写「极速」，其余一律用秒、固定两位小数，单位统一才好横向比较
function updateSpeedValueLabel() {
  speedValueDom.textContent = microDt <= 0 ? "极速" : microDt.toFixed(2) + "s";
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
  gridRenderOn = flipSwitch(gridSwitchDom);
  sceneDirty = true;
}

// 切换「高级渲染」：只改状态与开关外观；激光不在任何缓存里，标记重绘就能立刻看到变化
function toggleAdvancedRender() {
  advancedRenderOn = flipSwitch(advSwitchDom);
  sceneDirty = true;
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

// 每帧同步两个弹窗：各自锚定自己的按钮，互不影响；同时只开一个，所以不会出现两块底板叠在一起
function renderPanels(vp) {
  renderPopup(settingsPanelDom, settingsLitAnim, settingsSlotRect(vp), vp);
  renderPopup(filePanelDom, fileLitAnim, fileSlotRect(vp), vp);
}

// 每帧同步教程弹窗：位置由 CSS 居中，这里只管进度驱动的显隐与透明度
// 收干净就 display:none，不留一个透明的空壳压住网格，也顺带把它的指针拦截一起解掉
function renderTutorialPanel() {
  const p = tutorialModalAnim.cur;  // 0 全隐、1 全显，与教程按钮的提亮同源
  if (p <= 0.001) {
    tutorialPanelDom.style.display = "none";
    return;
  }
  // 显示时用 flex 而不是 block：窗口内部要靠弹性布局把内容区撑满取消按钮之外的高度
  // 这里比对的是 "flex" 而不是 "none"：内联样式没写过时读回来是空串，只认 "none" 会在首帧漏掉一次
  if (tutorialPanelDom.style.display !== "flex") tutorialPanelDom.style.display = "flex";
  tutorialPanelDom.style.opacity = p;
}

// 每帧同步确认弹窗：与教程弹窗同一套做法，位置由 CSS 居中，这里只管进度驱动的显隐与透明度
// 它是纯 DOM 浮层，不参与画布绘制，所以收干净时直接隐藏，不留一个透明的空壳挡住底下的点击
function renderConfirmPanel() {
  const p = confirmModalAnim.cur;  // 0 全隐、1 全显
  if (p <= 0.001) {
    confirmPanelDom.style.display = "none";
    return;
  }
  // 显示时用 flex：里面那句问话与按钮行要靠弹性布局纵向排开，与教程弹窗同一个道理
  if (confirmPanelDom.style.display !== "flex") confirmPanelDom.style.display = "flex";
  confirmPanelDom.style.opacity = p;
}

