// render-panel.js：顶部元件面板与底部栏：建 DOM、摆位置、同步选中与提亮、写底栏提示、简介浮层。
// 面板与底栏的外观交给样式表，这里只负责数据与状态的搬运，不再在画布上画任何界面。
"use strict";

/* ========== 面板与底栏（DOM 层） ========== */

// 设置入口的位置：只用于把设置弹窗锚到按钮正下方；按钮本身的位置由样式表排，不再参与绘制
// 弹窗要贴着面板下边缘，所以仍按视口算一次，改动见下一步「弹窗锚定」时再收拢到按钮自己身上
function settingsSlotRect(vp) {
  const pad = CONFIG.panelSlotPad;
  const side = CONFIG.panelSlotSide;
  return {
    x: vp.x + vp.w - 2 - pad - side,
    y: CONFIG.panelGap + 2 + pad,
    w: side,
    h: side
  };
}

// 简介浮层的位置：紧贴面板矩形下边缘再留一点间隔，向下盖在网格上
// 面板位置由视口决定，所以这里仍按视口算，与面板实际框线始终对得上
function panelTipRect(vp) {
  const pad = CONFIG.panelSlotPad;
  return {
    x: vp.x + 2 + pad,
    y: vp.y - CONFIG.panelGap + CONFIG.panelTipGap,
    w: vp.w - 4 - pad * 2
  };
}

// 在槽的位置画指定类型的元件：形状与网格上的元件同一套本地坐标，这里只是平移到槽心再整体缩放
// 只用于把图标一次性烘焙进槽自己的小画布，运行期不再调用
function drawSlotElement(r, typeId) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const k = CONFIG.panelSlotElementLen / CONFIG.elementLen;
  S.ctx.save();
  S.ctx.translate(cx, cy);
  S.ctx.scale(k, k);
  S.ctx.fillStyle = hslCss(elementHSL.fill);
  S.ctx.strokeStyle = hslCss(elementHSL.stroke);
  S.ctx.lineWidth = CONFIG.elementStroke;
  S.ctx.lineJoin = "round";
  traceElementPath(typeId);
  S.ctx.stroke();
  S.ctx.fill();
  S.ctx.restore();
}

// 把配色、尺寸与动画时长一次性写成 CSS 变量：样式表只读变量，改配置仍在配置区一处改
// 变量的作用域放在根元素上，顶部面板与底部栏共用同一套
function injectChromeVars() {
  const rs = document.documentElement.style;
  rs.setProperty("--panel-fill", COLOR.panelFill);
  rs.setProperty("--border-color", COLOR.border);
  rs.setProperty("--slot-fill", COLOR.slotFill);
  rs.setProperty("--slot-fill-sel", COLOR.slotFillSelected);
  rs.setProperty("--slot-border", COLOR.slotBorder);
  rs.setProperty("--slot-border-sel", COLOR.slotBorderSelected);
  rs.setProperty("--slot-side", CONFIG.panelSlotSide + "px");
  rs.setProperty("--slot-gap", CONFIG.panelSlotGap + "px");
  rs.setProperty("--slot-pad", CONFIG.panelSlotPad + "px");
  rs.setProperty("--slot-radius", CONFIG.panelSlotRadius + "px");
  rs.setProperty("--slot-border-sel-width", CONFIG.slotSelectedBorderWidth + "px");
  rs.setProperty("--slot-hover", String(CONFIG.panelSlotHoverScale));
  rs.setProperty("--slot-press", String(CONFIG.panelSlotPressedScale));
  rs.setProperty("--slot-anim", CONFIG.panelSlotAnimDuration + "s");
  rs.setProperty("--lit-anim", CONFIG.settingsLitDuration + "s");
  // 三个按钮打开时的底色与描边：取与元件槽同一支色朝白色提亮一档，亮灭仍是一个色系
  rs.setProperty("--btn-lit-fill", hslLit(settingsHSL.slotFill, CONFIG.settingsLitAmount));
  rs.setProperty("--btn-lit-stroke", hslLit(settingsHSL.slotStroke, CONFIG.settingsLitAmount));
  rs.setProperty("--ui-font", UI_FONT);
  rs.setProperty("--hint-size", CONFIG.hintFontSize + "px");
  rs.setProperty("--hint-color", COLOR.hintText);
}

// 把图标的画法烘焙到槽内一张小画布上：图标形状仍由 icons.js 那一份画法产出，不再另写一套
// 图标都是静态的（变色只发生在底板），所以只画一次；悬停缩放由样式表对整个槽做 transform
function paintSlotIcon(el, drawIcon) {
  const dpr = effectiveDpr();
  const side = CONFIG.panelSlotSide;
  const cv = document.createElement("canvas");
  cv.className = "pslotIcon";
  cv.width = Math.max(1, Math.round(side * dpr));
  cv.height = cv.width;
  cv.style.width = side + "px";
  cv.style.height = side + "px";
  const c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 图标那几支画法一律读全局上下文：临时指向这张小画布，画完立刻换回来，别处不受影响
  const prev = S.ctx;
  S.ctx = c;
  try {
    drawIcon({ x: 0, y: 0, w: side, h: side });
  } finally {
    S.ctx = prev;
  }
  el.appendChild(cv);
}

// 建一个选项槽：序号决定里面放什么图标，事件绑定统一交给 slots.js
// 槽里不放按钮语义的 <button>：它是工具选择，不是表单动作，用 div 更贴近它在画面上的角色
function createPanelSlotEl(index) {
  const el = document.createElement("div");
  el.className = "pslot";
  el.dataset.slot = String(index);
  let drawIcon = null;
  if (index === SELECT_SLOT_INDEX) {
    drawIcon = function (r) { drawSelectIcon(r); };
  } else if (isElementSlot(index)) {
    const typeId = PANEL_SLOT_TYPES[index - ELEMENT_SLOT_BASE];
    drawIcon = function (r) { drawSlotElement(r, typeId); };
  } else if (index === TEXT_SLOT_INDEX) {
    drawIcon = function (r) { drawTextIcon(r); };
  }
  if (drawIcon !== null) paintSlotIcon(el, drawIcon);
  bindSlotEvents(el, index);
  return el;
}

// 建右侧一个按钮：与选项槽同外观同尺寸，图标另取一枚，打开时只提亮底板
function createPanelButtonEl(index, drawIcon) {
  const el = document.createElement("div");
  el.className = "pslot pbtn";
  el.dataset.slot = String(index);
  paintSlotIcon(el, function (r) { drawIcon(r); });
  bindSlotEvents(el, index);
  return el;
}

// 建整块界面：变量注入 → 左侧一排槽 → 右侧两个按钮 → 摆位置 → 同步一次状态
// 按钮的行内顺序是教程、设置：最左边的教程紧挨着元件槽，设置的右边与元件槽的右边内沿对称
function initPanelDom() {
  if (S.panelDom === null) return;
  injectChromeVars();
  for (let i = 0; i < CONFIG.panelSlotCount; i++) {
    const el = createPanelSlotEl(i);
    S.slotEls[i] = el;
    S.panelSlotsDom.appendChild(el);
  }
  const btns = [
    [TUTORIAL_SLOT_INDEX, drawTutorialIcon],
    [SETTINGS_SLOT_INDEX, drawSettingsIcon]
  ];
  for (let i = 0; i < btns.length; i++) {
    const el = createPanelButtonEl(btns[i][0], btns[i][1]);
    S.slotEls[btns[i][0]] = el;
    S.panelButtonsDom.appendChild(el);
  }
  syncChromeLayout();
  syncPanelStates();
}

// 摆两块界面框：位置与尺寸全部按视口算一次，窗口尺寸一变就重摆
// 顶部面板与网格视口左右对齐、上下各留一个 panelGap；底栏同理，高度取配置值
function syncChromeLayout() {
  if (S.panelDom === null || S.bottomBarDom === null) return;
  const vp = getViewport();
  const gap = CONFIG.panelGap;
  S.panelDom.style.left = vp.x + "px";
  S.panelDom.style.top = gap + "px";
  S.panelDom.style.width = vp.w + "px";
  S.panelDom.style.height = (vp.y - gap * 2) + "px";
  S.bottomBarDom.style.left = vp.x + "px";
  S.bottomBarDom.style.width = vp.w + "px";
  S.bottomBarDom.style.top = (state.cssH - gap - CONFIG.bottomBarHeight) + "px";
  S.bottomBarDom.style.height = CONFIG.bottomBarHeight + "px";
}

// 同步一个按钮的提亮状态：类名没变就不动 DOM，避免每帧都写一次
function syncButtonLit(el, on) {
  if (el === undefined) return;
  if (el.classList.contains("lit") !== on) el.classList.toggle("lit", on);
}

// 同步面板上的所有状态：选中槽的提亮与自己选中的是同一个数据，两个按钮的提亮各自对应自己的开合
// 每帧调用，但只有状态真的换了才写 DOM
function syncPanelStates() {
  for (let i = 0; i < S.slotEls.length; i++) {
    const el = S.slotEls[i];
    const sel = isPickableSlot(i) && i === S.slotSelectedIndex;
    if (el.classList.contains("selected") !== sel) el.classList.toggle("selected", sel);
  }
  syncButtonLit(S.slotEls[SETTINGS_SLOT_INDEX], S.settingsOpen);
  syncButtonLit(S.slotEls[TUTORIAL_SLOT_INDEX], S.tutorialOpen);
}

// 同步底栏提示：文字只在换内容时写一次，之后每帧只做一次比较
// 一行放不下时整条藏起来：栏里宁肯空着，也不要让文字压到描边上或溢出栏外
function syncBottomBarHint() {
  if (S.hintDom === null) return;
  const text = hintText();
  if (text !== S.hintDomText) {
    S.hintDomText = text;
    S.hintDom.textContent = text;
    S.hintDom.style.visibility = "";
    S.hintDomWidth = 0;  // 内容换了，宽度判定要重来一次
  }
  if (S.hintDomWidth !== state.cssW) {
    S.hintDomWidth = state.cssW;
    S.hintDom.style.visibility = (S.hintDom.scrollWidth > S.hintDom.clientWidth) ? "hidden" : "";
  }
}

// 把简介浮层的外观一次性从 CONFIG / COLOR 注入到 DOM：字号、行高、内边距、圆角、颜色仍集中在配置里
// 只做一次，不必每帧写样式；文本折行交给浏览器，不用再手动测量断行
function initSlotTipDom() {
  S.tipDom.style.padding = CONFIG.panelTipPadY + "px " + CONFIG.panelTipPadX + "px";
  S.tipDom.style.borderRadius = CONFIG.panelTipRadius + "px";
  S.tipDom.style.background = COLOR.tipFill;
  S.tipDom.style.borderColor = COLOR.tipBorder;
  S.tipDom.style.color = COLOR.tipDesc;
  S.tipDomName.style.fontSize = CONFIG.panelTipNameSize + "px";
  S.tipDomName.style.lineHeight = (CONFIG.panelTipNameSize + 5) + "px";
  S.tipDomName.style.color = COLOR.tipName;
  S.tipDomDesc.style.fontSize = CONFIG.panelTipDescSize + "px";
  S.tipDomDesc.style.lineHeight = CONFIG.panelTipLineHeight + "px";
}

// 把简介浮层同步到 DOM：内容只在换槽时写一次，位置、宽度、透明度、位移每帧更新
// 浮层是独立 DOM 层且 z-index 高于元件层，所以网格上有元件时也不会被盖住
function renderSlotTip(vp) {
  const p = S.tipAnim.cur;
  if (S.tipIndex < 0 || p <= 0.001) {
    S.tipDomIndex = -1;
    S.tipDom.style.display = "none";
    return;
  }
  if (S.tipDom.style.display === "none") S.tipDom.style.display = "";
  if (S.tipIndex !== S.tipDomIndex) {
    S.tipDomIndex = S.tipIndex;
    const type = ELEMENT_TYPES[PANEL_SLOT_TYPES[S.tipIndex - ELEMENT_SLOT_BASE]];
    S.tipDomName.textContent = type.name;
    S.tipDomDesc.textContent = type.desc;
  }
  const pos = panelTipRect(vp);
  S.tipDom.style.left = pos.x + "px";
  S.tipDom.style.top = pos.y + "px";
  S.tipDom.style.width = pos.w + "px";
  S.tipDom.style.opacity = p;
  // 未显示时整体上移一段，随进度滑到位：像是从面板里推出来，而不是硬生生冒出来
  S.tipDom.style.transform = "translateY(" + (-(1 - p) * CONFIG.panelTipRise) + "px)";
}
