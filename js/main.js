// main.js：主循环与初始化入口。
"use strict";

/* ========== 主循环与入口 ========== */

// 主循环只负责算 dt、调用更新、调用渲染，不写具体逻辑
function frame(ts) {
  const scriptStart = performance.now();  // 脚本耗时起点：包住本帧全部更新与渲染，读数里的「脚本」就是它
  const dt = state.lastTs ? Math.min((ts - state.lastTs) / 1000, 0.1) : 0; // 钳制 dt，避免切回标签页时跳变
  state.lastTs = ts;
  updateCamera(dt);
  updateSlotAnim(dt);
  updateSlotTip(dt);
  updateDeletions(dt);
  updateElementRotations(dt);
  updateSelectionAnim(dt);
  updateLampAnim(dt);
  updateMoveAnim(dt);
  updateOrbit(dt);
  // 列表上的未保存标记：每帧只做一次布尔比较，状态真变了才去动那一行
  syncSidebarDirty();
  stepSimulation(dt);  // 按固定步长推进微帧时钟，本帧结算几个微帧由它决定
  updateGhost(dt);
  updateGhostRotation(dt);
  // 静止判定放在全部更新之后：静止、上帧也静止、又没有待重绘的变更时，整帧跳过渲染
  // 动画收尾那一帧上帧还不是静止，所以最终状态一定会被画出来，不会卡在中间态
  const settled = isSceneSettled();
  if (sceneDirty || !settled || !prevSettled) render();
  prevSettled = settled;
  sceneDirty = false;
  accumulatePerf(ts, performance.now() - scriptStart);  // 读数只统计脚本耗时，浏览器的合成与空闲时间不计在内
  requestAnimationFrame(frame);
}

// 初始化：拿上下文 → 调尺寸 → 竖栏的外观与列表 → 复位视图 → 建元件层 → 注入简介浮层外观 → 绑事件 → 启动主循环
function init() {
  canvas = document.getElementById("gridCanvas");
  ctx = canvas.getContext("2d");
  resizeCanvas();
  initSidebarDom();  // 先把竖栏的宽度定下来：复位视图时要按「让出竖栏之后」的视口居中
  setupSidebarTree();  // 再把存档列表画出来并接上开合；列表目前是一份示意结构，不接任何真实文件
  resetView();
  initElementLayer();
  initSlotTipDom();
  initSettingsPanelDom();
  initFilePanelDom();
  initTutorialPanelDom();
  initConfirmPanelDom();  // 确认弹窗的外观与两个作答按钮，与教程弹窗同一套底板，只做一次
  setupDebugPanel();
  setupInput();
  loadPickerHandle();  // 异步把上次用过的文件句柄读回内存，供系统选择器定起始目录；读不到也不影响其它功能
  requestAnimationFrame(frame);
}

init();
