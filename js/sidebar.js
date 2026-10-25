// sidebar.js：左侧竖栏里的存档列表：读出所选文件夹里的条目铺成树；点根目录名可以换一个文件夹。
"use strict";

/* ========== 列表数据 ========== */

// 一条条目长这样：
//   文件夹 { name, isFolder:true, children:Array, open, loaded, handle }
//   文件   { name, isFolder:false, handle, dirty, saving, scene }
//   open    这一层当前是展开还是收起，只管显示，与磁盘无关
//   loaded  下级是否已经从磁盘读过；false 表示还没读，展开时再去读
//   handle  这个条目在磁盘上的句柄：文件夹的是目录句柄，文件的是文件句柄
//   sel     当前打开的那一条，只有文件用得上
//   dirty   有没有未保存的改动，只有文件用得上：改过就亮，保存成功才灭，切到别的文件也不会灭
//   saving  正在把这一份写进磁盘，只有文件用得上：写盘可能要好几秒，这期间圆点原地呼吸，写完就停
//   scene   这次会话里为它存下的那份未保存改动（与存档同一个结构）；null 表示没有，切回来时按磁盘上的内容读

// 还没选过文件夹时列表是空的：竖栏里只有一行标题、一句说明和一个「选择文件夹」按钮
// 选过之后才换成那一层的真实条目，所以这里从 null 起步，null 就代表「还没有工作区」
// 工作区根节点是 { name, handle, children }：handle 是那个文件夹的目录句柄，
// 往根目录里新建条目要用它，所以它必须一直留在树上，不能读完就把句柄丢掉
let currentTree = null;

// 菜单里那条「删除」：它只在文件行上出现，所以留个引用，右键时按落点决定藏还是露
// 只做文件不做文件夹：删文件夹要连里面的一起删，是一次不可逆的批量动作，不该放在顺手就能点到的地方
let sidebarDeleteItem = null;

// 菜单里那条「更改文件名」：文件与文件夹都能改，所以它只在没压中条目行（标题行、空白处）时才藏起来
let sidebarRenameItem = null;
// 改名进行中的几个对象：目标节点、原位那行输入、被暂时藏起来的那一行、以及原后缀
let sidebarRenameNode = null;       // object|null：正在改名的条目节点（文件或文件夹）
let sidebarRenameRow = null;        // object|null：{ root, input, hint, baseLen }，就地输入行
let sidebarRenameHiddenRow = null;  // HTMLElement|null：原来那一行，改名期间整行藏起来
let sidebarRenameExt = "";          // string：原后缀（含点、小写）；文件夹是空串，文件的后缀不许换

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

/* ========== 读磁盘 ========== */

// 同一层里的排序：文件夹在前，同类之间按名字排
// 磁盘返回的顺序是随机的，照原样铺出来每次都不一样，看着乱
function bySidebarName(a, b) {
  return a.name.localeCompare(b.name, "zh");
}

// 把一层条目排好并返回新数组：文件夹在前，同类之间按名字排
// 读磁盘与新建条目两条路都走它，新插进来的条目与读出来的混在同一层时，顺序才是一致的
function sortSidebarLevel(nodes) {
  const folders = [];
  const files = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].isFolder === true) folders.push(nodes[i]);
    else files.push(nodes[i]);
  }
  folders.sort(bySidebarName);
  files.sort(bySidebarName);
  return folders.concat(files);   // 文件夹在前、文件在后，两类各自已经排好
}

// 读一个文件夹下的条目，返回可以直接铺进列表的一层节点
// 只取每个条目的名字与类型，不去读文件内容；子文件夹要等展开时才读
// 否则选中一个深目录的那一刻，整棵子树就被全部读了进来，而其中大部分根本不会被展开
async function readDirectoryEntries(dirHandle) {
  const nodes = [];
  for await (const entry of dirHandle.values()) {   // 目录句柄本身是可异步遍历的，一次给一个条目
    if (entry.kind === "directory") {
      // 刚读到的文件夹只占个位：下级留空并标记未读，展开时再补
      nodes.push({ name: entry.name, isFolder: true, open: false, loaded: false, children: [], handle: entry });
    } else {
      nodes.push({ name: entry.name, isFolder: false, handle: entry, dirty: false, saving: false, scene: null });
    }
  }
  return sortSidebarLevel(nodes);
}

// 展开一个还没读过的文件夹：把它的下级从磁盘读出来补上，成功返回 true
// 读失败（权限被收回、文件夹已被删掉）时保持未读状态，下次点还会再试一次，不会把节点卡成一片空白
async function loadSidebarFolder(node) {
  try {
    node.children = await readDirectoryEntries(node.handle);
    node.loaded = true;
    return true;
  } catch (err) {
    console.log("[列表] 读取 " + node.name + " 失败：", err);
    return false;
  }
}

/* ========== 画树 ========== */

// 整棵重画：列表不大，重画比逐行改类更省事，也不会留下上一轮的开合与高亮状态
// 还没有工作区时画空状态：一行标题、一句说明、一个整条宽的按钮
function buildSidebarTree() {
  // 行要重画了，先把小窗收掉：它挂着的那个行元素马上就不存在，不收就会留在原地不走
  hideSidebarTip();
  sidebarTreeDom.textContent = "";   // 清空走 textContent：不经过 HTML 解析，名称里带什么字符都不会被当成标签
  if (currentTree === null) {
    // 空状态照资源管理器那种排法自上而下摆：一行标题、一句说明、几条整条宽的按钮
    // 标题与有工作区时的根目录名同一档字重，但它不可点，所以只是一个普通的行，不带任何交互
    sidebarTreeDom.className = "is-empty";
    const title = document.createElement("div");
    title.className = "sb-empty-title";
    const titleIcon = makeFolderIconSvg();
    titleIcon.setAttribute("class", "sb-icon folder");
    title.appendChild(titleIcon);
    const titleText = document.createElement("span");
    titleText.className = "sb-label";
    titleText.textContent = "无打开的工作区";
    title.appendChild(titleText);
    sidebarTreeDom.appendChild(title);
    const hint = document.createElement("div");
    hint.className = "sb-empty-hint";
    // 有一条「继续打开」摆着时，说明换成上次那个文件夹的名字：一眼看得出点它会进哪儿
    hint.textContent = sidebarResumeHandle === null
      ? "尚未选择工作区文件夹。"
      : "上次的工作区：" + sidebarResumeHandle.name;   // 名字是数据，用 textContent 写入，不做任何转义或拼接
    sidebarTreeDom.appendChild(hint);
    // 「继续打开」：上一次用过的文件夹还记着，点这一下就是浏览器要求的那个手势，点完就进去
    // 排在最前面：接着上次继续干活通常是最想点的那一个；样式全部来自 sb-pick，只有与下一条之间的间距另给
    // 它另带一个 sb-resume 类，点击时靠它把这条与「另选一个文件夹」分开，否则两者外观一样、判不出谁是谁
    if (sidebarResumeHandle !== null) {
      const resume = document.createElement("button");
      resume.className = "sb-pick sb-resume";
      resume.type = "button";
      resume.textContent = "继续打开";
      sidebarTreeDom.appendChild(resume);
    }
    const pick = document.createElement("button");
    pick.className = "sb-pick";
    pick.type = "button";
    pick.textContent = "选择文件夹";
    sidebarTreeDom.appendChild(pick);
    // 「打开文件」：与「选择文件夹」同一套外观，紧挨在它下面
    // 两者做的是两件不同的事：上面那个是选一个文件夹当工作区，这一个只打开单独一份存档，不建工作区
    // 所以它另带一个 sb-open-file 类，点击时靠它把两者分开；样式仍全部来自 sb-pick，不必另写一套
    const openFile = document.createElement("button");
    openFile.className = "sb-pick sb-open-file";
    openFile.type = "button";
    openFile.textContent = "打开文件";
    sidebarTreeDom.appendChild(openFile);
    return;
  }
  sidebarTreeDom.className = "";   // 有工作区了就把空状态的居中布局摘掉，恢复成一行一行的列表
  const header = document.createElement("div");
  header.className = "sb-header";
  const headerIcon = makeFolderIconSvg();   // 根目录名前面也放一个文件夹图标：它就是这一树的顶层容器
  headerIcon.setAttribute("class", "sb-icon folder");
  header.appendChild(headerIcon);
  const headerName = document.createElement("span");
  headerName.className = "sb-label";
  headerName.textContent = currentTree.name;   // 名称是数据，用 textContent 写入，不做任何转义或拼接
  header.appendChild(headerName);
  sidebarTreeDom.appendChild(header);
  renderSidebarNodes(currentTree.children, 0);
  // 正在新建时把输入行补回去：整棵重画会把那一行连同 DOM 一起清掉，重画后要重新摆上
  if (sidebarCreateKind !== "") placeSidebarNewRow();
}

// 把一个层级的条目逐行画出来：depth 只决定行首画几根缩进导引条，其余排法每一层都一样
function renderSidebarNodes(nodes, depth) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isFolder = node.isFolder === true;   // 类型是条目自带的，不再靠「有没有下级」反推

    const row = document.createElement("div");
    row.className = "sb-row " + (isFolder ? "is-folder" : "is-file");
    if (node.sel === true) row.classList.add("is-selected");

    // 缩进导引条：每一级一根竖线，线的位置正对上一级箭头的中线，顺着线能看出这一行挂在谁下面
    for (let d = 0; d < depth; d++) {
      const guide = document.createElement("span");
      guide.className = "sb-guide";
      row.appendChild(guide);
    }

    if (isFolder) {
      const chev = document.createElement("span");
      chev.className = "sb-chev " + (node.open === true ? "is-open" : "is-closed");
      chev.appendChild(makeChevronSvg());
      row.appendChild(chev);
    } else {
      // 文件没有箭头，但也要占住同样的宽度，否则文件行的图标会比文件夹行整体左移一格
      const blank = document.createElement("span");
      blank.className = "sb-chev is-blank";
      row.appendChild(blank);
    }

    // 图标按后缀挑：存档画反相器，纯文本与其它后缀画一页纸
    const icon = isFolder ? makeFolderIconSvg() : makeFileIconSvg(sidebarFileExt(node.name));
    icon.setAttribute("class", isFolder ? "sb-icon folder" : "sb-icon file");
    row.appendChild(icon);

    // 未保存的圆点：夹在图标与名字之间
    // 常驻在行里、只靠 is-on 改宽度与浓淡，而不是亮的时候现插一个进来：
    // 现插的元素没有起始状态可过渡，那一下缓动就没了；文件夹不标这个点
    if (!isFolder) {
      const dot = document.createElement("span");
      // 写盘中的呼吸与未保存的亮起是两个独立的类名：写完只摘掉呼吸那个，圆点的亮灭仍由 is-on 说了算
      dot.className = "sb-dot" + (node.dirty === true ? " is-on" : "") + (node.saving === true ? " is-saving" : "");
      row.appendChild(dot);
    }

    const label = document.createElement("span");
    label.className = "sb-label";
    label.textContent = node.name;   // 名称是数据，用 textContent 写入，不做任何转义或拼接
    row.appendChild(label);

    // 把这一行对应的节点挂在元素上：点击时直接取回来，不必另存一张行与数据的对照表
    row.sidebarNode = node;
    sidebarTreeDom.appendChild(row);

    // 展开的文件夹才往下画：收起时它的下级根本不进 DOM，行数与滚动高度自然跟着变
    if (isFolder && node.open === true) renderSidebarNodes(node.children, depth + 1);
  }
}

/* ========== 交互 ========== */

/* ========== 未保存的标记 ========== */

// 找出某个节点此刻对应的行元素：每次重画行元素都是新的一批，所以不能把行元素存在节点上，只能现找
function findSidebarRow(node) {
  const rows = sidebarTreeDom.querySelectorAll(".sb-row");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sidebarNode === node) return rows[i];
  }
  return null;   // 这一行此刻没画出来（比如它所在的文件夹正收着），下次重画时自然会按新状态画
}

// 把某一行的圆点刷成这个节点此刻的样子：亮不亮看有没有未保存的改动，呼吸不呼吸看是不是正在写盘
// 只切类名、不重画整棵树：同一个圆点元素从头用到尾，宽度与浓淡那两下缓动才走得出来
function paintSidebarDot(node) {
  const row = findSidebarRow(node);
  if (row === null) return;   // 这一行此刻没画出来（比如它所在的那层正收着），下次重画时会照节点上的状态补上
  const dot = row.querySelector(".sb-dot");
  if (dot === null) return;
  dot.classList.toggle("is-on", node.dirty === true);
  dot.classList.toggle("is-saving", node.saving === true);
}

// 记下「这一份正在写盘」，并立刻把圆点刷出来，不等下一帧
// 写盘那一下可能要好几秒，这段时间圆点原地呼吸，让人看得出是在等；写完（无论成败）都要收回去
function setNodeSaving(node, saving) {
  if (node === null) return;   // 从系统文件框打开的，列表里没有对应行，没有圆点可呼吸
  node.saving = saving;
  paintSidebarDot(node);
}

// 把「当前电路有未保存的改动」同步到列表里那一条的圆点上
// 主循环每帧都调它，但只在状态真的翻转时才动 DOM，所以平时的代价只是一次布尔比较
function syncSidebarDirty() {
  if (openFileNode === null) return;             // 当前文件不是从列表打开的，没有哪一行可标
  if (openFileNode.dirty === docDirty) return;   // 状态没变就不动，不必每帧去翻一遍行元素
  openFileNode.dirty = docDirty;
  paintSidebarDot(openFileNode);
}

// 把整棵树里的高亮标记清掉：点开另一条时先把旧的抹掉，否则会出现两条同时高亮
function clearSidebarSelection(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    node.sel = false;
    if (node.isFolder === true && node.children !== null) clearSidebarSelection(node.children);
  }
}

// 整棵树里有没有存着没保存的改动：逐层扫一遍，哪一条挂着 scene 就算有
// 当前画面上那份没保存的改动不在这里查，它在 docDirty 里，两者要合起来看才完整
function hasStashedChanges(nodes) {
  if (nodes === null) return false;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.isFolder === true) {
      if (hasStashedChanges(node.children)) return true;
    } else if (node.scene !== null) {
      return true;
    }
  }
  return false;
}

// 点根目录名：换一个文件夹当工作区
// 流程是——先弹系统框问你选哪个文件夹，再确认一次读写权限，然后把这一层读出来铺进列表
// 根目录名同时换成这个文件夹的真实名字；不往磁盘写任何东西，也不记在浏览器里
// 换文件夹会把手上没保存的东西一起丢掉（当前画面上那份改动，以及各条里暂存的那几份），
// 所以先问一句「确定要丢弃吗」，点头之前的任何一步都不动现有的列表与画面
async function onChangeFolder() {
  // 已经有一个问题在等了就别再开一个：再点一次根目录名会把上一个问题顶掉，
  // 而上一段流程还在原地等它的答案，永远等不到
  if (confirmOpen) return;
  // 目录选择能力：Firefox 与 Safari 都没有，先判一下，不支持就只留一句日志，不往下走
  if (!("showDirectoryPicker" in window)) {
    console.log("[列表] 当前浏览器不支持直接选文件夹");
    return;
  }
  // 有没保存的东西就先问，再决定要不要弹文件夹选择框
  // 顺序反过来的话，用户挑完文件夹才被告知要丢东西，那时候他已经白挑了一趟
  // 只在「换」文件夹时问：还没有工作区时那个按钮是「选择文件夹」，选一个进来不会丢任何东西，
  // 那种情况下弹这句问话就是虚惊一场
  if (currentTree !== null && (docDirty === true || hasStashedChanges(currentTree))) {
    const discard = await askConfirm("仍有未保存的更改。确定要丢弃吗？");
    // 不答应就整个作罢：文件夹选择框不弹，列表与画面上的一切保持原样，没丢任何东西
    if (!discard) return;
    // 点头之后到真正读成新文件夹之间还有好几步都可能失败（选择框取消、权限被拒、读取出错），
    // 所以这里只是「同意丢掉」，真正的丢弃发生在下面新树铺成的那一刻：那之前中途退出都不算数
  }
  let handle;
  try {
    // 必须在点击这类用户手势里调用，否则浏览器会以安全错误拒绝
    handle = await window.showDirectoryPicker({ mode: "readwrite" });
  } catch (err) {
    // 用户按取消不是错误，静默收场；其它错误才报出来，免得一次取消就刷一条日志
    if (err.name !== "AbortError") console.log("[列表] 文件夹选择框出错：", err);
    return;
  }
  let perm = "";
  try {
    // 拿到句柄不等于一直有权限：先问一次现状，不是已授权就再申请一次，申请会弹浏览器的权限询问
    perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") perm = await handle.requestPermission({ mode: "readwrite" });
  } catch (err) {
    console.log("[列表] 权限确认出错：", err);
    return;
  }
  // 读与接都交给 adoptWorkspaceFolder：与「继续打开上次的工作区」走同一条路，两边规则只有一份
  // 读失败时列表仍是原来那棵，不会变成一个空壳，所以这里什么都不做
  if (await adoptWorkspaceFolder(handle)) console.log("[列表] 文件夹权限：" + perm);
}

// 把一个目录接成工作区：读出第一层铺进列表，并把句柄记进库，下次打开页面就接着打开它
// 换工作区（onChangeFolder）与接着打开上次的工作区（resumeWorkspaceNow）两条路都走它，规则只有一份
// 读不出来（权限被收回、文件夹已被删掉或挪走）返回 false 且不动列表，由调用方决定怎么收场
async function adoptWorkspaceFolder(handle) {
  let children;
  try {
    children = await readDirectoryEntries(handle);   // 只读这一层，子文件夹留着展开时再读
  } catch (err) {
    console.log("[列表] 读取文件夹 " + handle.name + " 失败：", err);
    return false;
  }
  // 句柄一并留在树上：往这一层里新建条目时要靠它，丢了就只能在子文件夹里新建，根目录下建不了
  currentTree = { name: handle.name, handle: handle, children: children };
  sidebarResumeHandle = null;       // 真的打开了，空状态里那条入口不再需要
  rememberWorkspaceHandle(handle);  // 记进库：下次打开页面直接接着打开它
  buildSidebarTree();
  console.log("[列表] 已载入文件夹 " + handle.name + "，共 " + children.length + " 条");
  return true;
}

// 启动时试着接着打开上次的工作区：库里那份目录句柄由 main.js 先读回内存，再走这里
// 能不能不用点就进去由浏览器说了算：权限若跨会话留住了（Chrome 里上次授权选的是「每次访问都允许」，
// 或者页面是以装好的应用打开的），这一步就直接把列表铺出来；若还差一次授权，就把入口摆进空状态等一次点击
// 明确被拒绝过就什么都不摆：点了也只会立刻回一个 denied，摆在那里反而像是能用
async function resumeWorkspace() {
  if (currentTree !== null) return;   // 已经开着工作区（例如别处刚切过一个），不覆盖
  const handle = lastWorkspaceHandle;
  if (handle === null) return;        // 没记过工作区，照常走空状态
  let perm = "prompt";
  try {
    // 这里只查不申请：查询不需要用户手势，申请需要，所以拆成两步，启动这一步只做得了查询
    perm = await handle.queryPermission({ mode: "readwrite" });
  } catch (err) {
    console.log("[列表] 查询上次工作区的权限失败：", err);
    return;
  }
  if (perm === "granted") {
    if (await adoptWorkspaceFolder(handle)) {
      console.log("[列表] 已接着打开上次的工作区 " + handle.name + "（权限仍然有效）");
      return;
    }
    // 权限还在却读不出来，多半是这个文件夹已经被删掉或挪走了：清掉这条记忆，下次启动不再白试一次
    forgetWorkspaceHandle();
    return;
  }
  if (perm === "denied") return;   // 用户明确拒绝过：不再摆入口
  sidebarResumeHandle = handle;    // 还差一次点击才算数
  buildSidebarTree();
  console.log("[列表] 上次的工作区 " + handle.name + " 还差一次授权，已在竖栏里摆出「继续打开」");
}

// 点「继续打开」：这一下点击正是浏览器要的那个手势，在这一刻申请权限，允许了就把工作区铺出来
// 没允许（用户点了不允许、文件夹已被删掉或挪走）都只报一句，空状态里另选一个文件夹那条路照旧
async function resumeWorkspaceNow() {
  const handle = sidebarResumeHandle;
  if (handle === null) return;
  let perm = "prompt";
  try {
    perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") perm = await handle.requestPermission({ mode: "readwrite" });
  } catch (err) {
    console.log("[列表] 申请上次工作区的权限失败：", err);
    return;
  }
  if (perm !== "granted") {
    console.log("[列表] 没有取得 " + handle.name + " 的权限，仍可以在竖栏里另选一个文件夹");
    return;
  }
  if (await adoptWorkspaceFolder(handle)) return;
  // 权限拿到了却读不出来：这条记忆就此清掉，竖栏回到「另选一个文件夹」那一步
  forgetWorkspaceHandle();
  sidebarResumeHandle = null;
  buildSidebarTree();
}

// 点在列表上：空状态那个按钮与根目录名都是换文件夹，文件夹条目是开合这一层，文件条目只把高亮挪过去
// 点空白处则取消高亮，回到「没有打开任何一条」；除此之外不打开、不读取文件内容、不保存任何东西
async function onSidebarTreeClick(e) {
  // 「继续打开」也要判在「选择文件夹」之前，理由与下一条一样：它共用 sb-pick 那一套外观类，
  // 先判 sb-pick 会把它当成换文件夹，点下去弹出来的是系统文件夹选择框
  if (e.target.closest(".sb-resume") !== null) {
    resumeWorkspaceNow();
    return;
  }
  // 「打开文件」要判在「选择文件夹」之前：两个按钮共用 sb-pick 那一套外观类，
  // 先判 sb-pick 会把它也当成换文件夹，点下去弹出来的是文件夹选择框
  if (e.target.closest(".sb-open-file") !== null) {
    onOpenFile();   // 复用编辑器里那个「打开」：同一个系统文件框、同一套读入与校验，只是入口换到了这里
    return;
  }
  // 空状态那个「选择文件夹」按钮与根目录名是同一件事，先并到一起判
  if (e.target.closest(".sb-pick") !== null || e.target.closest(".sb-header") !== null) {
    onChangeFolder();
    return;
  }
  // 空白处：命中的是容器本身，说明这一下没落在任何一行上，把高亮撤掉
  // 没有高亮时不必重画，省掉一次整棵重建
  if (e.target === sidebarTreeDom) {
    if (currentTree === null) return;
    clearSidebarSelection(currentTree.children);
    buildSidebarTree();
    return;
  }
  const row = e.target.closest(".sb-row");   // 图标与文字都在行内，点在它们上面也算点在整行上
  if (row === null) return;
  const node = row.sidebarNode;
  if (node === undefined) return;
  if (node.isFolder === true) {
    if (node.open === true) { node.open = false; buildSidebarTree(); return; }   // 已展开的：收起，不必碰磁盘
    // 第一次展开才去读这一层，读到之前先不展开，免得展开出一片空白让人以为里面是空的
    if (node.loaded !== true && !(await loadSidebarFolder(node))) return;
    node.open = true;
    buildSidebarTree();
    return;
  }
  // 已经是当前这一条了就不必重画：双击的第二下正落在这种情形，省掉这次重画，
  // 行元素不会在两次点击之间被换掉，双击才能被浏览器稳稳算成一次双击
  if (node.sel === true) return;
  clearSidebarSelection(currentTree.children);
  node.sel = true;
  buildSidebarTree();
}

// 双击一条：把那个存档打开
// 只有后缀是存档后缀的文件才打开，文件夹与别的文件都只是没反应，前者靠单击开合，后者留一句日志说明原因
async function onSidebarTreeDblClick(e) {
  const row = e.target.closest(".sb-row");
  if (row === null) return;   // 落在空白处、根目录名或按钮上，都不是「打开一条存档」
  const node = row.sidebarNode;
  if (node === undefined || node.isFolder === true) return;
  if (node.handle === undefined) return;   // 没有磁盘句柄就没有可读的东西，正常流程下不会出现，防一手
  if (!node.name.toLowerCase().endsWith(SAVE_EXT)) {
    console.log("[列表] " + node.name + " 不是存档，双击不打开");
    return;
  }
  // 就是当前打开的这一条：不必重读，重读反而会把手上没保存的改动抹掉
  if (node === openFileNode) return;
  // 先把手上这份画面收进它所属的那一条里，再换文档：不收的话，这份没保存的改动一被顶掉就再也找不回来
  stashCurrentScene();
  // 这一条里存着一份没保存的改动（之前从它这里切走过）就把它摆回来，不去读磁盘
  // 磁盘上那份是上次保存时的旧内容，读了就等于把改动丢掉
  if (node.scene !== null) {
    if (adoptScene(node.handle, parseScene(node.scene))) {
      docDirty = true;   // 摆回来的这一份本来就没保存过：applyScene 会把标记清掉，这里要重新亮上
      docEditSeq++;      // 摆回来同样是一次内容更替，序号要往前走，免得保存时误判成「期间没改过」
      openFileNode = node;
      console.log("[列表] 已切回 " + node.name + "，摆回没保存的那一份改动");
    }
    return;
  }
  // 没有存下的改动，就按磁盘上的内容打开；成功后记住这一条，之后它被改动要在它前面亮圆点
  if (await openFromHandle(node.handle)) openFileNode = node;
}

/* ========== 悬停时的小窗 ========== */

// 一行上挂着的名字：名字由渲染那一步挂在行元素上，正常流程下取得到，取不到就给个空串
function sidebarRowName(row) {
  return row.sidebarNode === undefined ? "" : row.sidebarNode.name;
}

// 在指针旁边冒出小窗，写上这一条的全名
// 先写文本再量尺寸：名字长短差得远，写死一个宽高不是截断就是空出一大块
function showSidebarTip(name) {
  sidebarTipDom.textContent = name;   // 名称是数据，用 textContent 写入，不做任何转义或拼接
  sidebarTipDom.style.display = "block";
  const w = sidebarTipDom.offsetWidth;
  const h = sidebarTipDom.offsetHeight;
  // 贴着指针摆在右下方，只留几像素的缝：缝再小就压住指针正指着的那一行，再大又不像「紧贴」
  let left = sidebarTipMX + 6;
  let top = sidebarTipMY + 8;
  if (left + w > window.innerWidth - 8) left = sidebarTipMX - w - 6;   // 右边放不下就翻到指针左侧
  if (top + h > window.innerHeight - 8) top = sidebarTipMY - h - 8;    // 下边放不下就翻到指针上方
  if (left < 8) left = 8;   // 名字长到两边都放不下时，宁可压住指针也不让它出窗口
  if (top < 8) top = 8;
  sidebarTipDom.style.left = left + "px";
  sidebarTipDom.style.top = top + "px";
}

// 收起小窗：把还在等的定时器、当前挂着的那一行、画面一起清掉
// 三样必须一起清，只清画面的话，那个定时器到点还会把已离开的一行的小窗又冒出来
function hideSidebarTip() {
  if (sidebarTipTimer !== null) { clearTimeout(sidebarTipTimer); sidebarTipTimer = null; }
  sidebarTipRow = null;
  sidebarTipDom.style.display = "none";
}

// 指针挪进某一行：先停一下再冒出小窗，停够之前离开就不冒
// 记的是行元素本身而不是下标：每次重画行元素都是新的，下标会指到别的行上去
function onSidebarTreeOver(e) {
  const row = e.target.closest(".sb-row");
  // 就地输入那一行没有挂节点，也就没有名字可写：与小窗无关，一并当成「没落在行上」
  // 不判它的话，指针停够时间会冒出一个空的小窗
  if (row === null || row.sidebarNode === undefined) { hideSidebarTip(); return; }   // 移到标题或空白处，收起
  // 不管在哪一行，都记下指针最新落点：小窗冒出来时才贴得住指针，而不是停在刚进这一行时的位置
  sidebarTipMX = e.clientX;
  sidebarTipMY = e.clientY;
  if (row === sidebarTipRow) {
    // 还在同一行里挪动：不必重开延时的钟；已经冒出来了就跟着指针走，还没冒出来就等它自己到点
    if (sidebarTipDom.style.display === "block") showSidebarTip(sidebarRowName(row));
    return;
  }
  hideSidebarTip();   // 换了一行：旧的定时器与画面一并作废，重新开始计时
  sidebarTipRow = row;
  sidebarTipTimer = setTimeout(function () {
    sidebarTipTimer = null;
    if (sidebarTipRow !== row) return;   // 到点时指针已经不在这条上了，就不冒
    showSidebarTip(sidebarRowName(row));
  }, Math.round(CONFIG.sidebarTipDelay * 1000));
}

// 指针离开某一行：真的离开这一行才收起
// 不判「是不是还在这一行里」的话，指针从行的图标挪到它自己的文字上也会先收到一次离开，小窗会闪一下再回来
function onSidebarTreeOut(e) {
  const row = e.target.closest(".sb-row");
  if (row === null || row !== sidebarTipRow) return;
  const to = e.relatedTarget;   // 指针正要去的地方
  if (to !== null && row.contains(to)) return;
  hideSidebarTip();
}

/* ========== 右键菜单 ========== */

// 造一条菜单项：图标在左、名字在右，整条就是一个按钮
function makeSidebarMenuItem(kind, label, icon) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "sb-menu-item";
  item.dataset.kind = kind;   // 点中的是哪一条看这个字段，以后改文字不必跟着改判断
  item.appendChild(icon);
  const text = document.createElement("span");
  text.textContent = label;   // 名字是数据，用 textContent 写入，不经过 HTML 解析
  item.appendChild(text);
  return item;
}

// 初始化菜单：两条固定条目只建一次，之后每次右键只改位置与显示，不重建
// 各个监听器也在这里各绑一次，反复右键不会重复注册
function setupSidebarMenu() {
  sidebarMenuDom.appendChild(makeSidebarMenuItem("folder", "新建文件夹", makeNewEntryIconSvg(makeFolderShape())));
  // 「新建文件」这一条单独留个引用：指针压在它身上时要引出右边那一列文件类型
  sidebarFileItem = makeSidebarMenuItem("file", "新建文件", makeNewEntryIconSvg(makeInverterShape()));
  sidebarMenuDom.appendChild(sidebarFileItem);
  // 第三条「更改文件名」：压在文件行或文件夹行上时才露出来，压在别处整条都不在
  sidebarRenameItem = makeSidebarMenuItem("rename", "更改文件名", makeRenameIconSvg());
  sidebarRenameItem.classList.add("is-off");
  sidebarMenuDom.appendChild(sidebarRenameItem);
  // 最后一条「删除」先带着 is-off 藏起来：右键落在文件行上时才露出来，落在别处时它整条都不在
  sidebarDeleteItem = makeSidebarMenuItem("delete", "删除", makeTrashIconSvg());
  sidebarDeleteItem.classList.add("is-off");
  sidebarMenuDom.appendChild(sidebarDeleteItem);
  setupSidebarSubmenu();   // 「新建文件」右侧那一列文件类型：只建一次，悬停时只改位置与显示
  sidebarMenuDom.addEventListener("click", onSidebarMenuClick);
  // 悬停分级：压在「新建文件」上引出右侧那一列，压在别的条目上把它收掉；指针离开整个菜单也收
  sidebarMenuDom.addEventListener("mouseover", onSidebarMenuOver);
  sidebarMenuDom.addEventListener("mouseleave", laterHideSidebarSubmenu);
  // 点菜单以外的任何地方都收起：绑在捕获阶段，别处就算拦了冒泡也拦不住这一下
  document.addEventListener("mousedown", function (e) {
    if (!sidebarMenuOpen) return;
    if (e.target.closest !== undefined &&
        (e.target.closest("#sidebarMenu") !== null || e.target.closest("#sidebarSubmenu") !== null)) return;   // 点在两层菜单自己身上，那一下留给它们的 click
    closeSidebarMenu();
  }, true);
  // 下面几种情况一发生，菜单贴着指针的那个位置就不对了，一律收起，免得它孤零零停在半空中
  sidebarTreeDom.addEventListener("scroll", closeSidebarMenu);
  window.addEventListener("resize", closeSidebarMenu);
  window.addEventListener("blur", closeSidebarMenu);
  window.addEventListener("keydown", function (e) {
    if (e.code === "Escape") closeSidebarMenu();   // Esc 关浮层是通用习惯，弹窗那边也认它
  });
  sidebarTreeDom.addEventListener("contextmenu", onSidebarTreeContextMenu);
}

// 在列表上右键：先定下这一轮建在哪一层，再把菜单摆到指针旁边
// 还没有工作区时整个不动：没有落点，开了也做不成事，索性不接管这一下右键
function onSidebarTreeContextMenu(e) {
  if (currentTree === null) {
    console.log("[列表] 还没有工作区，先在竖栏里选一个文件夹");
    return;
  }
  e.preventDefault();   // 挡掉浏览器自己的右键菜单：右键在这里是工作区的事
  hideSidebarTip();     // 悬停小窗与右键菜单不该同时挂在一行上
  const targets = sidebarTargetsFrom(e.target);
  sidebarMenuTarget = targets.folder;   // 新建落到哪一层
  sidebarMenuNode = targets.node;       // 改名作用在它上面，删除也读它
  // 「更改文件名」压在条目行上就露出来，文件与文件夹都能改；「删除」只在文件行上露出来
  sidebarRenameItem.classList.toggle("is-off", targets.node === null);
  sidebarDeleteItem.classList.toggle("is-off", targets.file === null);
  sidebarMenuOpen = true;
  sidebarMenuDom.style.display = "block";
  placeSidebarMenu(e.clientX, e.clientY);
}

// 这一轮右键压着哪一行：返回 { folder, file, node } 三个字段
//   folder 非空表示指针压在文件夹行上，新建的条目就落进它里面
//   file   非空表示指针压在文件行上，菜单要因此多出「删除」这一条
//   node   指针压中的那个条目本身，文件与文件夹都算；改名作用在它上面
// 压着标题、空白处或别的元素时三个都是 null：那时新建落在工作区根目录，改名与删除都不出现
function sidebarTargetsFrom(target) {
  const row = target.closest(".sb-row");
  const raw = row === null ? undefined : row.sidebarNode;
  // 就地输入那一行（新建、改名）与标题行都没有挂节点：它们算「没压中条目」，不能当成一条来改
  const node = raw === undefined ? null : raw;
  return {
    folder: node !== null && node.isFolder === true ? node : null,
    file: node !== null && node.isFolder === false ? node : null,
    node: node
  };
}

// 把菜单摆在指针右下方；右边或下边放不下就翻到另一侧，最后再夹一次窗口边
// 先显示再量尺寸：菜单宽高由内容决定，量出来才摆得准
function placeSidebarMenu(mx, my) {
  const w = sidebarMenuDom.offsetWidth;
  const h = sidebarMenuDom.offsetHeight;
  let left = mx + 2;
  let top = my + 2;
  if (left + w > window.innerWidth - 8) left = mx - w - 2;   // 右边放不下就翻到指针左侧
  if (top + h > window.innerHeight - 8) top = my - h - 2;    // 下边放不下就翻到指针上方
  if (left < 8) left = 8;   // 两边都放不下时宁可压住指针，也不让它出窗口
  if (top < 8) top = 8;
  sidebarMenuDom.style.left = left + "px";
  sidebarMenuDom.style.top = top + "px";
}

// 收起菜单：只改显示与标记，目标文件夹留着不动，它由新建那一段接着用
// 子列表是菜单的下一级，菜单一收它不能还孤零零留在半空中，所以在这里一并收掉
function closeSidebarMenu() {
  hideSidebarSubmenu();
  if (!sidebarMenuOpen) return;
  sidebarMenuOpen = false;
  sidebarMenuDom.style.display = "none";
}

// 点了菜单里的某一条：先收起菜单，再按条目的类型分头去做
// 顺序不能反：新建会把列表整棵重画，菜单若还挂着，就悬在新行上面了
// 删除也读的是右键那一刻记下的落点，收起菜单不会把它清掉，所以先收再办事是安全的
// 子列表里那一条走的也是这里：它同样带着 kind 字段，点它与点「新建文件」是同一件事
function onSidebarMenuClick(e) {
  const item = e.target.closest(".sb-menu-item");
  if (item === null) return;
  const kind = item.dataset.kind;
  // 子列表里那几条各自带着后缀，菜单里那几条没有；没带就是「新建文件」本身，按默认那一种建
  const ext = item.dataset.ext === undefined ? "" : item.dataset.ext;
  closeSidebarMenu();
  if (kind === "delete") onSidebarMenuDelete();
  else if (kind === "rename") beginSidebarRename();
  else beginSidebarCreate(kind, ext);
}

/* ========== 菜单里引出的子列表 ========== */

// 「新建文件」上悬停时，在它右侧引出的一列小列表：里面写着能新建哪几种文件
// 右键菜单只问「新建什么」，是文件夹还是文件在这一级分；文件还分得清是哪种格式，
// 那一层细分就落在这一列里。有哪几种由 NEW_FILE_EXTS 说了算，加一种就往那张表里加一项
// 它是独立的固定层而不是菜单的子节点：菜单只有几个字的宽度，这一列要从它右边探出去，
// 挂在菜单里就得跟着菜单的内边距与圆角走，挪到外面来才能按「新建文件」那一条自己的位置摆得准

// 造子列表里的条目并摆上：只做一次，之后开关只改显示，不重建
function setupSidebarSubmenu() {
  // 一种后缀一条：文字就是后缀本身，图标与列表里那个后缀的文件同一个形状、同一档颜色，两处对得上
  for (let i = 0; i < NEW_FILE_EXTS.length; i++) {
    const ext = NEW_FILE_EXTS[i];
    const icon = makeFileIconSvg(ext);
    icon.setAttribute("class", "sb-icon file");   // 连颜色也对齐列表里那一档淡蓝，不只是形状相同
    const item = makeSidebarMenuItem("file", ext, icon);
    item.dataset.ext = ext;   // 记下这一条对应的是哪种后缀，点击时按它去建
    sidebarSubmenuDom.appendChild(item);
  }
  // 这几条与菜单里那几条共用同一个处理：它们都带着 kind 字段，点下来都是「开始新建」，
  // 只是各自还带着自己的后缀，不必为它们另写一份新建的调用
  sidebarSubmenuDom.addEventListener("click", onSidebarMenuClick);
  // 指针落进子列表就把「延时收起」撤掉：从条目挪过来要跨过中间的缝，那一下会先收到一次离开
  sidebarSubmenuDom.addEventListener("mouseenter", cancelSidebarSubmenuTimer);
  // 离开子列表也按延时收：往回挪到「新建文件」上时，那一条会把它重新叫出来，
  // 若这里当场收掉，子列表会先闪没再出现；延时收的话它一直都在，只是继续开着
  sidebarSubmenuDom.addEventListener("mouseleave", laterHideSidebarSubmenu);
}

// 指针压在菜单的某一条上：压的是「新建文件」就把子列表引出来，压在别的条目上就立刻收掉
// 用 mouseover 挂在菜单容器上，靠冒泡从每条条目上收到这一次；条目以后增多也不必逐条再绑一遍
function onSidebarMenuOver(e) {
  const item = e.target.closest(".sb-menu-item");
  if (item === sidebarFileItem) showSidebarSubmenu(item);
  else if (item !== null) hideSidebarSubmenu();
  // item 为 null 是指针落在菜单的内边距上，这时什么都不做：
  // 从条目挪进右侧子列表恰好要跨过这几像素，这里一收，子列表就先闪没了，指针接着的进入便落空
}

// 指针离开菜单：不当场收，隔一小会儿再收
// 从「新建文件」斜着挪进子列表时，中间会先收到一次「离开菜单」；当场收掉的话子列表会闪一下再回来
function laterHideSidebarSubmenu() {
  cancelSidebarSubmenuTimer();
  sidebarSubmenuTimer = setTimeout(function () {
    sidebarSubmenuTimer = null;
    hideSidebarSubmenu();
  }, Math.round(CONFIG.sidebarSubmenuDelay * 1000));
}

// 撤掉那个等着收起的钟：指针又落回子列表、或菜单已经收掉时，这一次延时就不该再生效
function cancelSidebarSubmenuTimer() {
  if (sidebarSubmenuTimer === null) return;
  clearTimeout(sidebarSubmenuTimer);
  sidebarSubmenuTimer = null;
}

// 把子列表摆到「新建文件」的右侧：上下与那一条对齐，右边放不下就翻到菜单左侧
// 先显示再量尺寸：宽高由内容决定，量出来才摆得准，与右键菜单那一处是同一套做法
function showSidebarSubmenu(item) {
  cancelSidebarSubmenuTimer();
  if (sidebarSubmenuOpen === true) return;   // 已经开着就不再量一遍：指针在条目里挪动时这里会被反复叫到
  const box = item.getBoundingClientRect();
  sidebarSubmenuDom.style.display = "block";
  const w = sidebarSubmenuDom.offsetWidth;
  const h = sidebarSubmenuDom.offsetHeight;
  let left = box.right + 2;   // 贴着这一条的右缘，中间留一条很窄的缝，看得出是从它引出来的
  let top = box.top;          // 与这一条上下对齐，视线从菜单跳到子列表时不用上下找
  // 右边放不下就翻到菜单左侧：若翻到条目的左侧，子列表会压在菜单自己身上，把菜单那几条盖住
  if (left + w > window.innerWidth - 8) left = sidebarMenuDom.getBoundingClientRect().left - w - 2;
  if (top + h > window.innerHeight - 8) top = window.innerHeight - 8 - h;   // 下边放不下就往上收，仍与条目大致齐平
  if (left < 8) left = 8;   // 两边都放不下时宁可压住菜单，也不让它探出窗口
  if (top < 8) top = 8;
  sidebarSubmenuDom.style.left = left + "px";
  sidebarSubmenuDom.style.top = top + "px";
  sidebarSubmenuOpen = true;
}

// 收起子列表：先撤掉等着收起的钟，再改显示
// 反复调用是常态（指针在菜单里挪来挪去、菜单整个收起时都会叫到），所以先判一次是否已经收起
function hideSidebarSubmenu() {
  cancelSidebarSubmenuTimer();
  if (sidebarSubmenuOpen !== true) return;
  sidebarSubmenuOpen = false;
  sidebarSubmenuDom.style.display = "none";
}

/* ========== 删除条目 ========== */

// 删掉右键点中的那个文件：先问一句，再动磁盘，最后把它从列表里摘掉
// 只做文件，不做文件夹：删文件夹要连里面的一起删，是一次不可逆的批量动作，不该放在顺手就能点到的地方
async function onSidebarMenuDelete() {
  const node = sidebarMenuNode;
  // 先取走再往下走：这一轮右键的结论只用一次，弹窗开着时又去右键了别的行，不该串到这一回上来
  sidebarMenuNode = null;
  // 菜单里这一条本来就只在文件行上露出来，这里再判一次类型：万一以后改了显示规则，也不会误删整个文件夹
  if (node === null || node.isFolder === true) return;
  // 删文件没有回收站，删完就找不回来，所以先问一句；右边那个键上也明写着「删除」而不是「丢弃」
  // 这一条里还留着没保存的改动时把话补全：删掉它等于连那份改动一起丢掉
  const extra = node.dirty === true || node.scene !== null ? "它还有没保存的改动。" : "";
  const ok = await askConfirm(extra + "删除后无法恢复，确定删除 " + node.name + " 吗？", "删除");
  if (!ok) return;
  try {
    await node.handle.remove();
  } catch (err) {
    console.log("[列表] 删除 " + node.name + " 失败：", err);
    // 磁盘上本来就没有了：多半是别处已经删过一次，列表还停在旧状态，往下走把它摘掉就对齐了
    if (err.name !== "NotFoundError") {
      // 这一句只是报信，两个键都只是把窗关掉；能说清原因的就说清，说不清的让用户去控制台看
      const why = err.name === "NotAllowedError" ? "没有写入权限，请重新选一次文件夹并在系统询问里点允许" : "写入出错，详细原因见控制台";
      await askConfirm("删除没有完成：" + why + "。", "知道了");
      return;
    }
  }
  // 删掉的可能正是编辑器里打开的那一个，那样必须先把绑定解掉
  // 先按列表记着的那一条判（同一个节点，最直接）；它为空时（当初从系统文件框打开的）再问一次磁盘上的句柄
  // 是不是同一个文件：同一个文件每次拿到的句柄是两个对象，拿它们比相等是比不出来的，要用 isSameEntry
  let wasOpen = openFileNode === node;
  if (!wasOpen && currentFileHandle !== null) {
    try { wasOpen = await currentFileHandle.isSameEntry(node.handle); } catch (err) { wasOpen = false; }
  }
  if (wasOpen) {
    // 文件已经不在磁盘上了，还绑着它的话，下一次保存会把它原样写回来
    // 画面上的电路不动，它自此是一份没有落处的改动：名字回到占位名，并按未保存算，
    // 之后换文件夹时仍会照常问一句要不要丢弃，不会不声不响地把它丢掉
    currentFileHandle = null;
    currentFileName = "";
    openFileNode = null;
    docDirty = true;
    docEditSeq++;   // 原来绑着的那份文件没了，画面按未保存算，序号也要往前走
    refreshFileName();
    console.log("[列表] 删掉的正是当前打开的那一个，已解除绑定，画面上的电路按未保存算");
  }
  const level = findSidebarLevel(node);
  if (level !== null) level.splice(level.indexOf(node), 1);   // 从它所在的那一层里摘掉，其余条目原地不动
  buildSidebarTree();
  console.log("[列表] 已删除 " + node.name);
}

// 在整棵树里找某个节点挂在哪一层，返回那一层的数组；找不到返回 null
// 右键给到的是节点本身，要摘掉它得先知道它属于哪一层；节点数量不大，从根递归找一遍最省事也最不容易错
function findSidebarLevel(node) {
  const stack = [currentTree];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === null || cur.children === undefined) continue;
    if (cur.children.indexOf(node) >= 0) return cur.children;
    for (let i = 0; i < cur.children.length; i++) stack.push(cur.children[i]);
  }
  return null;
}

/* ========== 更改文件名 ========== */

// 右键「更改文件名」或悬停某一行按回车：把目标那一行原位换成一个输入框，名字与后缀一起预填，只预选名字那一段
// 不另开弹窗：改名是一步就完成的小事，就地和新建文件用同一套输入行，手感一致
// 文件与文件夹走同一条路：文件夹没有后缀，输入框里就是整个名字
function beginSidebarRename() {
  const node = sidebarMenuNode;
  sidebarMenuNode = null;   // 这一轮右键的结论只用一次，先取走
  if (node === null) return;
  const isFolder = node.isFolder === true;
  if (sidebarCreateKind !== "") cancelSidebarCreate();   // 新建的输入行还挂着就先收掉，两行不能同时在场
  if (sidebarRenameNode !== null) cancelSidebarRename();
  const row = findSidebarRow(node);
  if (row === null) return;   // 这一行此刻没画出来（所在文件夹收起了），改名无从下手
  hideSidebarTip();   // 原来那一行马上要藏起来，贴着它的小窗不能还孤零零留在半空中
  sidebarRenameNode = node;
  sidebarRenameExt = isFolder ? "" : sidebarFileExt(node.name);   // 原后缀，改名时不许换；文件夹没有后缀
  const depth = row.querySelectorAll(".sb-guide").length;
  const inputRow = makeSidebarRenameRow(depth, node.name, isFolder);
  row.parentNode.insertBefore(inputRow.root, row);
  row.style.display = "none";   // 原来那一行先藏起来，改完由重画整棵列表接回来
  sidebarRenameRow = inputRow;
  sidebarRenameHiddenRow = row;
  // 这一份正在往磁盘上写：写盘与改名会去抢同一个文件，先把原因写在框右边，等它写完再按回车即可
  if (!isFolder && node.saving === true) setSidebarRenameHint("正在保存，稍后再改");
  inputRow.input.focus();
  // 隔一帧再要一次焦点：这一下是响应菜单按钮的点击，浏览器给按钮的默认焦点处理有可能排在后面
  requestAnimationFrame(function () {
    if (sidebarRenameRow !== inputRow) return;   // 这一轮已经收了
    inputRow.input.focus();
    inputRow.input.setSelectionRange(0, inputRow.baseLen);   // 只选名字那一段，直接打字就盖住名字、后缀还留着
  });
}

// 造就地输入的那一行：缩进、图标照普通行来，名字那一段换成输入框
// 外观整套复用新建行（.sb-new-row / .sb-new-input），两种就地输入在列表里长得一样
// isFolder 决定图标画文件夹还是按后缀画文件，也决定预选到哪儿为止
function makeSidebarRenameRow(depth, name, isFolder) {
  const root = document.createElement("div");
  root.className = "sb-row sb-new-row";
  for (let d = 0; d < depth; d++) {
    const guide = document.createElement("span");
    guide.className = "sb-guide";
    root.appendChild(guide);
  }
  const blank = document.createElement("span");   // 与普通行一样空出箭头的位置，图标才不会错位
  blank.className = "sb-chev is-blank";
  root.appendChild(blank);
  const icon = isFolder ? makeFolderIconSvg() : makeFileIconSvg(sidebarRenameExt);   // 图标照旧是这一条本来的样子
  icon.setAttribute("class", isFolder ? "sb-icon folder" : "sb-icon file");
  root.appendChild(icon);
  const input = document.createElement("input");
  input.className = "sb-new-input";
  input.type = "text";
  input.spellcheck = false;
  input.value = name;
  root.appendChild(input);
  const hint = document.createElement("span");
  hint.className = "sb-new-hint";
  root.appendChild(hint);
  input.addEventListener("input", function () { setSidebarRenameHint(""); });
  input.addEventListener("keydown", function (e) {
    // 输入法正在组字时让开：这时候的回车是在选候选词、Esc 是在撤掉这次组字
    if (e.isComposing || e.keyCode === 229) return;
    if (e.code === "Enter") { e.preventDefault(); commitSidebarRename(input.value); }
    else if (e.code === "Escape") { e.preventDefault(); cancelSidebarRename(); }
  });
  // 失去焦点不立刻放弃，隔一帧再看：焦点被别的东西临时顶掉时它自己会回来
  input.addEventListener("blur", function () {
    const row = sidebarRenameRow;
    if (row === null || row.input !== input) return;
    requestAnimationFrame(function () {
      if (sidebarRenameRow !== row) return;
      if (document.activeElement === input) return;
      cancelSidebarRename();
    });
  });
  // 预选长度：文件夹整个名字都选中；文件只选到后缀之前，后缀仍留在框里不许被顺手打掉
  const baseLen = isFolder ? name.length : Math.max(0, name.length - sidebarRenameExt.length);
  return { root: root, input: input, hint: hint, baseLen: baseLen };
}

// 在输入行右边写一句最短的原因；传空串就是擦掉
function setSidebarRenameHint(text) {
  if (sidebarRenameRow === null) return;
  sidebarRenameRow.hint.textContent = text;
  sidebarRenameRow.root.classList.toggle("is-error", text !== "");
}

// 放弃改名：把输入行摘掉，把原来那一行放回来，磁盘一概不动
function cancelSidebarRename() {
  if (sidebarRenameNode === null) return;
  const row = sidebarRenameRow;
  const hidden = sidebarRenameHiddenRow;
  // 先清状态再动节点：摘掉带焦点的输入框会触发 blur 绕回这里，状态清空了它就是空转
  sidebarRenameRow = null;
  sidebarRenameHiddenRow = null;
  sidebarRenameNode = null;
  sidebarRenameExt = "";
  if (row !== null && row.root.parentNode !== null) row.root.parentNode.removeChild(row.root);
  if (hidden !== null) hidden.style.display = "";
}

// 在整棵树里找某个文件所在的上一级：根目录下的条目返回 null，找不到返回 undefined
// 改名要在它所在那一层里建新名字、删旧名字，所以必须拿到那一层的目录句柄
function findSidebarParent(node) {
  if (currentTree === null) return undefined;
  const stack = [{ parent: null, children: currentTree.children }];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur.children === undefined) continue;
    for (let i = 0; i < cur.children.length; i++) {
      const child = cur.children[i];
      if (child === node) return cur.parent;
      if (child.isFolder === true) stack.push({ parent: child, children: child.children });
    }
  }
  return undefined;
}

// 名字敲定：先全部校验通过再动磁盘，哪一步没过都原地留着输入行，改一个字就能重来
async function commitSidebarRename(rawName) {
  const node = sidebarRenameNode;
  if (node === null) return;
  const isFolder = node.isFolder === true;
  const ext = sidebarRenameExt;
  const oldName = node.name;
  // 这一份正在写盘：改名要先建新名字、再删旧名字，两边同时动同一个文件会互相抢，等它写完再来
  if (!isFolder && node.saving === true) { setSidebarRenameHint("正在保存，稍后再改"); return; }
  let name = rawName.trim();
  if (name === "") { setSidebarRenameHint("名字不能为空"); return; }
  // 斜杠在两套系统上都是路径分隔符，写进去会被接口直接拒绝
  if (name.indexOf("/") >= 0 || name.indexOf("\\") >= 0) {
    setSidebarRenameHint("名字里不能有斜杠");
    return;
  }
  // 后缀那一套只对文件生效：文件夹没有后缀，改文件夹名时不去动名字里那些点
  if (!isFolder) {
    // 后缀不许换：.lccas 与 .txt 在这个程序里是两种东西，换掉等于把文件变成了另一种类型
    let typedKnown = "";
    for (let i = 0; i < NEW_FILE_EXTS.length; i++) {
      if (name.toLowerCase().endsWith(NEW_FILE_EXTS[i])) { typedKnown = NEW_FILE_EXTS[i]; break; }
    }
    if (typedKnown !== "" && typedKnown !== ext) {
      setSidebarRenameHint("后缀不能改，仍是 " + ext);
      return;
    }
    if (!name.toLowerCase().endsWith(ext)) name += ext;   // 只写了名字：把原后缀补回去
  }
  // 只有大小写不同时，磁盘上那一个就是它自己：查重名查出来的必然是它本人，所以这一档跳过查重
  const caseOnly = name.toLowerCase() === oldName.toLowerCase();
  if (name === oldName) { cancelSidebarRename(); return; }   // 没改，等于什么都没发生
  const parent = findSidebarParent(node);
  if (parent === undefined) { setSidebarRenameHint("这一行已经不在列表里"); return; }
  const dirHandle = parent === null ? currentTree.handle : parent.handle;   // 根目录的句柄挂在整棵树上
  // 是不是编辑器里正打开的那一份，要在动磁盘之前问清楚：删掉旧的之后，旧句柄就问不出来了
  // 文件夹不会被编辑器打开，跳过这一问，也省掉一次句柄比较
  let wasOpen = false;
  if (!isFolder) {
    wasOpen = openFileNode === node;
    if (!wasOpen && currentFileHandle !== null) {
      try { wasOpen = await currentFileHandle.isSameEntry(node.handle); } catch (err) { wasOpen = false; }
    }
  }
  try {
    if (!caseOnly && await sidebarEntryExists(dirHandle, name)) {
      setSidebarRenameHint("已经有同名的了");
      return;
    }
    // 先试浏览器自带的改名：一步到位，不必把内容复制一遍
    let newHandle = null;
    try {
      if (typeof node.handle.move === "function") {
        await node.handle.move(name);
        newHandle = node.handle;
      }
    } catch (err) { newHandle = null; }   // 没有这个接口或这次没成：下面走复制那条路
    if (newHandle === null) {
      // 只改大小写时绝不能走「建新一份再删旧的」：在不区分大小写的磁盘上，新名字取到的正是原来那个文件，
      // 删旧的会把刚写好的内容一起删掉，所以这一档只认浏览器自带的改名
      if (caseOnly) { setSidebarRenameHint("这个浏览器不支持只改大小写"); return; }
      // 文件夹下面还挂着下级，把整棵复制一遍是另一件事，不做，同样只认浏览器自带的改名
      if (isFolder) { setSidebarRenameHint("改文件夹名没有成功"); return; }
      // 改名 = 读出旧内容、用新名字建一份、删掉旧的
      // 顺序刻意如此：新文件写成功之后才删旧的，中途失败时旧文件还在，不会两头落空
      const text = await (await node.handle.getFile()).text();
      newHandle = await dirHandle.getFileHandle(name, { create: true });
      const stream = await newHandle.createWritable();
      await stream.write(text);
      await stream.close();
      await node.handle.remove();
    }
    node.name = name;
    node.handle = newHandle;
    // 正打开着的那一份跟着换绑：不改的话，下一次保存会按旧名字把它重新写出一份来
    if (wasOpen) {
      currentFileHandle = newHandle;
      currentFileName = name;
      openFileNode = node;
      refreshFileName();
    }
    cancelSidebarRename();
    buildSidebarTree();   // 列表按名字排序，改名之后位置可能变，整棵重画一次最省心
    console.log("[列表] 已改名 " + oldName + " → " + name);
  } catch (err) {
    console.log("[列表] 改名失败：", err);
    if (err.name === "NotAllowedError") setSidebarRenameHint("没有写入权限");
    else setSidebarRenameHint("改名失败");
  }
}

/* ========== 悬停时按回车改名 ========== */

// 指针此刻停在哪一条上：借悬停小窗记着的那一行，再确认它还在列表里
// 整棵重画会把旧的行元素换成新的一批，记着的那一行已经不在文档里，那时不能再算数
function sidebarHoveredNode() {
  const row = sidebarTipRow;
  if (row === null || row.isConnected !== true) return null;
  return row.sidebarNode === undefined ? null : row.sidebarNode;
}

// 悬停某一行时按回车：与右键菜单里那条「更改文件名」等价，省掉一次右键
// 只认回车，别的键留给画布那一套快捷键；焦点在输入框里、模态弹窗或右键菜单开着时都不抢
function onSidebarKeyDown(e) {
  if (e.code !== "Enter" && e.code !== "NumpadEnter") return;
  if (e.isComposing || e.keyCode === 229) return;   // 输入法正在组字：这一下回车是在选候选词
  if (confirmOpen || tutorialOpen || sidebarMenuOpen) return;
  if (isTextEntry(e.target)) return;   // 就地输入的那一行自己认回车，不能两头都处理
  if (sidebarRenameNode !== null || sidebarCreateKind !== "") return;   // 已经有一行输入在场了
  const node = sidebarHoveredNode();
  if (node === null) return;   // 指针不在条目行上：回车在这里没有别的事可做
  e.preventDefault();
  sidebarMenuNode = node;   // 改名那一段读的就是这个变量，这里先把它摆成指针停着的那一条
  beginSidebarRename();
}

/* ========== 新建条目 ========== */

// 开始新建：先在目标那一层就地摆出一行输入框，名字敲定了才动磁盘
// 不做成弹窗问名字：一行输入贴着它将要落进去的那一层，看得见自己在哪儿建，视线也不必挪开
// ext 是子列表里选的那一种后缀；从菜单里那条「新建文件」直接进来时是空串，按默认那一种（存档）建
async function beginSidebarCreate(kind, ext) {
  if (sidebarCreateKind !== "") cancelSidebarCreate();   // 上一轮还没收尾就先收掉，免得多出一行
  const parent = sidebarMenuTarget;   // null 表示工作区根目录
  // 建在文件夹里时先把那个文件夹展开：收起时它的下级根本不进 DOM，输入行会挂到别处去
  if (parent !== null) {
    if (parent.loaded !== true && !(await loadSidebarFolder(parent))) return;   // 读不出来就作罢，原因已由上面那句打出
    parent.open = true;
  }
  sidebarCreateParent = parent;
  sidebarCreateKind = kind;
  // 后缀只在建文件时用得上；没有指定就给表里第一项，也就是电路存档，与从前的行为一致
  sidebarCreateExt = kind === "file" ? (ext === "" ? NEW_FILE_EXTS[0] : ext) : "";
  buildSidebarTree();   // 重画的末尾会把输入行摆上
  const row = sidebarNewRow;
  if (row === null) return;
  row.input.focus();
  // 隔一帧再要一次焦点：这一下是响应菜单按钮的点击，浏览器给按钮的那点默认焦点处理有可能
  // 排在我们后面，把焦点顶回去；隔一帧再要，拿到手的才是稳的（当帧那一次是为了立刻就有光标）
  requestAnimationFrame(function () {
    if (sidebarNewRow !== row) return;   // 这一轮已经收了（被取消，或又开了新一轮），别去动它
    row.input.focus();
    row.input.setSelectionRange(0, row.baseLen);   // 预选到后缀之前，直接打字就盖住名字
  });
}

// 把输入行插到目标那一层的最前面
// 锚点是目标文件夹自己那一行（根目录是那个标题行），插在它之后正好是它下级的第一位
function placeSidebarNewRow() {
  sidebarNewRow = null;
  if (sidebarCreateKind === "") return;   // 没有在新建
  let anchor = sidebarTreeDom.querySelector(".sb-header");   // 根目录：标题行之后就是第一级
  let depth = 0;
  if (sidebarCreateParent !== null) {
    anchor = findSidebarRow(sidebarCreateParent);
    if (anchor === null) return;   // 那一层此刻没画出来（比如正收起），等下次重画时再补
    depth = anchor.querySelectorAll(".sb-guide").length + 1;   // 下级比它自己多缩进一级
  }
  if (anchor === null) return;
  sidebarNewRow = makeSidebarNewRow(depth);
  anchor.parentNode.insertBefore(sidebarNewRow.root, anchor.nextSibling);
}

// 造那一行：缩进与图标照列表的样子来，名字那一段换成一个就地输入框
// 文件的名字连后缀一起预填，但只选到后缀之前，直接打字就盖住名字、后缀还留着
function makeSidebarNewRow(depth) {
  const isFolder = sidebarCreateKind === "folder";
  const root = document.createElement("div");
  root.className = "sb-row sb-new-row";
  for (let d = 0; d < depth; d++) {
    const guide = document.createElement("span");
    guide.className = "sb-guide";
    root.appendChild(guide);
  }
  const blank = document.createElement("span");   // 与普通行一样空出箭头的位置，图标才不会错位
  blank.className = "sb-chev is-blank";
  root.appendChild(blank);
  // 图标与将要建出来的文件同一种：正在建 .md 就画带 # 的那一页，所见即所得
  const icon = isFolder ? makeFolderIconSvg() : makeFileIconSvg(sidebarCreateExt);
  icon.setAttribute("class", isFolder ? "sb-icon folder" : "sb-icon file");
  root.appendChild(icon);
  const input = document.createElement("input");
  input.className = "sb-new-input";
  input.type = "text";
  input.spellcheck = false;
  const base = isFolder ? "新建文件夹" : "未命名";
  input.value = isFolder ? base : base + sidebarCreateExt;   // 后缀就用这一轮选定的那一种
  root.appendChild(input);
  const hint = document.createElement("span");   // 出错时在这里写一句最短的原因，平时是空的
  hint.className = "sb-new-hint";
  root.appendChild(hint);
  // 一动键盘就把上一句出错提示擦掉：那是上一次敲回车的结论，名字改了就已经不作数了
  input.addEventListener("input", function () { setSidebarNewHint(""); });
  // 回车定名、Esc 放弃、点到别处也算放弃：后两种都不留半截条目
  input.addEventListener("keydown", function (e) {
    // 输入法正在组字时让开：这时候的回车是在选候选词、Esc 是在撤掉这次组字，都不是在回应这一行
    // isComposing 为真即组字中；keyCode 229 是同一件事的另一种报法，老实现只给后者
    if (e.isComposing || e.keyCode === 229) return;
    if (e.code === "Enter") { e.preventDefault(); commitSidebarCreate(input.value); }
    else if (e.code === "Escape") { e.preventDefault(); cancelSidebarCreate(); }
  });
  // 失去焦点不立刻放弃，隔一帧再看：焦点被别的东西临时顶掉时它自己会回来，那时不该把这一行收掉
  // 真按了 Esc、或点到别处时，焦点不会再回到框里，那一刻才算放弃
  input.addEventListener("blur", function () {
    const row = sidebarNewRow;
    if (row === null || row.input !== input) return;
    requestAnimationFrame(function () {
      if (sidebarNewRow !== row) return;              // 这一轮已经结束了
      if (document.activeElement === input) return;   // 焦点又回来了，不算放弃
      cancelSidebarCreate();
    });
  });
  return { root: root, input: input, hint: hint, baseLen: base.length };
}

// 放弃这次新建：把输入行摘掉，其余一概不动
// 磁盘上的东西不在这里回退，因为这一行还在的时候，磁盘上什么都还没建
function cancelSidebarCreate() {
  if (sidebarCreateKind === "") return;
  const row = sidebarNewRow;
  // 先把状态清干净再去摘节点：摘掉一个带着焦点的输入框会触发 blur 绕回这里，状态清空了它就是空转
  sidebarNewRow = null;
  sidebarCreateKind = "";
  sidebarCreateExt = "";
  sidebarCreateParent = null;
  if (row !== null && row.root.parentNode !== null) row.root.parentNode.removeChild(row.root);
}

// 在输入行右边写一句最短的原因；传空串就是擦掉
// 出错时刻意不把这一行收掉：名字或落点改一下就能重来，整行消失反而让人以为是自己点错了
function setSidebarNewHint(text) {
  if (sidebarNewRow === null) return;
  sidebarNewRow.hint.textContent = text;   // 提示是数据，用 textContent 写入，不经过 HTML 解析
  sidebarNewRow.root.classList.toggle("is-error", text !== "");   // 出错时输入框的描边也跟着换成提示色
}

// 名字敲定：校验、查重、真正建到磁盘上、把新条目接进列表
// 顺序是「先全部通过再动手」，哪一步没过都原地留着输入行，改个名字就能接着来
async function commitSidebarCreate(rawName) {
  if (sidebarCreateKind === "") return;
  const kind = sidebarCreateKind;
  const ext = sidebarCreateExt;
  const parent = sidebarCreateParent;
  const label = kind === "folder" ? "文件夹" : "文件";   // 日志与提示里都用它，两种类型只差这一处
  let name = rawName.trim();
  // 下面这几种不合法都不收掉这一行，只把原因写在它旁边：改一个字就能重来，比整行凭空消失好懂
  if (name === "") { setSidebarNewHint("名字不能为空"); return; }
  // 斜杠在两套系统上都是路径分隔符，写进去会被接口直接拒绝，先拦下来把话说清楚
  if (name.indexOf("/") >= 0 || name.indexOf("\\") >= 0) {
    console.log("[列表] 名字里不能有斜杠：" + name);
    setSidebarNewHint("名字里不能有斜杠");
    return;
  }
  // 文件一律带上这一轮选定的后缀：没写或写成别的都补上，后缀是日后认它属于哪一类的依据
  if (kind === "file" && !name.toLowerCase().endsWith(ext)) name += ext;
  const dirHandle = parent === null ? currentTree.handle : parent.handle;   // 根目录的句柄挂在整棵树上
  try {
    if (await sidebarEntryExists(dirHandle, name)) {
      console.log("[列表] " + name + " 已经存在，换个名字");
      setSidebarNewHint("已经有同名的了");
      return;
    }
    let node;
    if (kind === "folder") {
      // 刚建出来的文件夹必定是空的，所以直接标成已读过，展开时不必再去读一次磁盘
      node = { name: name, isFolder: true, open: false, loaded: true, children: [], handle: await dirHandle.getDirectoryHandle(name, { create: true }) };
    } else {
      const fileHandle = await dirHandle.getFileHandle(name, { create: true });
      // 只有电路存档要先写一份空存档进去：不写就是一个零字节文件，双击打开只会得到一句「不是本程序的存档」
      // 纯文本留成真正的空文件：一个字节都不写，别的程序打开就是一份干净的空文件
      if (ext === SAVE_EXT) await writeEmptyScene(fileHandle);
      node = { name: name, isFolder: false, handle: fileHandle, dirty: false, saving: false, scene: null };
    }
    cancelSidebarCreate();   // 已经建成了，先收掉输入行再刷新列表
    const owner = parent === null ? currentTree : parent;   // 根目录与文件夹都有 children 这一层，写法合成一处
    owner.children = sortSidebarLevel(owner.children.concat([node]));
    buildSidebarTree();
    const row = findSidebarRow(node);
    if (row !== null) row.scrollIntoView({ block: "nearest" });   // 列表很长时把新条目带进视野，免得建完了看不见
    console.log("[列表] 已新建" + label + " " + name);
  } catch (err) {
    console.log("[列表] 新建" + label + "失败：", err);
    // 权限这一档单独说清楚：最常见的成因是当时选文件夹没有允许写入，用户得重新选一次
    // 其余失败（磁盘满、名字太长、文件夹刚被删掉）不再细分，控制台里有原始错误可查
    if (err.name === "NotAllowedError") setSidebarNewHint("没有写入权限");
    else setSidebarNewHint("新建失败");
  }
}

// 这个名字是不是已经被占了：文件与文件夹各问一次，两次都落空才算空着
// 不查就建的话，同名的那个会被接口当成「已经存在」直接返回，接着我们那一笔写入就把它的内容盖掉了
async function sidebarEntryExists(dirHandle, name) {
  try { await dirHandle.getFileHandle(name); return true; } catch (err) { /* 没有同名文件，接着问文件夹 */ }
  try { await dirHandle.getDirectoryHandle(name); return true; } catch (err) { /* 也没有同名文件夹 */ }
  return false;
}

// 往一个刚建出来的文件里写一份空存档
// 不写就留下一个零字节文件，双击打开只会得到一句「不是本程序的存档」
async function writeEmptyScene(handle) {
  const stream = await handle.createWritable();
  await stream.write(emptySceneText());
  await stream.close();
}

// 初始化列表：监听器只在这里绑一次，挂在容器上由事件冒泡接管每一行，所以反复重画也不会重复注册
function setupSidebarTree() {
  sidebarTreeDom.addEventListener("click", onSidebarTreeClick);
  sidebarTreeDom.addEventListener("dblclick", onSidebarTreeDblClick);
  sidebarTreeDom.addEventListener("mouseover", onSidebarTreeOver);
  sidebarTreeDom.addEventListener("mouseout", onSidebarTreeOut);
  // 按下「选择文件夹」时不让按钮拿焦点：键盘是绑在 window 上的，焦点在哪都不影响快捷键，
  // 这里只是不想让按钮在被点过之后一直留着一个焦点框（与弹窗里那几个按钮同一套做法）
  sidebarTreeDom.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains("sb-pick")) e.preventDefault();
  });
  window.addEventListener("keydown", onSidebarKeyDown);   // 悬停某一行时按回车即改名，只在这里绑一次
  setupSidebarMenu();   // 列表自己的右键菜单：两条固定条目建一次，右键时只改位置
  buildSidebarTree();
}
