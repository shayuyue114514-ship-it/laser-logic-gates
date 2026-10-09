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
let currentTree = null;

/* ========== 造小图标 ========== */

// 统一的 16×16 图标底座：尺寸、视图框、无障碍属性都在这里定死，下面几个图形只往里填路径
function makeSidebarSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
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

// 文件夹图标：实心的一块带一个开口，颜色由样式表按 currentColor 给
function makeFolderIconSvg() {
  const svg = makeSidebarSvg();
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M2.2 4.2 H6.4 L7.6 5.8 H13.8 V12.2 H2.2 Z");
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}

// 文件图标：只描边的一页纸、右上角折一角，与上方面板里那个文件图标是同一个样子
// 用描边而不是实心，是为了让文件和文件夹在缩略图上也能一眼分开
function makeFileIconSvg() {
  const svg = makeSidebarSvg();
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M4.6 2.2 H9.4 L11.8 4.6 V13.8 H4.6 Z M9.4 2.2 V4.6 H11.8");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.3");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

/* ========== 读磁盘 ========== */

// 同一层里的排序：文件夹在前，同类之间按名字排
// 磁盘返回的顺序是随机的，照原样铺出来每次都不一样，看着乱
function bySidebarName(a, b) {
  return a.name.localeCompare(b.name, "zh");
}

// 读一个文件夹下的条目，返回可以直接铺进列表的一层节点
// 只取每个条目的名字与类型，不去读文件内容；子文件夹要等展开时才读
// 否则选中一个深目录的那一刻，整棵子树就被全部读了进来，而其中大部分根本不会被展开
async function readDirectoryEntries(dirHandle) {
  const folders = [];
  const files = [];
  for await (const entry of dirHandle.values()) {   // 目录句柄本身是可异步遍历的，一次给一个条目
    if (entry.kind === "directory") {
      // 刚读到的文件夹只占个位：下级留空并标记未读，展开时再补
      folders.push({ name: entry.name, isFolder: true, open: false, loaded: false, children: [], handle: entry });
    } else {
      files.push({ name: entry.name, isFolder: false, handle: entry, dirty: false, scene: null });
    }
  }
  folders.sort(bySidebarName);
  files.sort(bySidebarName);
  return folders.concat(files);   // 文件夹在前、文件在后，两类各自已经排好
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
    // 空状态照资源管理器那种排法自上而下摆：一行标题、一句说明、一个整条宽的按钮
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
    hint.textContent = "尚未选择工作区文件夹。";
    sidebarTreeDom.appendChild(hint);
    const pick = document.createElement("button");
    pick.className = "sb-pick";
    pick.type = "button";
    pick.textContent = "选择文件夹";
    sidebarTreeDom.appendChild(pick);
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

    const icon = isFolder ? makeFolderIconSvg() : makeFileIconSvg();
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
  let children;
  try {
    children = await readDirectoryEntries(handle);   // 只读这一层，子文件夹留着展开时再读
  } catch (err) {
    console.log("[列表] 读取文件夹失败：", err);
    return;
  }
  // 读成了才换：读失败时列表仍是原来那棵，不会变成一个空壳
  currentTree = { name: handle.name, children: children };
  buildSidebarTree();
  console.log("[列表] 已载入文件夹 " + handle.name + "，共 " + children.length + " 条，权限：" + perm);
}

// 点在列表上：空状态那个按钮与根目录名都是换文件夹，文件夹条目是开合这一层，文件条目只把高亮挪过去
// 点空白处则取消高亮，回到「没有打开任何一条」；除此之外不打开、不读取文件内容、不保存任何东西
async function onSidebarTreeClick(e) {
  // 空状态按钮与根目录名是同一件事，先并到一起判
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
  if (row === null) { hideSidebarTip(); return; }   // 移到标题或空白处，收起
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
  buildSidebarTree();
}
