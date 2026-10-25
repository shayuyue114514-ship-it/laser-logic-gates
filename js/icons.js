// icons.js：图标的形状几何：齿轮、文件、教程、选中、文本、加号、惊叹号。
// 编辑器面板上的按钮与首页的入口菜单共用这一份，同一枚图标只有一处画法，两页不会各自漂移。
// 绘制一律走全局 ctx：编辑器那边由 state.js 提供主画布上下文，首页那边由 home.js 提供它自己的上下文。
"use strict";

/* ========== 图标形状 ========== */

// 图标的默认缩放系数：世界单位 → 屏幕像素
// 编辑器里槽内的图标与元件共用这一档，所以图标和槽里的元件大小天然对齐；首页会传自己的一档进来
function iconDefaultScale() {
  return CONFIG.panelSlotElementLen / CONFIG.elementLen;
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

// 在 Canvas 上描出齿轮的路径：外圈是齿轮点列，另起一条子路径补中心孔
// 两条子路径配合 evenodd 填充，孔才是真的透出槽底色，而不是拿别的颜色盖一块圆上去
function traceGearPath() {
  const pts = gearPoints();
  S.ctx.beginPath();
  S.ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) S.ctx.lineTo(pts[i][0], pts[i][1]);
  S.ctx.closePath();
  // 起点正好落在圆弧的起始角上，所以 moveTo 之后接 arc 不会多出一条连线
  S.ctx.moveTo(CONFIG.gearHoleR, 0);
  S.ctx.arc(0, 0, CONFIG.gearHoleR, 0, Math.PI * 2);
}

// 文件图标的轮廓：一张右上角折起的纸，外框圆角用 arcTo 磨圆，与齿轮的圆角风格一致
// 路径按顺时针走一圈：左上→左下→右下→右边上行到折角→折角斜边→回到左上
function traceFilePath() {
  const hw = CONFIG.fileHalfW;
  const hh = CONFIG.fileHalfH;
  const r = CONFIG.fileCornerR;
  const f = CONFIG.fileFoldLen;
  S.ctx.beginPath();
  S.ctx.moveTo(-hw + r, -hh);                        // 从顶边靠左的位置起笔
  S.ctx.arcTo(-hw, -hh, -hw, -hh + r, r);            // 左上圆角
  S.ctx.lineTo(-hw, hh - r);
  S.ctx.arcTo(-hw, hh, -hw + r, hh, r);              // 左下圆角
  S.ctx.lineTo(hw - r, hh);
  S.ctx.arcTo(hw, hh, hw, hh - r, r);                // 右下圆角
  S.ctx.lineTo(hw, -hh + f);                         // 右边上行，停在折角开始处
  S.ctx.lineTo(hw - f, -hh);                         // 折角的斜边
  S.ctx.lineTo(-hw + r, -hh);
  S.ctx.closePath();
}

/* ========== 图标绘制 ========== */

// 在给定方框里画文件图标：坐标与齿轮同一套世界单位，所以两者大小、粗细天然一致
// 先描折角再描外框，最后统一填充，避免填充把折角线盖掉
// k 省略时取槽内那一档；首页要更大或更小的图标时传自己的系数，形状比例不变
function drawFileIcon(r, k) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = k === undefined ? iconDefaultScale() : k;
  S.ctx.save();
  S.ctx.translate(cx, cy);
  S.ctx.scale(s, s);
  S.ctx.strokeStyle = hslCss(settingsHSL.gearStroke);
  S.ctx.lineWidth = CONFIG.fileStroke;
  S.ctx.lineJoin = "round";  // 折角与圆角都用圆角连接，和元件的圆角风格一致
  traceFilePath();
  S.ctx.fillStyle = hslCss(settingsHSL.gearFill);
  S.ctx.fill();
  S.ctx.stroke();
  // 折角的小翻边：单独描一个 L 形，纸面看起来才是折过来的，而不是缺了一个角
  const hw = CONFIG.fileHalfW;
  const hh = CONFIG.fileHalfH;
  const f = CONFIG.fileFoldLen;
  S.ctx.beginPath();
  S.ctx.moveTo(hw - f, -hh);
  S.ctx.lineTo(hw - f, -hh + f);
  S.ctx.lineTo(hw, -hh + f);
  S.ctx.stroke();
  S.ctx.restore();
}

// 在给定方框里画「教程」图标：外圈与问号的基础几何取自 Lucide / Feather 图标库的 help-circle，问号按本项目的习惯微调过
// 原图是 24×24 网格：外圈是半径 10 的圆、描边 2、圆头圆角；问号在原图基础上把钩上移、补一笔竖、点下移，细节见下方注释
// 换算：先把原图坐标整体减 12 把原点挪到圆心，再乘比例缩到方框内，所以改外缘半径时整幅图标等比缩放
// 圆面填实成与齿轮、文件图标同一支蓝，边框只当一圈细轮廓；问号取边框同色，与圆环呼应成一体
function drawTutorialIcon(r, k) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s0 = k === undefined ? iconDefaultScale() : k;
  const s = CONFIG.tutorialIconOuterR / 11;  // 原图外缘半径是圆半径 10 加半个描边 1，共 11
  const gx = (v) => (v - 12) * s;            // 原图横坐标 → 方框中心坐标：先减半格挪原点，再等比缩小
  const gy = (v) => (v - 12) * s;            // 纵坐标同一比例，两轴一致，图形不会被拉变形
  const markCss = hslCss(settingsHSL.gearStroke);  // 问号颜色：与圆环边框同一支色，内外一个色系
  S.ctx.save();
  S.ctx.translate(cx, cy);
  S.ctx.scale(s0, s0);
  S.ctx.lineCap = "round";   // 原图就是圆头：问号的勾、尾巴和那个点都靠它收得圆润
  S.ctx.lineJoin = "round";
  // 外圈：原图 <circle cx=12 cy=12 r=10>，圆心正好落在方框中心；圆面填实，描边单独用细一档的线宽
  S.ctx.beginPath();
  S.ctx.arc(0, 0, 10 * s, 0, Math.PI * 2);
  S.ctx.fillStyle = hslCss(settingsHSL.gearFill);      // 圆面填色：取齿轮本体那支蓝，与齿轮、文件图标一致
  S.ctx.strokeStyle = hslCss(settingsHSL.gearStroke);  // 边框描边：与齿轮描边同色，粗细另取一支更细的
  S.ctx.lineWidth = CONFIG.tutorialRingStroke;
  S.ctx.fill();
  S.ctx.stroke();
  // 问号主体：在原图路径 M9.09 9 a3 3 0 0 1 5.83 1 c0 2-3 3-3 3 上做了三处调整
  // 一是钩整体上移 0.7 格，二是尾巴改成末端竖直，三是补了一笔短竖，最后把点往下挪 0.7 格
  // 这样钩、尾、竖、点四段上下连贯：钩的末端与尾的起端切线都朝正下方，接缝处不会有折角
  S.ctx.beginPath();
  S.ctx.moveTo(gx(9.09), gy(8.30));
  S.ctx.arc(gx(11.92), gy(9.30), 3 * s, -2.8033, 0.0015, false);  // 弧的扫角沿用原图，只把弧心整体上移
  // 尾：从钩的右下端往下探、边下探边向左靠到中轴，末端切线正好竖直，与下面那笔竖无缝接上
  S.ctx.bezierCurveTo(gx(14.90), gy(11.00), gx(12.00), gy(11.30), gx(12.00), gy(12.30));
  // 竖：原图没有这一笔，是补的；短短一竖压在中轴上，问号才立得住，也才与这套元件的直线风格一致
  S.ctx.lineTo(gx(12.00), gy(14.20));
  S.ctx.strokeStyle = markCss;  // 问号用边框同色描出来，与外面那圈细边框呼应
  S.ctx.lineWidth = 2 * s;      // 问号描边宽度：沿用原图的 2 同比缩小，比圆环略粗一档，缩小后仍看得清
  S.ctx.stroke();
  // 点：原图用一段零长度的线配圆头描边画成；Canvas 对零长度子路径不保证给圆头
  // 所以直接填一个半径等于半个描边宽的圆，观感与原图一致，也更稳妥；位置比原图下移了 0.7 格
  S.ctx.beginPath();
  S.ctx.arc(gx(12), gy(17.70), s, 0, Math.PI * 2);
  S.ctx.fillStyle = markCss;
  S.ctx.fill();
  S.ctx.restore();
}

// 在给定方框里画「关于」图标：一个圆圈里一个惊叹号
// 圆环与符号的画法与教程图标完全同一套（实心圆面 + 细圆环 + 本色符号），两枚图标并排时视觉重量一致
// 惊叹号在原图 24×24 网格里的坐标：竖笔从 y=7.2 到 y=12.8，点落在 y=16.4
function drawAboutIcon(r, k) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s0 = k === undefined ? iconDefaultScale() : k;
  const s = CONFIG.aboutIconOuterR / 11;  // 与教程图标同一个换算比例：外缘半径含半个描边共 11
  const gx = (v) => (v - 12) * s;
  const gy = (v) => (v - 12) * s;
  const markCss = hslCss(settingsHSL.gearStroke);
  S.ctx.save();
  S.ctx.translate(cx, cy);
  S.ctx.scale(s0, s0);
  S.ctx.lineCap = "round";
  S.ctx.beginPath();
  S.ctx.arc(0, 0, 10 * s, 0, Math.PI * 2);
  S.ctx.fillStyle = hslCss(settingsHSL.gearFill);
  S.ctx.strokeStyle = hslCss(settingsHSL.gearStroke);
  S.ctx.lineWidth = CONFIG.aboutIconRingStroke;
  S.ctx.fill();
  S.ctx.stroke();
  // 惊叹号：一笔竖加一个点，用与圆环同色的描边画出来，收笔是圆的，与问号那个点同一套
  S.ctx.beginPath();
  S.ctx.moveTo(gx(12), gy(7.2));
  S.ctx.lineTo(gx(12), gy(12.8));
  S.ctx.strokeStyle = markCss;
  S.ctx.lineWidth = 2 * s;
  S.ctx.stroke();
  S.ctx.beginPath();
  S.ctx.arc(gx(12), gy(16.4), s, 0, Math.PI * 2);
  S.ctx.fillStyle = markCss;
  S.ctx.fill();
  S.ctx.restore();
}

// 在给定方框里画「新建」的加号：两笔圆头描边，收笔的圆与弹窗里那个叉、以及问号那个点同一套
// 加号不画圆面：它是四个入口里唯一一个纯动作项，留白多一点，与另外三枚带圆面的图标区分开
function drawPlusIcon(r, k) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = k === undefined ? iconDefaultScale() : k;
  const arm = CONFIG.plusArm;  // 从中心到笔画末端的长度（世界单位）
  S.ctx.save();
  S.ctx.translate(cx, cy);
  S.ctx.scale(s, s);
  S.ctx.strokeStyle = hslCss(settingsHSL.gearStroke);
  S.ctx.lineWidth = CONFIG.plusStroke;
  S.ctx.lineCap = "round";
  S.ctx.beginPath();
  S.ctx.moveTo(0, -arm);
  S.ctx.lineTo(0, arm);
  S.ctx.moveTo(-arm, 0);
  S.ctx.lineTo(arm, 0);
  S.ctx.stroke();
  S.ctx.restore();
}

// 在给定方框里画「文本」图标：一个字母 T，横笔加竖笔两段
// 选 T 而不是「文」：T 在任何字号下都认得出来，也只用两笔，与加号、叉号那几枚笔划图标同一套收笔
// 竖笔从横笔正中起笔：起笔点与横笔重合成一个交点，不必再补一小段，缩小后也不会断开
function drawTextIcon(r, k) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = k === undefined ? iconDefaultScale() : k;
  S.ctx.save();
  S.ctx.translate(cx, cy);
  S.ctx.scale(s, s);
  S.ctx.strokeStyle = hslCss(settingsHSL.gearStroke);
  S.ctx.lineWidth = CONFIG.textIconStroke;
  S.ctx.lineCap = "round";
  S.ctx.beginPath();
  S.ctx.moveTo(-CONFIG.textIconHalfW, -CONFIG.textIconHalfH);
  S.ctx.lineTo(CONFIG.textIconHalfW, -CONFIG.textIconHalfH);
  S.ctx.moveTo(0, -CONFIG.textIconHalfH);
  S.ctx.lineTo(0, CONFIG.textIconHalfH);
  S.ctx.stroke();
  S.ctx.restore();
}

// 在给定方框里画设置图标：形状与元件共用同一套局部坐标（原点在中心），这里只是平移到方框中心再整体缩放
// 齿轮不参与提亮：亮起的只有底板，齿轮保持原色，两者对比更强，齿形反而比一起变白时更清楚
// 先描边后填充：描边内侧那半被填充盖住、只留外面一圈，与元件的画法保持一致
function drawSettingsIcon(r, k) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = k === undefined ? iconDefaultScale() : k;
  S.ctx.save();
  S.ctx.translate(cx, cy);
  S.ctx.scale(s, s);
  S.ctx.fillStyle = hslCss(settingsHSL.gearFill);
  S.ctx.strokeStyle = hslCss(settingsHSL.gearStroke);
  S.ctx.lineWidth = CONFIG.gearStroke;  // 用世界单位，随缩放一起放大，视觉粗细与槽内元件协调
  S.ctx.lineJoin = "round";             // 齿的尖角靠描边的圆角连接磨圆，与元件的圆角风格一致
  traceGearPath();
  S.ctx.stroke();
  S.ctx.fill("evenodd");  // 必须显式给 evenodd：默认的 nonzero 会把中心孔一起填实，齿轮就成了实心饼
  S.ctx.restore();
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

// 在给定方框里画「选中」图标：一个指针箭头，与其它图标共用同一套局部坐标（原点在方框中心）
// 点列先按包围盒居中、再按高度缩放，所以改形状不必重新算偏移，箭头永远落在方框中心
function drawSelectIcon(r, k) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s0 = k === undefined ? iconDefaultScale() : k;
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
  S.ctx.save();
  S.ctx.translate(cx + CONFIG.selectIconDX * s0, cy);  // 右移量按同一个缩放系数换算成屏幕像素
  S.ctx.scale(s0, s0);
  S.ctx.fillStyle = hslCss(settingsHSL.gearFill);
  S.ctx.strokeStyle = hslCss(settingsHSL.gearStroke);
  S.ctx.lineWidth = CONFIG.selectIconStroke;
  S.ctx.lineJoin = "round";   // 拐角磨圆，与齿轮、文件图标的圆角风格一致
  S.ctx.beginPath();
  for (let i = 0; i < SELECT_ICON_PTS.length; i++) {
    const x = (SELECT_ICON_PTS[i][0] - ox) * s;
    const y = (SELECT_ICON_PTS[i][1] - oy) * s;
    if (i === 0) S.ctx.moveTo(x, y); else S.ctx.lineTo(x, y);
  }
  S.ctx.closePath();
  S.ctx.stroke();   // 先描边后填充：描边内侧那半被填充盖住、只留外面一圈，与元件画法一致
  S.ctx.fill();
  S.ctx.restore();
}