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
  for (let i = 0; i < S.slotAnim.length; i++) {
    if (S.slotAnim[i].t < 1) return false;
  }
  // 两个按钮的提亮：它们的缩放已经在上面那轮槽里查过了，这里只需补上提亮，否则动画会卡在半路
  if (S.settingsLitAnim.t < 1) return false;
  if (S.fileLitAnim.t < 1) return false;
  if (S.tutorialLitAnim.t < 1) return false;  // 教程按钮的提亮同样要查，否则动画会卡在半路不动
  if (S.tutorialModalAnim.t < 1) return false;  // 教程弹窗的淡入淡出也要查，否则窗口会卡在半透明或停在没显示出来的状态
  if (S.confirmModalAnim.t < 1) return false;  // 确认弹窗同理：它淡出途中若整帧跳过渲染，就会一直停在半透明上
  // 标签输入框的淡入淡出同样要查：少了这一条，它淡到一半就会被判成「场景已静止」而跳过渲染，
  // 透明度从此不再更新，看上去就是一顿一顿的，甚至会停在半透明上
  if (S.labelEditorAnim.t < 1) return false;
  // 正在原地编辑浮动文本：打字光标要一闪一闪，所以每一帧都得重绘
  // 少了这一条，静止时那一帧会被整体跳过，光标就一直亮着不闪，甚至停在「灭」的那一段上像丢了
  if (S.textEditing) return false;
  // 简介浮层：动画没走完就还在动
  if (S.tipAnim.t < 1) return false;
  // 元件：删除动画进行中、朝向还在转、选中缓动没走完、或拖动缓动还差一点没追上，都要继续渲染
  // 只走活跃表：这一帧还有动静的元件都在这张表里，十万个元件里静止的那些不必每帧再判一遍
  // 缓动刚被改过的那一帧不必在这里再判一次：上面那几趟推进刚刚把它们的目标起步了，t 已经不是 1
  for (let i = 0; i < S.activeEls.length; i++) {
    const el = S.activeEls[i];
    if (el.deleting || el.angle !== el.angleTarget || el.selP.t < 1) return false;
    if (el.litP.t < 1) return false;  // 灯的亮起缓动没走完就还在变，不能整帧跳过
    if (el.mvOffU !== 0 || el.mvOffV !== 0) return false;  // 拖动缓动没归零就还在滑，不能整帧跳过
  }
  // 虚影：可见时位置没吸附、透明度停在半途、旋转没停，都算还在动
  // 不可见时不检查位置，因为它此时停在「进不去」动画的终点上，本来就不等于目标格心
  if (S.ghostVisible && (S.ghostWX !== S.ghostTWX || S.ghostWY !== S.ghostTWY)) return false;
  if (S.ghostAlpha > 0 && S.ghostAlpha < 1) return false;
  if (S.ghostRejectActive && S.ghostRejectP < 1) return false;
  if (S.ghostAngle !== S.ghostAngleTarget) return false;
  return true;
}

// 渲染一帧：清屏 → 画网格视口 → 画边框 → 画上方面板与底部栏 → 画选项槽 → 同步简介浮层 → 同步 SVG 元件层
function render() {
  const vp = getViewport();
  // 每个 t0 与紧随其后的 pe 是一对探针：只记叶子阶段，各段互不重叠，加起来就是渲染总耗时
  // 不在这里单记一条「渲染总计」：那会和下面的子阶段重复计入，百分比与「未归类」都会失真
  let t0 = pt(); S.ctx.clearRect(0, 0, state.cssW, state.cssH); drawGrid(vp); pe("渲染/网格", t0);  // 先整体清成白底，视口外自然就是空白
  t0 = pt(); drawLaser(vp); pe("渲染/激光", t0);  // 激光在网格之上、元件之下
  t0 = pt(); drawLampGlow(vp); pe("渲染/灯光晕", t0);  // 灯光晕压在激光之上、元件之下：既能柔化照到灯上的激光，又不会盖住灯本体
  t0 = pt(); drawViewportBorder(vp); drawPanelBox(vp); drawBottomBar(vp); drawBottomBarHint(vp); pe("渲染/底板边框", t0);
  t0 = pt(); drawPanelSlots(vp); renderSlotTip(vp); pe("渲染/元件面板", t0);
  t0 = pt(); renderPanels(vp); renderTutorialPanel(); renderConfirmPanel(); renderLabelEditor(); syncTextEditField(); pe("渲染/弹窗浮层", t0);
  t0 = pt(); renderElements(); pe("渲染/元件层", t0);
  t0 = pt(); drawElementLabels(vp); pe("渲染/标签", t0);  // 标签画在元件之后：压在元件之上
  t0 = pt(); drawTextEditBox(); drawFloatingTexts(vp); drawTextEditCaret(); pe("渲染/浮动文本", t0);
  t0 = pt(); renderGhost(); pe("渲染/虚影", t0);
  t0 = pt(); drawMarquee(); pe("渲染/拉框", t0);  // 拉框画在最后，压在画布上所有内容之上，拖到哪儿都看得见
}

