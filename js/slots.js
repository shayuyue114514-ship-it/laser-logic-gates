// slots.js：面板选项槽的交互：命中判定、悬停、按下、选中、动画推进与重置。
"use strict";

/* ========== 面板选项槽的交互 ========== */

// 屏幕位置落在哪个槽上：返回槽序号，没命中返回 -1
// 选中槽与元件槽都算命中，空槽不响应；两者共用同一套悬停与按下反馈，手感一致
// 设置按钮也算一个槽，序号排在所有元件槽之后，所以它天然共用同一套悬停与按下逻辑，手感不会走样
// 悬停与点击共用它，两处判定不会算歪
function slotIndexAt(sx, sy) {
  const vp = getViewport();
  // 从选中槽一直扫到最后一个元件槽，中间不留空：这两类槽在面板上是连着的
  for (let i = SELECT_SLOT_INDEX; i < ELEMENT_SLOT_BASE + PANEL_SLOT_TYPES.length; i++) {
    const r = panelSlotRect(i, vp);
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return i;
  }
  const sr = settingsSlotRect(vp);
  if (sx >= sr.x && sx <= sr.x + sr.w && sy >= sr.y && sy <= sr.y + sr.h) return SETTINGS_SLOT_INDEX;
  const fr = fileSlotRect(vp);
  if (sx >= fr.x && sx <= fr.x + fr.w && sy >= fr.y && sy <= fr.y + fr.h) return FILE_SLOT_INDEX;
  const tr = tutorialSlotRect(vp);
  if (sx >= tr.x && sx <= tr.x + tr.w && sy >= tr.y && sy <= tr.y + tr.h) return TUTORIAL_SLOT_INDEX;
  return -1;
}

// 按指针屏幕位置更新悬停槽
function updateSlotHoverAt(sx, sy) {
  const hit = slotIndexAt(sx, sy);
  // 换了槽就重新计时：简介的延迟按「停在同一个槽上」的时长算，扫过一排槽不会触发
  if (hit !== slotHoverIndex) slotHoverTime = 0;
  slotHoverIndex = hit;
  // 按住后把指针拖离该槽就退出按下态，和普通按钮一致，避免两个槽同时停在缩小状态
  if (slotPressedIndex >= 0 && slotPressedIndex !== slotHoverIndex) slotPressedIndex = -1;
}

// 每帧推进简介浮层：先累计当前槽的停留时长，够久才把浮层切到这个槽并淡入，否则淡出
function updateSlotTip(dt) {
  // 简介只对元件槽有效：两个按钮也在槽序号里，但它们没有元件简介，得排除掉
  const onElementSlot = isElementSlot(slotHoverIndex);
  if (onElementSlot) {
    slotHoverTime += dt;
  } else {
    slotHoverTime = 0;
  }
  const wantShow = onElementSlot && slotHoverTime >= CONFIG.panelTipDelay;
  // 先把要显示的槽记下来，再推进动画：移开鼠标后浮层仍按 tipIndex 把淡出播完
  if (wantShow) tipIndex = slotHoverIndex;
  stepEased(tipAnim, wantShow ? 1 : 0, dt, CONFIG.panelTipAnimDuration, easeInOutCubic);
  // 淡出收干净后清掉记录的槽，下次淡入不会先闪一下旧内容
  if (tipAnim.cur <= 0.001 && !wantShow) tipIndex = -1;
}

// 推进每个槽的缩放缓动：目标每帧由「是否被悬停 / 是否被按下」现算，两种状态的任意组合都自动成立
// 这样就不必在状态切换时手动起停动画，也不会漏掉「按下时移出」这类组合
// 亮度不参与这里的动画：按下只改变缩放，变亮与否完全由「是否选中」决定，所以按下不会闪
function updateSlotAnim(dt) {
  // 设置按钮就在这个数组里，跟着一起走，所以它的悬停与按下反馈与元件槽逐帧同源，不会有半点差别
  for (let i = 0; i < slotAnim.length; i++) {
    // 按下的槽缩得比悬停更深
    const targetScale = (i === slotPressedIndex) ? CONFIG.panelSlotPressedScale
      : (i === slotHoverIndex ? CONFIG.panelSlotHoverScale : 1);
    stepEased(slotAnim[i], targetScale, dt, CONFIG.panelSlotAnimDuration);
  }
  // 提亮不参与缩放那套：它是「弹窗开着」的状态显示，不是按下反馈，所以不看悬停与按下
  stepEased(settingsLitAnim, settingsOpen ? 1 : 0, dt, CONFIG.settingsLitDuration);
  stepEased(fileLitAnim, filePanelOpen ? 1 : 0, dt, CONFIG.settingsLitDuration);  // 文件按钮走同一套时长，两个按钮亮灭的节奏才不会一个快一个慢
  stepEased(tutorialLitAnim, tutorialOpen ? 1 : 0, dt, CONFIG.settingsLitDuration);  // 教程按钮也走同一套时长，三个按钮亮灭的节奏一致
  // 教程弹窗的淡入淡出与上面这支提亮同源同时长：按钮亮起来的同时窗口淡出来，不会一个先一个后
  stepEased(tutorialModalAnim, tutorialOpen ? 1 : 0, dt, CONFIG.settingsLitDuration);
  // 确认弹窗同样走这一档时长：它一冒出来就要立刻被看见，快了像闪一下，慢了会误以为没反应
  stepEased(confirmModalAnim, confirmOpen ? 1 : 0, dt, CONFIG.settingsLitDuration);
}

// 按当前槽数量重建槽动画状态：全部停在原尺寸、未悬停、未按下；重开或改槽数量后都要走一遍
function resetSlots() {
  slotAnim.length = 0;
  // 多建三个给教程、文件和设置按钮：它们占最后三个下标，所以数组比元件槽多三个
  for (let i = 0; i <= TUTORIAL_SLOT_INDEX; i++) {
    slotAnim.push(newEased(1));
  }
  slotHoverIndex = -1;
  slotPressedIndex = -1;
  slotSelectedIndex = ELEMENT_SLOT_BASE + 1;  // 默认选中透射器那个槽，与初始虚影形状保持一致
  // 提亮不在这里复位：它跟随的是设置开没开，属于界面状态而不是这一局的状态
  // 简介浮层一并复位：停留计时归零、浮层收起、动画标量直接停在 0，避免重开时残留上一局的浮层
  slotHoverTime = 0;
  tipIndex = -1;
  tipAnim.cur = 0;
  tipAnim.from = 0;
  tipAnim.to = 0;
  tipAnim.t = 1;
}

