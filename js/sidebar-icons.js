// sidebar-icons.js：左侧竖栏里用到的那些小图标，全部由 SVG 元素拼出来，配色取自当前元件色。
"use strict";

/* ========== 造小图标 ========== */

/* ========== 造小图标 ========== */

// 图标底座的边长与描边：图形在方框里留出一圈边距，描边按像素给，与列表里其它图标是同一档粗细
const SIDEBAR_ICON_PX = 16;          // 底座边长（CSS px），也是 viewBox 的边长
const SIDEBAR_ICON_GLYPH_PX = 12;    // 图形在底座里占的高度：留出 2px 一圈，描边与圆角才不会顶到框上
const SIDEBAR_ICON_STROKE_PX = 1.3;  // 描边粗细（CSS px）

// 统一的图标底座：尺寸、视图框、无障碍属性都在这里定死，下面几个图形只往里填内容
function makeSidebarSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + SIDEBAR_ICON_PX + " " + SIDEBAR_ICON_PX);
  svg.setAttribute("width", SIDEBAR_ICON_PX);
  svg.setAttribute("height", SIDEBAR_ICON_PX);
  svg.setAttribute("aria-hidden", "true");   // 纯装饰：名称已经由旁边的文字给出，不要让读屏软件再念一遍
  svg.setAttribute("focusable", "false");
  return svg;
}

// 文件夹前面的箭头：画成一个朝下的折线，收起时由样式表整个转成朝右，展开时保持朝下
// 只画一个方向，两种状态共用同一个图形，转的是它本身，所以不会出现两种箭头接不上的情况
function makeChevronSvg() {
  const svg = makeSidebarSvg();
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M5 6.5 L8 9.5 L11 6.5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");   // 颜色跟着行的文字色走，改配色不必动这里
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

// 文件夹的图形路径只写在这里：列表里那一行与右键菜单里那一条，用的是同一串路径
// 同族图形合成一处，菜单里的图标与列表里的不会哪天长得不一样
const SIDEBAR_FOLDER_D = "M2.2 4.2 H6.4 L7.6 5.8 H13.8 V12.2 H2.2 Z";

// 往给定的容器里填一条路径：filled 为真时实心填色，否则只描边
// 实心与描边在项目里是成对用的（文件夹实心、文件描边），合成一处，调用方只管说要不要实心
function appendSidebarPath(box, d, filled) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  if (filled) {
    path.setAttribute("fill", "currentColor");
  } else {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", SIDEBAR_ICON_STROKE_PX);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  box.appendChild(path);
  return path;
}

// 文件夹的图形：实心的一块带一个开口，颜色由 currentColor 给
// 单独造一份、而不是直接塞进图标底座，是为了让右键菜单里那条「新建文件夹」也拿到同一个图形
function makeFolderShape() {
  const group = document.createElementNS(SVG_NS, "g");
  appendSidebarPath(group, SIDEBAR_FOLDER_D, true);
  return group;
}

// 文件夹图标：底座加上那块实心图形
function makeFolderIconSvg() {
  const svg = makeSidebarSvg();
  svg.appendChild(makeFolderShape());
  return svg;
}

// 造一条只描边的图标路径：线粗按图标里的像素给，形状的缩放由调用方在父节点上做，
// 所以这里要把像素值倒推回形状自己的单位——父节点上那道缩放会把它再放大回去
function makeStrokePath(d, k) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");             // 与文件夹分开：文件只描边，缩略图上也能一眼看出哪是文件夹
  path.setAttribute("stroke", "currentColor");   // 颜色跟着图标色走，改配色不必动这里
  path.setAttribute("stroke-width", SIDEBAR_ICON_STROKE_PX / k);
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  return path;
}

// 把形状的原点挪到图标中心、并按 k 缩放的容器
// 下面几个图形各自的坐标都是原点居中（元件本地坐标的原点在格心，纸面坐标的原点在纸的中心），
// 所以图形自己只管按那套坐标写路径，居中与缩放这一步都在这里统一做
function makeCenteredShape(k) {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("transform", "translate(" + SIDEBAR_ICON_PX / 2 + " " + SIDEBAR_ICON_PX / 2 + ") scale(" + k + ")");
  return group;
}

// 存档（.lccas）的图形：非门（反相器）的符号，与画布上、面板槽里画出来的是同一个元件
// 形状不在这里描：直接把元件表里那条路径拿来用（elementPathD），元件改了尺寸图标跟着变，
// 不会出现「图标一个样子、画布上另一个样子」；顶点在元件的本地方位里朝上，画出来就是一个正放的反相器
// 元件本地坐标的原点在格心、一格为 1，符号在本地坐标里上下正好各半，所以只需平移到图标中心
function makeInverterShape() {
  const g = bubbleGeometry("inverter");                         // 顶点、底边、气泡半径都取这一组几何，定义见 element-types.js
  const k = SIDEBAR_ICON_GLYPH_PX / (g.yBase - g.yApex + g.r);  // 符号总高（气泡顶端到底边）缩到 GLYPH_PX
  const group = makeCenteredShape(k);
  group.appendChild(makeStrokePath(elementPathD("inverter"), k));
  return group;
}

// 一页纸的外轮廓（路径的 d 属性）：与上方面板里那个文件按钮同一个形状，数字取自同一组配置
// （纸面半宽半高、圆角半径、右上折角边长），两边不会各画一个纸面
// 顺时针走一圈：顶边→折角斜边→右边→右下圆角→底边→左下圆角→左边→左上圆角；
// 末尾再补一笔折角的小翻边，纸面看起来才是折过来的，而不是缺了一个角
function pageOutlineD() {
  const hw = CONFIG.fileHalfW;
  const hh = CONFIG.fileHalfH;
  const r = CONFIG.fileCornerR;
  const f = CONFIG.fileFoldLen;
  return "M " + (-hw + r) + " " + (-hh) +
    " H " + (hw - f) +
    " L " + hw + " " + (-hh + f) +
    " V " + (hh - r) +
    " A " + r + " " + r + " 0 0 1 " + (hw - r) + " " + hh +
    " H " + (-hw + r) +
    " A " + r + " " + r + " 0 0 1 " + (-hw) + " " + (hh - r) +
    " V " + (-hh + r) +
    " A " + r + " " + r + " 0 0 1 " + (-hw + r) + " " + (-hh) +
    " Z M " + (hw - f) + " " + (-hh) +
    " V " + (-hh + f) + " H " + hw;
}

// Markdown 那一个「#」：两竖两横，位置按纸面的宽高取比例，落在折角下方那块空白里
// 用 # 是因为它就是 Markdown 的记号，与本项目浮动文本里 # 表示标题是同一套说法
function mdHashD() {
  const hw = CONFIG.fileHalfW;
  const hh = CONFIG.fileHalfH;
  const vx = hw * 0.28;      // 两竖离中线的距离
  const hx = hw * 0.72;      // 两横的半长
  const yTop = -hh * 0.25;   // 竖笔的上下端
  const yBot = hh * 0.60;
  const yA = hh * 0.02;      // 两横所在的高度
  const yB = hh * 0.40;
  return " M " + (-vx) + " " + yTop + " V " + yBot +
    " M " + vx + " " + yTop + " V " + yBot +
    " M " + (-hx) + " " + yA + " H " + hx +
    " M " + (-hx) + " " + yB + " H " + hx;
}

// 纯文本文件的图形：一页纸；.md 再添一个「#」，两种文本一眼分得开
function makePageShape(ext) {
  const k = SIDEBAR_ICON_GLYPH_PX / (CONFIG.fileHalfH * 2);   // 纸的总高缩到 GLYPH_PX，宽高同比，纸不会拉歪
  const group = makeCenteredShape(k);
  group.appendChild(makeStrokePath(pageOutlineD() + (ext === MD_EXT ? mdHashD() : ""), k));
  return group;
}

// 取一个文件名的后缀（含那个点、转小写）：列表里的行只拿到名字，图标要按它挑形状
// 名字里没有点、或者点在最前面（形如 .gitignore）都算没有后缀，跟着按普通文件画
function sidebarFileExt(name) {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
}

// 文件图标：按后缀挑形状——.lccas 是电路存档，画反相器；其余（.txt、.md 与别的后缀）都画一页纸
function makeFileIconSvg(ext) {
  const svg = makeSidebarSvg();
  svg.appendChild(ext === SAVE_EXT ? makeInverterShape() : makePageShape(ext));
  return svg;
}

// 右键菜单上那两枚「新建」图标：把传进来的图形缩到左上角，右下角压一枚圆徽章，徽章里是一道加号
// 不另画一套符号：菜单里说「新建文件夹」，用的就是列表里那个文件夹图形，两者是同一句话
// 徽章画在图形之后，整个压在它右下角上，所以图形缩进去多少都不必算得很准
function makeNewEntryIconSvg(shape) {
  const svg = makeSidebarSvg();
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("transform", "translate(-1.4 -1.4) scale(0.82)");   // 缩到左上角，给右下角的徽章让位
  group.appendChild(shape);
  svg.appendChild(group);
  const badge = document.createElementNS(SVG_NS, "circle");
  badge.setAttribute("cx", "12.2");
  badge.setAttribute("cy", "12.2");
  badge.setAttribute("r", "3.4");
  badge.setAttribute("fill", "currentColor");   // 徽章跟着图标色走，与文件、文件夹那两档配色一致
  svg.appendChild(badge);
  // 加号：两笔等长白线，收笔是圆的，与项目里其它描边图标同一套
  const plus = document.createElementNS(SVG_NS, "path");
  plus.setAttribute("d", "M12.2 10.6 V13.8 M10.6 12.2 H13.8");
  plus.setAttribute("fill", "none");
  plus.setAttribute("stroke", "#FFFFFF");
  plus.setAttribute("stroke-width", "1.2");
  plus.setAttribute("stroke-linecap", "round");
  svg.appendChild(plus);
  return svg;
}

// 菜单里「删除」那一条的图标：一只垃圾桶，盖子、提手、桶身、两道竖棱
// 只描边不填色，与列表里那份文件图标同一套笔法；颜色跟随文字，指针压上去时与文字一起转成砖红
function makeTrashIconSvg() {
  const svg = makeSidebarSvg();
  appendSidebarPath(svg,
    "M3.4 4.6 H12.6 M6.3 4.6 V3.3 H9.7 V4.6 M4.9 5.4 V13.2 H11.1 V5.4 M6.9 7.2 V11.4 M9.1 7.2 V11.4",
    false);
  return svg;
}

// 菜单里「更改文件名」那一条的图标：一支铅笔，笔身一道闭合折线，笔尖上再压一道斜线当铅芯
// 与垃圾桶同一套笔法：只描边不填色，颜色跟随文字
function makeRenameIconSvg() {
  const svg = makeSidebarSvg();
  appendSidebarPath(svg,
    "M3.2 12.8 L4.0 9.9 L10.6 3.3 L12.7 5.4 L6.1 12.0 Z M9.5 4.4 L11.6 6.5",
    false);
  return svg;
}

