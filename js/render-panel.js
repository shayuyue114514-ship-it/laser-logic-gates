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

// 齿轮轮廓的点列：每个齿依次走「齿根左→齿顶左→齿顶右→齿根右」，角度单调递增所以不会自交
// 齿根半角大于齿顶半角，齿才呈上窄下宽的梯形；半径用世界单位，画时整体乘缩放，大小自动与元件对齐
function gearPoints() {
  const n = CONFIG.gearTeeth;
  const step = Math.PI * 2 / n;                         // 每个齿占的圆心角
  const tip = CONFIG.gearTipHalfDeg * Math.PI / 180;    // 齿顶半角：决定齿顶那条边的宽度
  const root = CONFIG.gearRootHalfDeg * Math.PI / 180;  // 齿根半角：比齿顶大，差值就是齿的锥度
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = i * step;  // 第 i 个齿的中心角
    pts.push([Math.cos(a - root) * CONFIG.gearRootR, Math.sin(a - root) * CONFIG.gearRootR]);
    pts.push([Math.cos(a - tip) * CONFIG.gearTipR, Math.sin(a - tip) * CONFIG.gearTipR]);
    pts.push([Math.cos(a + tip) * CONFIG.gearTipR, Math.sin(a + tip) * CONFIG.gearTipR]);
    pts.push([Math.cos(a + root) * CONFIG.gearRootR, Math.sin(a + root) * CONFIG.gearRootR]);
  }
  return pts;
}

// 文件图标的轮廓：一张右上角折起的纸，外框圆角用 arcTo 磨圆，与齿轮的圆角风格一致
// 路径按顺时针走一圈：左上→左下→右下→右边上行到折角→折角斜边→回到左上
function traceFilePath() {
  const hw = CONFIG.fileHalfW;
  const hh = CONFIG.fileHalfH;
  const r = CONFIG.fileCornerR;
  const f = CONFIG.fileFoldLen;
  ctx.beginPath();
  ctx.moveTo(-hw + r, -hh);                        // 从顶边靠左的位置起笔
  ctx.arcTo(-hw, -hh, -hw, -hh + r, r);            // 左上圆角
  ctx.lineTo(-hw, hh - r);
  ctx.arcTo(-hw, hh, -hw + r, hh, r);              // 左下圆角
  ctx.lineTo(hw - r, hh);
  ctx.arcTo(hw, hh, hw, hh - r, r);                // 右下圆角
  ctx.lineTo(hw, -hh + f);                         // 右边上行，停在折角开始处
  ctx.lineTo(hw - f, -hh);                         // 折角的斜边
  ctx.lineTo(-hw + r, -hh);
  ctx.closePath();
}

// 在槽内画文件图标：坐标与齿轮同一套世界单位，所以两者大小、粗细天然一致
// 先描折角再描外框，最后统一填充，避免填充把折角线盖掉
function drawFileIcon(r) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const k = CONFIG.panelSlotElementLen / CONFIG.elementLen;  // 与元件槽同一个缩放系数
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.strokeStyle = hslCss(settingsHSL.gearStroke);
  ctx.lineWidth = CONFIG.fileStroke;
  ctx.lineJoin = "round";  // 折角与圆角都用圆角连接，和元件的圆角风格一致
  traceFilePath();
  ctx.fillStyle = hslCss(settingsHSL.gearFill);
  ctx.fill();
  ctx.stroke();
  // 折角的小翻边：单独描一个 L 形，纸面看起来才是折过来的，而不是缺了一个角
  const hw = CONFIG.fileHalfW;
  const hh = CONFIG.fileHalfH;
  const f = CONFIG.fileFoldLen;
  ctx.beginPath();
  ctx.moveTo(hw - f, -hh);
  ctx.lineTo(hw - f, -hh + f);
  ctx.lineTo(hw, -hh + f);
  ctx.stroke();
  ctx.restore();
}

// 在槽内画「教程」图标：外圈与问号的基础几何取自 Lucide / Feather 图标库的 help-circle，问号按本项目的习惯微调过
// 原图是 24×24 网格：外圈是半径 10 的圆、描边 2、圆头圆角；问号在原图基础上把钩上移、补一笔竖、点下移，细节见下方注释
// 换算：先把原图坐标整体减 12 把原点挪到圆心，再乘比例缩到槽内，所以改外缘半径时整幅图标等比缩放
// 圆面填实成与齿轮、文件图标同一支蓝，边框只当一圈细轮廓；问号取边框同色，与圆环呼应成一体
function drawTutorialIcon(r) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const k = CONFIG.panelSlotElementLen / CONFIG.elementLen;  // 与元件槽同一个缩放系数，图标大小天然对齐
  const s = CONFIG.tutorialIconOuterR / 11;  // 原图外缘半径是圆半径 10 加半个描边 1，共 11
  const gx = (v) => (v - 12) * s;            // 原图横坐标 → 槽心坐标：先减半格挪原点，再等比缩小
  const gy = (v) => (v - 12) * s;            // 纵坐标同一比例，两轴一致，图形不会被拉变形
  const markCss = hslCss(settingsHSL.gearStroke);  // 问号颜色：与圆环边框同一支色，内外一个色系
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.lineCap = "round";   // 原图就是圆头：问号的勾、尾巴和那个点都靠它收得圆润
  ctx.lineJoin = "round";
  // 外圈：原图 <circle cx=12 cy=12 r=10>，圆心正好落在槽心；圆面填实，描边单独用细一档的线宽
  ctx.beginPath();
  ctx.arc(0, 0, 10 * s, 0, Math.PI * 2);
  ctx.fillStyle = hslCss(settingsHSL.gearFill);      // 圆面填色：取齿轮本体那支蓝，与齿轮、文件图标一致
  ctx.strokeStyle = hslCss(settingsHSL.gearStroke);  // 边框描边：与齿轮描边同色，粗细另取一支更细的
  ctx.lineWidth = CONFIG.tutorialRingStroke;
  ctx.fill();
  ctx.stroke();
  // 问号主体：在原图路径 M9.09 9 a3 3 0 0 1 5.83 1 c0 2-3 3-3 3 上做了三处调整
  // 一是钩整体上移 0.7 格，二是尾巴改成末端竖直，三是补了一笔短竖，最后把点往下挪 0.7 格
  // 这样钩、尾、竖、点四段上下连贯：钩的末端与尾的起端切线都朝正下方，接缝处不会有折角
  ctx.beginPath();
  ctx.moveTo(gx(9.09), gy(8.30));
  ctx.arc(gx(11.92), gy(9.30), 3 * s, -2.8033, 0.0015, false);  // 弧的扫角沿用原图，只把弧心整体上移
  // 尾：从钩的右下端往下探、边下探边向左靠到中轴，末端切线正好竖直，与下面那笔竖无缝接上
  ctx.bezierCurveTo(gx(14.90), gy(11.00), gx(12.00), gy(11.30), gx(12.00), gy(12.30));
  // 竖：原图没有这一笔，是补的；短短一竖压在中轴上，问号才立得住，也才与这套元件的直线风格一致
  ctx.lineTo(gx(12.00), gy(14.20));
  ctx.strokeStyle = markCss;  // 问号用边框同色描出来，与外面那圈细边框呼应
  ctx.lineWidth = 2 * s;      // 问号描边宽度：沿用原图的 2 同比缩小，比圆环略粗一档，缩小后仍看得清
  ctx.stroke();
  // 点：原图用一段零长度的线配圆头描边画成；Canvas 对零长度子路径不保证给圆头
  // 所以直接填一个半径等于半个描边宽的圆，观感与原图一致，也更稳妥；位置比原图下移了 0.7 格
  ctx.beginPath();
  ctx.arc(gx(12), gy(17.70), s, 0, Math.PI * 2);
  ctx.fillStyle = markCss;
  ctx.fill();
  ctx.restore();
}

// 「选中」指针箭头的轮廓点列（归一化坐标：x 向右、y 向下，左上角是笔尖）
// 存归一化点列而不是直接写世界坐标：以后想调箭头形状只改这几个点，居中和缩放由绘制时算出来
const SELECT_ICON_PTS = [
  [0.08, 0.02],   // 笔尖
  [0.08, 0.78],   // 左边缘向下到底
  [0.28, 0.60],   // 往内收的缺口
  [0.42, 0.95],   // 尾巴左下
  [0.56, 0.88],   // 尾巴右下
  [0.42, 0.55],   // 尾巴右上
  [0.66, 0.55]    // 右侧倒钩
];

// 在槽里画「选中」图标：一个指针箭头，与其它图标共用同一套局部坐标（原点在槽心）
// 点列先按包围盒居中、再按高度缩放，所以改形状不必重新算偏移，箭头永远落在槽心
function drawSelectIcon(r) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const k = CONFIG.panelSlotElementLen / CONFIG.elementLen;  // 与元件槽同一个缩放系数，图标大小天然对齐
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < SELECT_ICON_PTS.length; i++) {
    const p = SELECT_ICON_PTS[i];
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const s = CONFIG.selectIconH / (maxY - minY);  // 按高度定缩放，宽度随形状比例自动得出
  const ox = (minX + maxX) / 2;
  const oy = (minY + maxY) / 2;
  ctx.save();
  ctx.translate(cx + CONFIG.selectIconDX * k, cy);  // 右移量按同一个缩放系数换算成屏幕像素
  ctx.scale(k, k);
  ctx.fillStyle = hslCss(settingsHSL.gearFill);
  ctx.strokeStyle = hslCss(settingsHSL.gearStroke);
  ctx.lineWidth = CONFIG.selectIconStroke;
  ctx.lineJoin = "round";   // 拐角磨圆，与齿轮、文件图标的圆角风格一致
  ctx.beginPath();
  for (let i = 0; i < SELECT_ICON_PTS.length; i++) {
    const x = (SELECT_ICON_PTS[i][0] - ox) * s;
    const y = (SELECT_ICON_PTS[i][1] - oy) * s;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();   // 先描边后填充：描边内侧那半被填充盖住、只留外面一圈，与元件画法一致
  ctx.fill();
  ctx.restore();
}

// 画一个按钮槽：文件与设置两个按钮共用，保证两者的底色、描边、缩放、悬停按下手感完全一致
// 图标由调用方传入并在同一个缩放坐标系里绘制，所以图标必然跟着框一起缩，不会只缩框不缩图标
function drawButtonSlot(r, animIndex, lit, drawIcon) {
  const s = slotAnim[animIndex].cur;  // 按钮当前缩放比例：悬停略缩、按下更缩
  ctx.save();
  // 和元件槽一样绕槽心缩放：框和图标共用这套局部坐标
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  ctx.scale(s, s);
  ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
  ctx.fillStyle = hslLit(settingsHSL.slotFill, lit);
  ctx.lineWidth = 2 / s;  // 线宽除以缩放抵消影响，缩小时描边仍是 2px，不会跟着变细
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, CONFIG.panelSlotRadius);
  ctx.fill();
  ctx.strokeStyle = hslLit(settingsHSL.slotStroke, lit);
  ctx.stroke();
  drawIcon(r);
  ctx.restore();
}

// 在 Canvas 上描出齿轮的路径：外圈是齿轮点列，另起一条子路径补中心孔
// 两条子路径配合 evenodd 填充，孔才是真的透出槽底色，而不是拿别的颜色盖一块圆上去
function traceGearPath() {
  const pts = gearPoints();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  // 起点正好落在圆弧的起始角上，所以 moveTo 之后接 arc 不会多出一条连线
  ctx.moveTo(CONFIG.gearHoleR, 0);
  ctx.arc(0, 0, CONFIG.gearHoleR, 0, Math.PI * 2);
}

// 在槽里画设置图标：形状与元件共用同一套局部坐标（原点在中心），这里只是平移到槽心再整体缩放
// 齿轮不参与提亮：亮起的只有底板，齿轮保持原色，两者对比更强，齿形反而比一起变白时更清楚
// 先描边后填充：描边内侧那半被填充盖住、只留外面一圈，与元件的画法保持一致
function drawSettingsIcon(r) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const k = CONFIG.panelSlotElementLen / CONFIG.elementLen;  // 与元件槽同一个缩放系数，两者大小天然对齐
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.fillStyle = hslCss(settingsHSL.gearFill);
  ctx.strokeStyle = hslCss(settingsHSL.gearStroke);
  ctx.lineWidth = CONFIG.gearStroke;  // 用世界单位，随 k 一起放大，视觉粗细与槽内元件协调
  ctx.lineJoin = "round";             // 齿的尖角靠描边的圆角连接磨圆，与元件的圆角风格一致
  traceGearPath();
  ctx.stroke();
  ctx.fill("evenodd");  // 必须显式给 evenodd：默认的 nonzero 会把中心孔一起填实，齿轮就成了实心饼
  ctx.restore();
}

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
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.fillStyle = hslCss(elementHSL.fill);
  ctx.strokeStyle = hslCss(elementHSL.stroke);
  ctx.lineWidth = CONFIG.elementStroke;  // 描边宽度用世界单位，随 k 一起放大，视觉粗细与网格上的元件对齐
  ctx.lineJoin = "round";                // 圆角靠描边的圆角连接实现，与 SVG 侧的 stroke-linejoin 一致
  // 路径由类型点列生成：和 SVG 侧同一份形状定义，两套渲染不会各自漂移
  traceElementPath(typeId);
  // 先描边后填充：描边内侧那半被填充盖住、只留外面一圈，与 SVG 侧的 paint-order="stroke" 等价
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

// 画面板里的一排选项槽：panelSlotCount 个正方形圆角槽，从面板左内侧起横向排开
// 悬停的槽整体缩小，缩小靠「绕槽心缩放坐标系」实现，所以槽里的元件必然跟着一起缩
function drawPanelSlots(vp) {
  ctx.save();
  for (let i = 0; i < CONFIG.panelSlotCount; i++) {
    const r = panelSlotRect(i, vp);
    const s = slotAnim[i] ? slotAnim[i].cur : 1;  // 该槽当前缩放比例，1 为原尺寸
    const selected = (i === slotSelectedIndex);   // 选中的槽：填充与描边都提亮、描边更粗
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.save();
    // 槽填充硬编码取常量，与调试面板的 HSL 滑块解绑：滑块只当取色沙盒，不影响实际渲染
    ctx.fillStyle = selected ? COLOR.slotFillSelected : COLOR.slotFill;
    // 把坐标系绕槽心缩一下再画：槽和元件共用这套局部坐标，元件自动跟随方框，不会只缩框不缩元件
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    // 线宽除以 s 抵消缩放对描边的影响，缩小时描边仍是设定宽度，不会跟着变细
    ctx.lineWidth = (selected ? CONFIG.slotSelectedBorderWidth : 2) / s;
    ctx.beginPath();
    // roundRect 是标准的 Canvas 2D 方法，第 5 个参数直接给圆角半径
    ctx.roundRect(r.x, r.y, r.w, r.h, CONFIG.panelSlotRadius);
    ctx.fill();
    // 描边：选中的槽略粗且略微提亮，未选中用本色；按下不改色，所以按下不会闪
    ctx.strokeStyle = selected ? COLOR.slotBorderSelected : COLOR.slotBorder;
    ctx.stroke();
    // 选中槽画指针箭头，元件槽画对应元件，其余空槽保持纯色方块
    if (i === SELECT_SLOT_INDEX) drawSelectIcon(r);
    else if (isElementSlot(i)) drawSlotElement(r, PANEL_SLOT_TYPES[i - ELEMENT_SLOT_BASE]);
    ctx.restore();
  }
  // 文件入口：贴在设置入口左边一格，提亮规则与设置入口完全一致，只是各用各的进度标量
  const fileLit = fileLitAnim.cur * CONFIG.settingsLitAmount;  // 文件弹窗打开时的提亮幅度：与设置同一档，两个按钮亮起来才不会一深一浅
  drawButtonSlot(fileSlotRect(vp), FILE_SLOT_INDEX, fileLit, drawFileIcon);
  // 教程入口：再贴在文件入口左边一格，同样各用各的进度标量，三个按钮的亮灭深浅一致
  const tutorialLit = tutorialLitAnim.cur * CONFIG.settingsLitAmount;  // 教程按钮打开时的提亮幅度：与另外两个同一档
  drawButtonSlot(tutorialSlotRect(vp), TUTORIAL_SLOT_INDEX, tutorialLit, drawTutorialIcon);
  // 设置入口：排在左边那排之后、单独贴右边画，所以以后往面板里加元件也不会把它挤走
  const lit = settingsLitAnim.cur * CONFIG.settingsLitAmount;  // 底板打开时的提亮幅度：按进度乘上配置的幅度
  drawButtonSlot(settingsSlotRect(vp), SETTINGS_SLOT_INDEX, lit, drawSettingsIcon);
}

// 把简介浮层的外观一次性从 CONFIG / COLOR 注入到 DOM：字号、行高、内边距、圆角、颜色仍集中在配置里
// 只做一次，不必每帧写样式；文本折行交给浏览器，不用再手动测量断行
function initSlotTipDom() {
  tipDom.style.padding = CONFIG.panelTipPadY + "px " + CONFIG.panelTipPadX + "px";
  tipDom.style.borderRadius = CONFIG.panelTipRadius + "px";
  tipDom.style.background = COLOR.tipFill;
  tipDom.style.borderColor = COLOR.tipBorder;
  tipDom.style.color = COLOR.tipDesc;
  tipDomName.style.fontSize = CONFIG.panelTipNameSize + "px";
  tipDomName.style.lineHeight = (CONFIG.panelTipNameSize + 5) + "px";  // 名称行高：字号再留一点行距，与说明行拉开层次
  tipDomName.style.color = COLOR.tipName;
  tipDomDesc.style.fontSize = CONFIG.panelTipDescSize + "px";
  tipDomDesc.style.lineHeight = CONFIG.panelTipLineHeight + "px";
}

// 把简介浮层同步到 DOM：内容只在换槽时写一次，位置、宽度、透明度、位移每帧更新
// 浮层是独立 DOM 层且 z-index 高于元件层，所以网格上有元件时也不会被盖住
function renderSlotTip(vp) {
  const p = tipAnim.cur;  // 显隐进度：0 全隐、1 全显
  // 收起状态直接隐藏：连同已写入的槽序号一起清掉，下次显示一定重写内容
  if (tipIndex < 0 || p <= 0.001) {
    tipDomIndex = -1;
    tipDom.style.display = "none";
    return;
  }
  if (tipDom.style.display === "none") tipDom.style.display = "";
  // 内容只在换槽时写：同一槽连续多帧不重复改 DOM
  if (tipIndex !== tipDomIndex) {
    tipDomIndex = tipIndex;
    const type = ELEMENT_TYPES[PANEL_SLOT_TYPES[tipIndex - ELEMENT_SLOT_BASE]];
    tipDomName.textContent = type.name;
    tipDomDesc.textContent = type.desc;
  }
  const pos = panelTipRect(vp);
  tipDom.style.left = pos.x + "px";
  tipDom.style.top = pos.y + "px";
  tipDom.style.width = pos.w + "px";
  tipDom.style.opacity = p;
  // 未显示时整体上移一段，随进度滑到位：像是从面板里推出来，而不是硬生生冒出来
  tipDom.style.transform = "translateY(" + (-(1 - p) * CONFIG.panelTipRise) + "px)";
}

