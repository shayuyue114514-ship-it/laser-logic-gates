// camera.js：相机更新、静止判定与渲染入口。
"use strict";

/* ========== 更新与渲染 ========== */

// 用指数平滑把参考点屏幕位置与缩放推向目标值，dt 参与计算保证不同帧率下速度一致
function updateCamera(dt) {
  const k = 1 - Math.exp(-CONFIG.smoothLambda * dt);
  state.logScale += (state.tLogScale - state.logScale) * k;
  state.anchorSX += (state.tAnchorSX - state.anchorSX) * k;
  state.anchorSY += (state.tAnchorSY - state.anchorSY) * k;
  // 指数平滑永远逼近而不到达，静止后会一直做亚像素漂移；误差足够小就直接吸附，画面彻底静下来
  if (Math.abs(state.tAnchorSX - state.anchorSX) < CONFIG.settlePx) state.anchorSX = state.tAnchorSX;
  if (Math.abs(state.tAnchorSY - state.anchorSY) < CONFIG.settlePx) state.anchorSY = state.tAnchorSY;
  if (Math.abs(state.tLogScale - state.logScale) < CONFIG.settleLogEps) state.logScale = state.tLogScale;
  // 缩放按对数插值，等比例变化看起来才均匀
  state.scale = Math.exp(state.logScale);
}

// 判断场景是否完全静止：相机、选项槽、简介浮层、元件动画、虚影全都停下
// 全停下就说明画面不会再变，主循环可以整帧跳过渲染，空闲时占用降到接近零
function isSceneSettled() {
  // 相机：吸附后当前值与目标值相等，不等就说明还在平移或缩放
  if (state.anchorSX !== state.tAnchorSX || state.anchorSY !== state.tAnchorSY) return false;
  if (state.logScale !== state.tLogScale) return false;
  // 选项槽的缩放缓动：任一槽没停稳就还在动
  for (let i = 0; i < slotAnim.length; i++) {
    if (slotAnim[i].t < 1) return false;
  }
  // 两个按钮的提亮：它们的缩放已经在上面那轮槽里查过了，这里只需补上提亮，否则动画会卡在半路
  if (settingsLitAnim.t < 1) return false;
  if (fileLitAnim.t < 1) return false;
  if (tutorialLitAnim.t < 1) return false;  // 教程按钮的提亮同样要查，否则动画会卡在半路不动
  if (tutorialModalAnim.t < 1) return false;  // 教程弹窗的淡入淡出也要查，否则窗口会卡在半透明或停在没显示出来的状态
  if (confirmModalAnim.t < 1) return false;  // 确认弹窗同理：它淡出途中若整帧跳过渲染，就会一直停在半透明上
  // 简介浮层：动画没走完就还在动
  if (tipAnim.t < 1) return false;
  // 元件：删除动画进行中、朝向还在转、选中缓动没走完、或拖动缓动还差一点没追上，都要继续渲染
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.deleting || el.angle !== el.angleTarget || el.selP.t < 1) return false;
    if (el.litP.t < 1) return false;  // 灯的亮起缓动没走完就还在变，不能整帧跳过
    if (el.mvOffU !== 0 || el.mvOffV !== 0) return false;  // 拖动缓动没归零就还在滑，不能整帧跳过
  }
  // 虚影：可见时位置没吸附、透明度停在半途、旋转没停，都算还在动
  // 不可见时不检查位置，因为它此时停在「进不去」动画的终点上，本来就不等于目标格心
  if (ghostVisible && (ghostWX !== ghostTWX || ghostWY !== ghostTWY)) return false;
  if (ghostAlpha > 0 && ghostAlpha < 1) return false;
  if (ghostRejectActive && ghostRejectP < 1) return false;
  if (ghostAngle !== ghostAngleTarget) return false;
  return true;
}

// 渲染一帧：清屏 → 画网格视口 → 画边框 → 画上方面板与底部栏 → 画选项槽 → 同步简介浮层 → 同步 SVG 元件层
function render() {
  const vp = getViewport();
  // 先整体清成白底，视口外自然就是空白
  ctx.clearRect(0, 0, state.cssW, state.cssH);
  drawGrid(vp);
  drawLaser(vp);  // 激光在网格之上、元件之下：元件层是独立 SVG 图层，天然压在它上面
  drawLampGlow(vp);  // 灯光晕压在激光之上、元件之下：既能柔化照到灯上的激光，又不会盖住灯本体
  drawViewportBorder(vp);
  drawPanelBox(vp);
  drawBottomBar(vp);
  drawBottomBarHint(vp);
  drawPanelSlots(vp);
  renderSlotTip(vp);
  renderPanels(vp);
  renderTutorialPanel();  // 教程弹窗是纯 DOM 浮层，压在画布所有内容之上，所以放在最后同步
  renderConfirmPanel();   // 确认弹窗平时是隐的，只在问话时冒出；与教程弹窗同档，紧跟着它同步
  renderElements();
  renderGhost();
  drawMarquee();  // 拉框画在最后，压在画布上所有内容之上，拖到哪儿都看得见
}

