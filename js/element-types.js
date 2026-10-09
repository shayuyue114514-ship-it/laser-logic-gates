// element-types.js：元件类型表与形状几何：点列、SVG 路径、画布路径。
"use strict";

// 形状统一用「本地坐标点列」描述：原点在元件中心、顶点朝 -y（屏幕 y 轴向下，所以 -y 即世界正上方）
// SVG 与 Canvas 两套渲染都从这份点列生成路径，形状只维护一处，两边不会各自漂移
// desc 是悬停选项槽时显示的简介，与形状定义放在一起，新增类型时不会漏写
// blocksH / blocksV 是元件自身坐标下的阻挡属性，旋转后按 dir 映射到全局轴，重建阻挡图时读取
const ELEMENT_TYPES = {
  // 偏转器：等腰三角形，顶点朝上、底边平直
  deflector: {
    name: "偏转器",
    desc: "从任意方向入射的激光都会被偏转到箭头指向的方向。",
    blocksH: true,   // 自身坐标下的水平阻挡：偏转器是镜子，水平来光必须先被截住才谈得上「偏转」
    blocksV: true,   // 自身坐标下的垂直阻挡：同理，垂直来光也要截住
    points: [
      [0, -CONFIG.elementLen / 2],
      [CONFIG.elementWid / 2, CONFIG.elementLen / 2],
      [-CONFIG.elementWid / 2, CONFIG.elementLen / 2]
    ]
  },
  // 透射器：外形同偏转器，但底边朝顶点方向内凹，凹点取底边中点，于是成四边形
  transmitter: {
    name: "透射器",
    desc: "从任意方向入射的激光都会被偏转到箭头指向的方向，但是入射激光会继续向前。",
    blocksH: false,  // 自身坐标下的水平阻挡：不阻挡，水平来光直接穿过，这就是「继续向前」
    blocksV: false,  // 自身坐标下的垂直阻挡：不阻挡，垂直来光同样穿过
    points: [
      [0, -CONFIG.elementLen / 2],
      [CONFIG.elementWid / 2, CONFIG.elementLen / 2],
      [0, CONFIG.elementLen / 2 - CONFIG.elementNotch],
      [-CONFIG.elementWid / 2, CONFIG.elementLen / 2]
    ]
  },
  // 光源：矩形主体 + 尖头三角拼成的五边形，形如一个指向上方的箭头
  // 矩形与三角的分界高度取 len × (headRatio - 0.5)，headRatio 即尖头段占整长的比例
  light: {
    name: "光源",
    desc: "开启时，向前方发出激光。",
    blocksH: true,   // 自身坐标下的水平阻挡：光源是实体，来光到它中心即终止
    blocksV: true,   // 自身坐标下的垂直阻挡：同理
    points: [
      [0, -CONFIG.elementLen / 2],
      [CONFIG.elementWid / 2, CONFIG.elementLen * (CONFIG.elementHeadRatio - 0.5)],
      [CONFIG.elementWid / 2, CONFIG.elementLen / 2],
      [-CONFIG.elementWid / 2, CONFIG.elementLen / 2],
      [-CONFIG.elementWid / 2, CONFIG.elementLen * (CONFIG.elementHeadRatio - 0.5)]
    ]
  },
  // 反相器：等腰三角形 + 顶点上的小圆，即非门符号；气泡画在箭头所指的那一侧
  // 三角形比偏转器矮，气泡圆心正好压在顶点上，两者合起来的高度才放得进一格
  // 形状与偏转器同为实心三角形，所以两个轴都阻挡：输入光必须被截住，否则会穿过它去误触发下游元件
  inverter: {
    name: "反相器",
    desc: "没有收到激光时朝箭头方向发射，一旦收到激光就停止发射。",
    blocksH: true,   // 自身坐标下的水平阻挡：截断输入光，不让它穿过去误触发后面的元件
    blocksV: true,   // 自身坐标下的垂直阻挡：同理
    points: [
      [0, -CONFIG.inverterLen / 2],
      [CONFIG.elementWid / 2, CONFIG.inverterLen / 2],
      [-CONFIG.elementWid / 2, CONFIG.inverterLen / 2]
    ],
    bubble: CONFIG.elementBubbleR  // 气泡半径（世界单位）；只有非门符号带气泡，其他类型没有这个字段
  },
  // 灯：圆角很大的正方形，被激光照到时整块变淡红并向外发淡红光晕
  // 它只作指示，收到光也不发射；形状用 roundRect 描述，两套渲染各自按弧线画，不走点列
  lamp: {
    name: "灯",
    desc: "被激光照射到时亮起。",
    blocksH: true,   // 自身坐标下的水平阻挡：灯是实体，来光到它中心即终止
    blocksV: true,   // 自身坐标下的垂直阻挡：同理，垂直来光也要截住
    // 半边长单独配，取 0.3 比其它元件的 0.35 略小一圈，放在一起时不会显得抢眼
    roundRect: { half: CONFIG.lampHalf, r: CONFIG.lampRadius }
  }
};

// 反相器的最终几何：气泡圆心落在三角形顶点上，整个符号（三角形+气泡）再整体下移，使包围盒在格心居中
// 下移量取半径的一半：气泡只在顶点外侧探出一个半径，取一半正好让上下留白相等，四个朝向旋转都不会出格
// 两侧边在气泡上的交点由「沿侧边走到离顶点一个半径处」解出，SVG 与 Canvas 两套路径共用这组数
function bubbleGeometry(typeId) {
  const dx = CONFIG.elementWid / 2;              // 三角形底边半宽
  const dy = CONFIG.inverterLen;                 // 三角形顶点到底边的竖直长度
  const r = ELEMENT_TYPES[typeId].bubble;        // 气泡半径
  const shift = r / 2;                           // 整体下移量，让「三角形∪气泡」的包围盒在格心居中
  const yApex = -dy / 2 + shift;                 // 顶点 y，同时也是气泡圆心的 y
  const yBase = dy / 2 + shift;                  // 底边 y
  const s = r / Math.sqrt(dx * dx + dy * dy);    // 交点沿侧边的参数：离顶点一个半径处就是切出点
  const half = dx * s;                           // 交点相对圆心的水平偏移
  const drop = dy * s;                           // 交点相对圆心的竖直偏移
  const phi = Math.atan2(half, drop);            // 交点偏离「正下方」的角度，决定圆弧要扫过多大范围
  return { dx: dx, yApex: yApex, yBase: yBase, r: r, half: half, drop: drop, phi: phi };
}

// 把类型点列转成 SVG 的路径字符串（d 属性）
// 带 bubble 的类型（非门）走另一条分支：三角形两侧边在气泡上截断，中间用一段大圆弧接起来
// 于是整条路径就是「三角形∪气泡」的外轮廓，描边只勾一圈，不会在三角形内部多出一道弧线
function elementPathD(typeId) {
  const t = ELEMENT_TYPES[typeId];
  if (t.bubble) {
    const g = bubbleGeometry(typeId);
    const cy = g.yApex + g.drop;                 // 两个交点等高，圆弧从这里起、也从这里落
    // 从左侧交点顺时针绕过顶部到右侧交点：扫过 2π-2φ 超过半圈，所以 large-arc 与 sweep 都取 1
    return "M " + (-g.dx) + " " + g.yBase +
      " L " + (-g.half) + " " + cy +
      " A " + g.r + " " + g.r + " 0 1 1 " + g.half + " " + cy +
      " L " + g.dx + " " + g.yBase + " Z";
  }
  if (t.roundRect) {
    // 圆角正方形：四条直边 + 四段四分之一圆弧，每段弧的 sweep 取 1 表示顺时针接向下一条边
    const h = t.roundRect.half;   // 半边长
    const r = t.roundRect.r;      // 圆角半径
    return "M " + (-h + r) + " " + (-h) +
      " L " + (h - r) + " " + (-h) +
      " A " + r + " " + r + " 0 0 1 " + h + " " + (-h + r) +
      " L " + h + " " + (h - r) +
      " A " + r + " " + r + " 0 0 1 " + (h - r) + " " + h +
      " L " + (-h + r) + " " + h +
      " A " + r + " " + r + " 0 0 1 " + (-h) + " " + (h - r) +
      " L " + (-h) + " " + (-h + r) +
      " A " + r + " " + r + " 0 0 1 " + (-h + r) + " " + (-h) +
      " Z";
  }
  const pts = t.points;
  let d = "M " + pts[0][0] + " " + pts[0][1];
  for (let i = 1; i < pts.length; i++) d += " L " + pts[i][0] + " " + pts[i][1];
  d += " Z";
  return d;
}

// 把类型点列描成 Canvas 路径；调用前坐标系必须已经平移到元件中心并按需缩放好
// 气泡分支与 SVG 侧取同一组几何数，描出的外轮廓完全一致，两边不会各自漂移
function traceElementPath(typeId) {
  const t = ELEMENT_TYPES[typeId];
  ctx.beginPath();
  if (t.bubble) {
    const g = bubbleGeometry(typeId);
    // Canvas 的角度从 +x 轴起、顺时针增大；交点落在「正下方」偏 φ 处，所以起点取 π/2+φ
    const start = Math.PI / 2 + g.phi;
    ctx.moveTo(-g.dx, g.yBase);
    ctx.lineTo(-g.half, g.yApex + g.drop);
    ctx.arc(0, g.yApex, g.r, start, start + (Math.PI * 2 - g.phi * 2), false);
    ctx.lineTo(g.dx, g.yBase);
    ctx.closePath();
    return;
  }
  if (t.roundRect) {
    // 圆角正方形交给标准的 roundRect：x/y 取左上角，宽高是边长的两倍，第 5 个参数直接给圆角半径
    const h = t.roundRect.half;
    ctx.roundRect(-h, -h, h * 2, h * 2, t.roundRect.r);
    return;
  }
  const pts = t.points;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

// 当前选中的元件类型：虚影形状与放置出的元件都取它，切换选择时只改 slotSelectedIndex 这一处
// 槽序号与类型下标差一个基准，减掉它才是类型下标
// 选中槽不是元件槽，没有对应类型，返回 null：调用方据此知道「手上没拿元件」
function selectedTypeId() {
  if (slotSelectedIndex === SELECT_SLOT_INDEX) return null;
  return PANEL_SLOT_TYPES[slotSelectedIndex - ELEMENT_SLOT_BASE];
}

