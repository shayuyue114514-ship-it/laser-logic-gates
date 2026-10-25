// render-panel.js：面板绘制：选项槽矩形、各图标、元件槽内容、悬停简介浮层。
"use strict";

// 第 i 个选项槽的矩形：绘制与鼠标命中判定共用这一个函数，保证「看到的框」和「判定区」永远一致
// 槽恒为正方形，边长取固定常量而不是面板高度：面板以后调整高度，槽的尺寸不会跟着变
function panelSlotRect(i, vp) {
  const pad = CONFIG.panelSlotPad;
  const side = CONFIG.panelSlotSide;
  return {
    x: vp.x + 2 + pad + i * (side + CONFIG.panelSlotGap),  // 从面板左内侧起横向排开
    y: CONFIG.panelGap + 2 + pad,
    w: side,
    h: side
  };
}

// 设置入口槽的矩形：与元件槽同尺寸、同一行的 y，但贴在面板右内侧，序号排在元件槽之后
// 右内缩用和左边同一个 pad：左右留白对称，槽不会贴到面板边框上，以后加元件也挤不走它
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

// 文件入口槽的矩形：尺寸与 y 直接沿用设置入口，只把横坐标往左挪一格加一个间隔
// 这样两个按钮永远同高同宽、间距等于元件槽之间的间隔，面板宽度变了也不会错位
function fileSlotRect(vp) {
  const sr = settingsSlotRect(vp);
  return {
    x: sr.x - CONFIG.panelSlotSide - CONFIG.panelSlotGap,
    y: sr.y,
    w: sr.w,
    h: sr.h
  };
}

// 教程入口槽的矩形：尺寸与 y 沿用文件入口，横坐标再往左挪一格加一个间隔
// 三个按钮永远同高同宽、间距等于元件槽之间的间隔，面板宽度变了也不会错位
function tutorialSlotRect(vp) {
  const fr = fileSlotRect(vp);
  return {
    x: fr.x - CONFIG.panelSlotSide - CONFIG.panelSlotGap,
    y: fr.y,
    w: fr.w,
    h: fr.h
  };
}

// 图标的形状几何与画法统一放在 icons.js：齿轮、文件、教程、关于、新建、选中六枚图标只有那一处画法
// 编辑器面板与首页入口菜单共用同一份，两页的图标不会各自漂移；这里不再重复定义

// 画一个按钮槽：文件与设置两个按钮共用，保证两者的底色、描边、缩放、悬停按下手感完全一致
// 图标由调用方传入并在同一个缩放坐标系里绘制，所以图标必然跟着框一起缩，不会只缩框不缩图标
function drawButtonSlot(r, animIndex, lit, drawIcon) {
  const s = S.slotAnim[animIndex].cur;  // 按钮当前缩放比例：悬停略缩、按下更缩
  S.ctx.save();
  // 和元件槽一样绕槽心缩放：框和图标共用这套局部坐标
  S.ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  S.ctx.scale(s, s);
  S.ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
  S.ctx.fillStyle = hslLit(settingsHSL.slotFill, lit);
  S.ctx.lineWidth = 2 / s;  // 线宽除以缩放抵消影响，缩小时描边仍是 2px，不会跟着变细
  S.ctx.beginPath();
  S.ctx.roundRect(r.x, r.y, r.w, r.h, CONFIG.panelSlotRadius);
  S.ctx.fill();
  S.ctx.strokeStyle = hslLit(settingsHSL.slotStroke, lit);
  S.ctx.stroke();
  drawIcon(r);
  S.ctx.restore();
}

// 齿轮路径与齿轮图标同样归 icons.js：编辑器面板与首页共用同一份，这里不再重复定义

// 简介浮层的位置：紧贴面板矩形下边缘再留一点间隔，向下盖在网格上
// 不占面板高度，所以面板维持原高度、网格区域也不被压缩
function panelTipRect(vp) {
  const pad = CONFIG.panelSlotPad;
  return {
    x: vp.x + 2 + pad,                              // 与槽一样从面板左内侧起
    y: vp.y - CONFIG.panelGap + CONFIG.panelTipGap, // 面板矩形下边缘再往下一点
    w: vp.w - 4 - pad * 2                           // 横跨面板内宽
  };
}

// 在槽内画指定类型的元件：形状与网格上的元件同一套本地坐标（原点在元件中心、顶点朝 -y），这里只是平移到槽心再整体缩放
function drawSlotElement(r, typeId) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  // 缩放系数 = 槽内期望长度 / 元件的世界单位长度，形状比例因此和网格上的元件完全一致
  const k = CONFIG.panelSlotElementLen / CONFIG.elementLen;
  S.ctx.save();
  S.ctx.translate(cx, cy);
  S.ctx.scale(k, k);
  S.ctx.fillStyle = hslCss(elementHSL.fill);
  S.ctx.strokeStyle = hslCss(elementHSL.stroke);
  S.ctx.lineWidth = CONFIG.elementStroke;  // 描边宽度用世界单位，随 k 一起放大，视觉粗细与网格上的元件对齐
  S.ctx.lineJoin = "round";                // 圆角靠描边的圆角连接实现，与 SVG 侧的 stroke-linejoin 一致
  // 路径由类型点列生成：和 SVG 侧同一份形状定义，两套渲染不会各自漂移
  traceElementPath(typeId);
  // 先描边后填充：描边内侧那半被填充盖住、只留外面一圈，与 SVG 侧的 paint-order="stroke" 等价
  S.ctx.stroke();
  S.ctx.fill();
  S.ctx.restore();
}

// 画面板里的一排选项槽：panelSlotCount 个正方形圆角槽，从面板左内侧起横向排开
// 悬停的槽整体缩小，缩小靠「绕槽心缩放坐标系」实现，所以槽里的元件必然跟着一起缩
function drawPanelSlots(vp) {
  S.ctx.save();
  for (let i = 0; i < CONFIG.panelSlotCount; i++) {
    const r = panelSlotRect(i, vp);
    const s = S.slotAnim[i] ? S.slotAnim[i].cur : 1;  // 该槽当前缩放比例，1 为原尺寸
    const selected = (i === S.slotSelectedIndex);   // 选中的槽：填充与描边都提亮、描边更粗
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    S.ctx.save();
    // 槽填充硬编码取常量，与调试面板的 HSL 滑块解绑：滑块只当取色沙盒，不影响实际渲染
    S.ctx.fillStyle = selected ? COLOR.slotFillSelected : COLOR.slotFill;
    // 把坐标系绕槽心缩一下再画：槽和元件共用这套局部坐标，元件自动跟随方框，不会只缩框不缩元件
    S.ctx.translate(cx, cy);
    S.ctx.scale(s, s);
    S.ctx.translate(-cx, -cy);
    // 线宽除以 s 抵消缩放对描边的影响，缩小时描边仍是设定宽度，不会跟着变细
    S.ctx.lineWidth = (selected ? CONFIG.slotSelectedBorderWidth : 2) / s;
    S.ctx.beginPath();
    // roundRect 是标准的 Canvas 2D 方法，第 5 个参数直接给圆角半径
    S.ctx.roundRect(r.x, r.y, r.w, r.h, CONFIG.panelSlotRadius);
    S.ctx.fill();
    // 描边：选中的槽略粗且略微提亮，未选中用本色；按下不改色，所以按下不会闪
    S.ctx.strokeStyle = selected ? COLOR.slotBorderSelected : COLOR.slotBorder;
    S.ctx.stroke();
    // 选中槽画指针箭头，元件槽画对应元件，文本槽画一个 T 形，其余空槽保持纯色方块
    if (i === SELECT_SLOT_INDEX) drawSelectIcon(r);
    else if (isElementSlot(i)) drawSlotElement(r, PANEL_SLOT_TYPES[i - ELEMENT_SLOT_BASE]);
    else if (i === TEXT_SLOT_INDEX) drawTextIcon(r);
    S.ctx.restore();
  }
  // 文件入口：贴在设置入口左边一格，提亮规则与设置入口完全一致，只是各用各的进度标量
  const fileLit = S.fileLitAnim.cur * CONFIG.settingsLitAmount;  // 文件弹窗打开时的提亮幅度：与设置同一档，两个按钮亮起来才不会一深一浅
  drawButtonSlot(fileSlotRect(vp), FILE_SLOT_INDEX, fileLit, drawFileIcon);
  // 教程入口：再贴在文件入口左边一格，同样各用各的进度标量，三个按钮的亮灭深浅一致
  const tutorialLit = S.tutorialLitAnim.cur * CONFIG.settingsLitAmount;  // 教程按钮打开时的提亮幅度：与另外两个同一档
  drawButtonSlot(tutorialSlotRect(vp), TUTORIAL_SLOT_INDEX, tutorialLit, drawTutorialIcon);
  // 设置入口：排在左边那排之后、单独贴右边画，所以以后往面板里加元件也不会把它挤走
  const lit = S.settingsLitAnim.cur * CONFIG.settingsLitAmount;  // 底板打开时的提亮幅度：按进度乘上配置的幅度
  drawButtonSlot(settingsSlotRect(vp), SETTINGS_SLOT_INDEX, lit, drawSettingsIcon);
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
  S.tipDomName.style.lineHeight = (CONFIG.panelTipNameSize + 5) + "px";  // 名称行高：字号再留一点行距，与说明行拉开层次
  S.tipDomName.style.color = COLOR.tipName;
  S.tipDomDesc.style.fontSize = CONFIG.panelTipDescSize + "px";
  S.tipDomDesc.style.lineHeight = CONFIG.panelTipLineHeight + "px";
}

// 把简介浮层同步到 DOM：内容只在换槽时写一次，位置、宽度、透明度、位移每帧更新
// 浮层是独立 DOM 层且 z-index 高于元件层，所以网格上有元件时也不会被盖住
function renderSlotTip(vp) {
  const p = S.tipAnim.cur;  // 显隐进度：0 全隐、1 全显
  // 收起状态直接隐藏：连同已写入的槽序号一起清掉，下次显示一定重写内容
  if (S.tipIndex < 0 || p <= 0.001) {
    S.tipDomIndex = -1;
    S.tipDom.style.display = "none";
    return;
  }
  if (S.tipDom.style.display === "none") S.tipDom.style.display = "";
  // 内容只在换槽时写：同一槽连续多帧不重复改 DOM
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

