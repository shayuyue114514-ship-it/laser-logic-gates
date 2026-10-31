// slots.js：面板选项槽的交互：悬停、点击、键盘反馈、动画推进与重置。
// 槽是 DOM 元素，悬停缩放、按下更缩、选中高亮、按钮提亮全由样式表按类名完成，这里只维护状态与计时。
"use strict";

/* ========== 面板选项槽的交互 ========== */

// 给一个槽绑定三件事：指针进入记下悬停、指针离开清掉悬停、点击按槽的种类分发
// 悬停只影响简介浮层的延迟计时；缩放由样式表的 :hover 直接给，不必每帧推进
function bindSlotEvents(el, index) {
  el.addEventListener("pointerenter", function () {
    S.slotHoverIndex = index;
    S.slotHoverTime = 0;   // 换了槽就重新计时：停留时长按「停在同一个槽上」算
    S.sceneDirty = true;
  });
  el.addEventListener("pointerleave", function () {
    if (S.slotHoverIndex === index) S.slotHoverIndex = -1;
    S.slotHoverTime = 0;
    S.sceneDirty = true;
  });
  el.addEventListener("click", function () {
    onSlotClick(index);
  });
}

// 点击一个槽：可选中的槽只改选中项；三个按钮各自开关自己的弹窗，同一时刻只亮一个
// 上一版的点击是在画布上「按下与松开都落在同一槽」才算数，现在由浏览器原生的 click 承担，规则不变
function onSlotClick(index) {
  // 正在原地编辑文本或改标签时，先按「点到别处就把字收下」处理，与点在画布空白处一致
  if (S.textEditing) endTextEditing(true);
  if (S.labelEditorOpen) closeLabelEditor(true);
  if (isPickableSlot(index)) {
    setSelectedSlot(index);
  } else if (index === SETTINGS_SLOT_INDEX) {
    S.settingsOpen = !S.settingsOpen;
    S.filePanelOpen = false;   // 弹窗互斥：开一个就把另外两个关掉，避免底板叠在一起
    S.tutorialOpen = false;
  } else if (index === FILE_SLOT_INDEX) {
    S.filePanelOpen = !S.filePanelOpen;
    S.settingsOpen = false;
    S.tutorialOpen = false;
  } else if (index === TUTORIAL_SLOT_INDEX) {
    S.tutorialOpen = !S.tutorialOpen;
    S.settingsOpen = false;
    S.filePanelOpen = false;
  }
  S.sceneDirty = true;   // 选中高亮与弹窗显隐都变了，静止时也得重绘一帧才看得到
}

// 每帧推进简介浮层：先累计当前槽的停留时长，够久才把浮层切到这个槽并淡入，否则淡出
function updateSlotTip(dt) {
  // 简介只对元件槽有效：选中槽、文本槽与三个按钮都没有元件简介，得排除掉
  const onElementSlot = isElementSlot(S.slotHoverIndex);
  if (onElementSlot) {
    S.slotHoverTime += dt;
  } else {
    S.slotHoverTime = 0;
  }
  const wantShow = onElementSlot && S.slotHoverTime >= CONFIG.panelTipDelay;
  // 先把要显示的槽记下来，再推进动画：移开鼠标后浮层仍按 tipIndex 把淡出播完
  if (wantShow) S.tipIndex = S.slotHoverIndex;
  stepEased(S.tipAnim, wantShow ? 1 : 0, dt, CONFIG.panelTipAnimDuration, easeInOutCubic);
  // 淡出收干净后清掉记录的槽，下次淡入不会先闪一下旧内容
  if (S.tipAnim.cur <= 0.001 && !wantShow) S.tipIndex = -1;
}

// 每帧推进各段缓动：槽的缩放已经交给样式表，这里只剩键盘反馈的计时与各弹窗的显隐进度
// 弹窗进度仍按缓动标量走，透明度与按钮提亮仍由同一个进度驱动，两者不会一个先一个后
function updateSlotAnim(dt) {
  // 键盘选中没有物理按住，用一个短计时代替：时间走完把反馈类摘掉，槽自己回弹
  if (S.slotKeyPressTimer > 0) {
    S.slotKeyPressTimer -= dt;
    if (S.slotKeyPressTimer <= 0) {
      S.slotKeyPressTimer = 0;
      const el = S.slotEls[S.slotKeyPressIndex];
      if (el !== undefined) el.classList.remove("kb");
      S.slotKeyPressIndex = -1;
    }
  }
  // 提亮不参与缩放那套：它是「弹窗开着」的状态显示，不是按下反馈，所以不看悬停与按下
  stepEased(S.settingsLitAnim, S.settingsOpen ? 1 : 0, dt, CONFIG.settingsLitDuration);
  stepEased(S.fileLitAnim, S.filePanelOpen ? 1 : 0, dt, CONFIG.settingsLitDuration);
  stepEased(S.tutorialLitAnim, S.tutorialOpen ? 1 : 0, dt, CONFIG.settingsLitDuration);
  // 教程弹窗的淡入淡出与上面这支提亮同源同时长：按钮亮起来的同时窗口淡出来，不会一个先一个后
  stepEased(S.tutorialModalAnim, S.tutorialOpen ? 1 : 0, dt, CONFIG.settingsLitDuration);
  // 确认弹窗同样走这一档时长：它一冒出来就要立刻被看见，快了像闪一下，慢了会误以为没反应
  stepEased(S.confirmModalAnim, S.confirmOpen ? 1 : 0, dt, CONFIG.settingsLitDuration);
  // 标签输入框也走这一档：它与确认弹窗是同一类东西，冒出来和被收掉都该是同一个节奏
  stepEased(S.labelEditorAnim, S.labelEditorOpen ? 1 : 0, dt, CONFIG.settingsLitDuration);
}

// 键盘选中槽时补一次反馈：给槽加一个类，按样式表里悬停那一档缩小，计时结束自动摘掉
// 与鼠标点击的按下态不同：键盘只缩到悬停那一档，动作更轻，也不必真的按住什么
function pressSlotByKey(index) {
  if (index < 0 || index >= S.slotEls.length) return;
  const prev = S.slotEls[S.slotKeyPressIndex];
  if (prev !== undefined) prev.classList.remove("kb");   // 上一个还没弹完就先摘掉，画面里只留一个缩着的槽
  S.slotKeyPressIndex = index;
  S.slotKeyPressTimer = CONFIG.panelSlotKeyPressDuration;
  S.slotEls[index].classList.add("kb");
}

// 按当前槽数量重建槽状态：悬停清零、键盘反馈清干净、默认选中透射器
// 重开或改槽数量后都要走一遍，节点本身由 initPanelDom 建好，这里不重建 DOM
function resetSlots() {
  for (let i = 0; i < S.slotEls.length; i++) S.slotEls[i].classList.remove("kb");
  S.slotHoverIndex = -1;
  S.slotKeyPressIndex = -1;   // 键盘按下反馈也一并归零：重开时不该有个槽停在缩小状态
  S.slotKeyPressTimer = 0;
  S.slotSelectedIndex = ELEMENT_SLOT_BASE + 1;  // 默认选中透射器那个槽，与初始虚影形状保持一致
  // 简介浮层一并复位：停留计时归零、浮层收起、动画标量直接停在 0，避免重开时残留上一局的浮层
  S.slotHoverTime = 0;
  S.tipIndex = -1;
  S.tipAnim.cur = 0;
  S.tipAnim.from = 0;
  S.tipAnim.to = 0;
  S.tipAnim.t = 1;
}
