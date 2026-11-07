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
    node.children = await readDirectoryEntries(node.handle, node.path);
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
  S.sidebarTreeDom.textContent = "";   // 清空走 textContent：不经过 HTML 解析，名称里带什么字符都不会被当成标签
  if (currentTree === null) {
    // 内部工作区打不开时只留一条说明：OPFS 不可用就没有任何落盘能力，摆按钮也做不成事
    S.sidebarTreeDom.className = "is-empty";
    const title = document.createElement("div");
    title.className = "sb-empty-title";
    const titleIcon = makeFolderIconSvg();
    titleIcon.setAttribute("class", "sb-icon folder");
    title.appendChild(titleIcon);
    const titleText = document.createElement("span");
    titleText.className = "sb-label";
    titleText.textContent = "工作区还没准备好";
    title.appendChild(titleText);
    S.sidebarTreeDom.appendChild(title);
    const hint = document.createElement("div");
    hint.className = "sb-empty-hint";
    hint.textContent = "这个浏览器没有提供内部工作区，暂时无法保存文件。";
    S.sidebarTreeDom.appendChild(hint);
    return;
  }
  S.sidebarTreeDom.className = "";   // 有工作区了就把空状态的居中布局摘掉，恢复成一行一行的列表
  const header = document.createElement("div");
  header.className = "sb-header";
  const headerIcon = makeFolderIconSvg();   // 根目录名前面也放一个文件夹图标：它就是这一树的顶层容器
  headerIcon.setAttribute("class", "sb-icon folder");
  header.appendChild(headerIcon);
  const headerName = document.createElement("span");
  headerName.className = "sb-label";
  headerName.textContent = currentTree.name;   // 名称是数据，用 textContent 写入，不做任何转义或拼接
  header.appendChild(headerName);
  S.sidebarTreeDom.appendChild(header);
  renderSidebarNodes(currentTree.children, 0);
  // 正在新建时把输入行补回去：整棵重画会把那一行连同 DOM 一起清掉，重画后要重新摆上
  if (S.sidebarCreateKind !== "") placeSidebarNewRow();
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
    S.sidebarTreeDom.appendChild(row);

    // 展开的文件夹才往下画：收起时它的下级根本不进 DOM，行数与滚动高度自然跟着变
    if (isFolder && node.open === true) renderSidebarNodes(node.children, depth + 1);
  }
}

/* ========== 交互 ========== */

/* ========== 未保存的标记 ========== */

// 找出某个节点此刻对应的行元素：每次重画行元素都是新的一批，所以不能把行元素存在节点上，只能现找
function findSidebarRow(node) {
  const rows = S.sidebarTreeDom.querySelectorAll(".sb-row");
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
  if (S.openFileNode === null) return;             // 当前文件不是从列表打开的，没有哪一行可标
  // 圆点只表示「这份内容还没保存」：保存进工作区就算存好了，与有没有写回外部文件夹无关
  // 以前把「待写回文件夹」也算进来，导致按下保存后圆点又亮回去，看起来像没存上
  const want = S.docDirty === true;
  // 直接以行元素此刻的类名为准来对齐，而不是先看节点上的缓存字段：
  // 只要缓存字段和 DOM 有一次对不上，旧写法就会以为「没变化」而一直不再刷新，圆点便再也灭不掉
  const row = findSidebarRow(S.openFileNode);
  const dot = row === null ? null : row.querySelector(".sb-dot");
  if (dot !== null && dot.classList.contains("is-on") === want) {
    S.openFileNode.dirty = want;   // 显示已经对了，只把字段补正，不动 DOM
    return;
  }
  S.openFileNode.dirty = want;
  paintSidebarDot(S.openFileNode);
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

// 把一个目录接成工作区：读出第一层铺进列表，并把每个节点补上相对路径
// 内部工作区（OPFS）与同步后的重读都走它，规则只有一份；读不出来返回 false 且不动列表
async function adoptWorkspaceFolder(handle) {
  let children;
  try {
    children = await readDirectoryEntries(handle, "");   // 只读这一层，子文件夹留着展开时再读
  } catch (err) {
    console.log("[列表] 读取工作区失败：", err);
    return false;
  }
  // 句柄一并留在树上：往这一层里新建条目时要靠它，丢了就只能在子文件夹里新建，根目录下建不了
  currentTree = { name: "工作区", handle: handle, children: children, path: "" };
  S.sidebarResumeHandle = null;
  refreshTreePaths();
  buildSidebarTree();
  console.log("[列表] 已打开内部工作区，共 " + children.length + " 条");
  return true;
}

// 启动时直接打开内部工作区：OPFS 不需要任何授权，所以不再有「继续打开」那一步，也不必请求文件夹权限
async function resumeWorkspace() {
  if (currentTree !== null) return;   // 已经开着工作区，不覆盖
  const handle = await getWorkspaceRoot();
  if (handle === null) { buildSidebarTree(); return; }   // 浏览器不支持 OPFS：列表里摆一条说明
  if (!(await adoptWorkspaceFolder(handle))) return;
  // 打开后把当前文件按路径重新绑上，之后保存才找得到对应的行
  const node = findNodeByPath(openFilePath);
  if (node !== null && node.isFolder !== true) S.openFileNode = node;
}

// 点在列表上：文件夹条目是开合这一层，文件条目只把高亮挪过去
// 点空白处则取消高亮，回到「没有打开任何一条」；除此之外不打开、不读取文件内容、不保存任何东西
async function onSidebarTreeClick(e) {
  // 空白处：命中的是容器本身，说明这一下没落在任何一行上，把高亮撤掉
  // 没有高亮时不必重画，省掉一次整棵重建
  if (e.target === S.sidebarTreeDom) {
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

// 双击一条：存档交给画布打开，文本文件交给文本编辑器打开
// 文件夹靠单击开合，别的后缀留一句日志说明原因，不做任何事
async function onSidebarTreeDblClick(e) {
  const row = e.target.closest(".sb-row");
  if (row === null) return;   // 落在空白处、根目录名或按钮上，都不是「打开一条存档」
  const node = row.sidebarNode;
  if (node === undefined || node.isFolder === true) return;
  if (node.handle === undefined) return;   // 没有磁盘句柄就没有可读的东西，正常流程下不会出现，防一手
  const lower = node.name.toLowerCase();
  // 文本与 Markdown 不当作存档读：直接交给文本编辑器，改完写回同一个文件
  // 编辑器正开着另一份且有改动时，先问过才能换；同一份再双击就只是把焦点送回去
  if (lower.endsWith(TXT_EXT) || lower.endsWith(MD_EXT)) {
    if (teHandle === node.handle && teDom !== null && teDom.style.display !== "none") { teArea.focus(); return; }
    if (!(await leaveTextEditorForSwitch())) return;
    openTextEditor(node.handle, node.name, node);
    return;
  }
  if (!lower.endsWith(SAVE_EXT)) {
    console.log("[列表] " + node.name + " 不是存档，双击不打开");
    return;
  }
  // 切到画布之前同样先处理掉编辑器里的未保存改动
  if (!(await leaveTextEditorForSwitch())) return;
  // 就是当前打开的这一条：不必重读，重读反而会把手上没保存的改动抹掉
  if (node === S.openFileNode) return;
  // 先把手上这份画面收进它所属的那一条里，再换文档：不收的话，这份没保存的改动一被顶掉就再也找不回来
  stashCurrentScene();
  // 这一条里存着一份没保存的改动（之前从它这里切走过）就把它摆回来，不去读磁盘
  // 磁盘上那份是上次保存时的旧内容，读了就等于把改动丢掉
  if (node.scene !== null) {
    if (adoptScene(node.handle, parseScene(node.scene))) {
      S.docDirty = true;   // 摆回来的这一份本来就没保存过：applyScene 会把标记清掉，这里要重新亮上
      S.docEditSeq++;      // 摆回来同样是一次内容更替，序号要往前走，免得保存时误判成「期间没改过」
      S.openFileNode = node;
      openFilePath = node.path;   // 记住落处，刷新列表之后才找得回这一条
      console.log("[列表] 已切回 " + node.name + "，摆回没保存的那一份改动");
    }
    return;
  }
  // 没有存下的改动，就按工作区里的内容打开；成功后记住这一条，之后它被改动要在它前面亮圆点
  if (await openFromHandle(node.handle)) { S.openFileNode = node; openFilePath = node.path; }
}

/* ========== 悬停时的小窗 ========== */

// 一行上挂着的名字：名字由渲染那一步挂在行元素上，正常流程下取得到，取不到就给个空串
function sidebarRowName(row) {
  return row.sidebarNode === undefined ? "" : row.sidebarNode.name;
}

// 在指针旁边冒出小窗，写上这一条的全名
// 先写文本再量尺寸：名字长短差得远，写死一个宽高不是截断就是空出一大块
function showSidebarTip(name) {
  S.sidebarTipDom.textContent = name;   // 名称是数据，用 textContent 写入，不做任何转义或拼接
  S.sidebarTipDom.style.display = "block";
  const w = S.sidebarTipDom.offsetWidth;
  const h = S.sidebarTipDom.offsetHeight;
  // 贴着指针摆在右下方，只留几像素的缝：缝再小就压住指针正指着的那一行，再大又不像「紧贴」
  let left = S.sidebarTipMX + 6;
  let top = S.sidebarTipMY + 8;
  if (left + w > window.innerWidth - 8) left = S.sidebarTipMX - w - 6;   // 右边放不下就翻到指针左侧
  if (top + h > window.innerHeight - 8) top = S.sidebarTipMY - h - 8;    // 下边放不下就翻到指针上方
  if (left < 8) left = 8;   // 名字长到两边都放不下时，宁可压住指针也不让它出窗口
  if (top < 8) top = 8;
  S.sidebarTipDom.style.left = left + "px";
  S.sidebarTipDom.style.top = top + "px";
}

// 收起小窗：把还在等的定时器、当前挂着的那一行、画面一起清掉
// 三样必须一起清，只清画面的话，那个定时器到点还会把已离开的一行的小窗又冒出来
function hideSidebarTip() {
  if (S.sidebarTipTimer !== null) { clearTimeout(S.sidebarTipTimer); S.sidebarTipTimer = null; }
  S.sidebarTipRow = null;
  S.sidebarTipDom.style.display = "none";
}

// 指针挪进某一行：先停一下再冒出小窗，停够之前离开就不冒
// 记的是行元素本身而不是下标：每次重画行元素都是新的，下标会指到别的行上去
function onSidebarTreeOver(e) {
  const row = e.target.closest(".sb-row");
  // 就地输入那一行没有挂节点，也就没有名字可写：与小窗无关，一并当成「没落在行上」
  // 不判它的话，指针停够时间会冒出一个空的小窗
  if (row === null || row.sidebarNode === undefined) { hideSidebarTip(); return; }   // 移到标题或空白处，收起
  // 不管在哪一行，都记下指针最新落点：小窗冒出来时才贴得住指针，而不是停在刚进这一行时的位置
  S.sidebarTipMX = e.clientX;
  S.sidebarTipMY = e.clientY;
  if (row === S.sidebarTipRow) {
    // 还在同一行里挪动：不必重开延时的钟；已经冒出来了就跟着指针走，还没冒出来就等它自己到点
    if (S.sidebarTipDom.style.display === "block") showSidebarTip(sidebarRowName(row));
    return;
  }
  hideSidebarTip();   // 换了一行：旧的定时器与画面一并作废，重新开始计时
  S.sidebarTipRow = row;
  S.sidebarTipTimer = setTimeout(function () {
    S.sidebarTipTimer = null;
    if (S.sidebarTipRow !== row) return;   // 到点时指针已经不在这条上了，就不冒
    showSidebarTip(sidebarRowName(row));
  }, Math.round(CONFIG.sidebarTipDelay * 1000));
}

// 指针离开某一行：真的离开这一行才收起
// 不判「是不是还在这一行里」的话，指针从行的图标挪到它自己的文字上也会先收到一次离开，小窗会闪一下再回来
function onSidebarTreeOut(e) {
  const row = e.target.closest(".sb-row");
  if (row === null || row !== S.sidebarTipRow) return;
  const to = e.relatedTarget;   // 指针正要去的地方
  if (to !== null && row.contains(to)) return;
  hideSidebarTip();
}

/* ========== 新建条目 ========== */

// 开始新建：先在目标那一层就地摆出一行输入框，名字敲定了才动磁盘
// 不做成弹窗问名字：一行输入贴着它将要落进去的那一层，看得见自己在哪儿建，视线也不必挪开
// ext 是子列表里选的那一种后缀；从菜单里那条「新建文件」直接进来时是空串，按默认那一种（存档）建
async function beginSidebarCreate(kind, ext) {
  if (S.sidebarCreateKind !== "") cancelSidebarCreate();   // 上一轮还没收尾就先收掉，免得多出一行
  const parent = S.sidebarMenuTarget;   // null 表示工作区根目录
  // 建在文件夹里时先把那个文件夹展开：收起时它的下级根本不进 DOM，输入行会挂到别处去
  if (parent !== null) {
    if (parent.loaded !== true && !(await loadSidebarFolder(parent))) return;   // 读不出来就作罢，原因已由上面那句打出
    parent.open = true;
  }
  S.sidebarCreateParent = parent;
  S.sidebarCreateKind = kind;
  // 后缀只在建文件时用得上；没有指定就给表里第一项，也就是电路存档，与从前的行为一致
  S.sidebarCreateExt = kind === "file" ? (ext === "" ? NEW_FILE_EXTS[0] : ext) : "";
  buildSidebarTree();   // 重画的末尾会把输入行摆上
  const row = S.sidebarNewRow;
  if (row === null) return;
  row.input.focus();
  // 隔一帧再要一次焦点：这一下是响应菜单按钮的点击，浏览器给按钮的那点默认焦点处理有可能
  // 排在我们后面，把焦点顶回去；隔一帧再要，拿到手的才是稳的（当帧那一次是为了立刻就有光标）
  requestAnimationFrame(function () {
    if (S.sidebarNewRow !== row) return;   // 这一轮已经收了（被取消，或又开了新一轮），别去动它
    row.input.focus();
    row.input.setSelectionRange(0, row.baseLen);   // 预选到后缀之前，直接打字就盖住名字
  });
}

// 把输入行插到目标那一层的最前面
// 锚点是目标文件夹自己那一行（根目录是那个标题行），插在它之后正好是它下级的第一位
function placeSidebarNewRow() {
  S.sidebarNewRow = null;
  if (S.sidebarCreateKind === "") return;   // 没有在新建
  let anchor = S.sidebarTreeDom.querySelector(".sb-header");   // 根目录：标题行之后就是第一级
  let depth = 0;
  if (S.sidebarCreateParent !== null) {
    anchor = findSidebarRow(S.sidebarCreateParent);
    if (anchor === null) return;   // 那一层此刻没画出来（比如正收起），等下次重画时再补
    depth = anchor.querySelectorAll(".sb-guide").length + 1;   // 下级比它自己多缩进一级
  }
  if (anchor === null) return;
  S.sidebarNewRow = makeSidebarNewRow(depth);
  anchor.parentNode.insertBefore(S.sidebarNewRow.root, anchor.nextSibling);
}

// 造那一行：缩进与图标照列表的样子来，名字那一段换成一个就地输入框
// 文件的名字连后缀一起预填，但只选到后缀之前，直接打字就盖住名字、后缀还留着
function makeSidebarNewRow(depth) {
  const isFolder = S.sidebarCreateKind === "folder";
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
  const icon = isFolder ? makeFolderIconSvg() : makeFileIconSvg(S.sidebarCreateExt);
  icon.setAttribute("class", isFolder ? "sb-icon folder" : "sb-icon file");
  root.appendChild(icon);
  const input = document.createElement("input");
  input.className = "sb-new-input";
  input.type = "text";
  input.spellcheck = false;
  const base = isFolder ? "新建文件夹" : "未命名";
  input.value = isFolder ? base : base + S.sidebarCreateExt;   // 后缀就用这一轮选定的那一种
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
    const row = S.sidebarNewRow;
    if (row === null || row.input !== input) return;
    requestAnimationFrame(function () {
      if (S.sidebarNewRow !== row) return;              // 这一轮已经结束了
      if (document.activeElement === input) return;   // 焦点又回来了，不算放弃
      cancelSidebarCreate();
    });
  });
  return { root: root, input: input, hint: hint, baseLen: base.length };
}

// 放弃这次新建：把输入行摘掉，其余一概不动
// 磁盘上的东西不在这里回退，因为这一行还在的时候，磁盘上什么都还没建
function cancelSidebarCreate() {
  if (S.sidebarCreateKind === "") return;
  const row = S.sidebarNewRow;
  // 先把状态清干净再去摘节点：摘掉一个带着焦点的输入框会触发 blur 绕回这里，状态清空了它就是空转
  S.sidebarNewRow = null;
  S.sidebarCreateKind = "";
  S.sidebarCreateExt = "";
  S.sidebarCreateParent = null;
  if (row !== null && row.root.parentNode !== null) row.root.parentNode.removeChild(row.root);
}

// 在输入行右边写一句最短的原因；传空串就是擦掉
// 出错时刻意不把这一行收掉：名字或落点改一下就能重来，整行消失反而让人以为是自己点错了
function setSidebarNewHint(text) {
  if (S.sidebarNewRow === null) return;
  S.sidebarNewRow.hint.textContent = text;   // 提示是数据，用 textContent 写入，不经过 HTML 解析
  S.sidebarNewRow.root.classList.toggle("is-error", text !== "");   // 出错时输入框的描边也跟着换成提示色
}

// 名字敲定：校验、查重、真正建到磁盘上、把新条目接进列表
// 顺序是「先全部通过再动手」，哪一步没过都原地留着输入行，改个名字就能接着来
async function commitSidebarCreate(rawName) {
  if (S.sidebarCreateKind === "") return;
  const kind = S.sidebarCreateKind;
  const ext = S.sidebarCreateExt;
  const parent = S.sidebarCreateParent;
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
    // 新条目在工作区里的相对路径：同步、圆点都按它认文件
    const parentPath = parent === null ? "" : parent.path;
    const path = parentPath === "" ? name : parentPath + "/" + name;
    let node;
    if (kind === "folder") {
      // 刚建出来的文件夹必定是空的，所以直接标成已读过，展开时不必再去读一次磁盘
      node = { name: name, isFolder: true, open: false, loaded: true, children: [], handle: await dirHandle.getDirectoryHandle(name, { create: true }), path: path };
    } else {
      const fileHandle = await dirHandle.getFileHandle(name, { create: true });
      // 只有电路存档要先写一份空存档进去：不写就是一个零字节文件，双击打开只会得到一句「不是本程序的存档」
      // 纯文本留成真正的空文件：一个字节都不写，别的程序打开就是一份干净的空文件
      if (ext === SAVE_EXT) await writeEmptyScene(fileHandle);
      node = { name: name, isFolder: false, handle: fileHandle, dirty: false, saving: false, scene: null, path: path };
      markCreated(path, "");   // 新文件只在工作区里，刷新到文件夹时才会写出去
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
  S.sidebarTreeDom.addEventListener("click", onSidebarTreeClick);
  S.sidebarTreeDom.addEventListener("dblclick", onSidebarTreeDblClick);
  S.sidebarTreeDom.addEventListener("mouseover", onSidebarTreeOver);
  S.sidebarTreeDom.addEventListener("mouseout", onSidebarTreeOut);
  window.addEventListener("keydown", onSidebarKeyDown);   // 悬停某一行时按回车即改名，只在这里绑一次
  setupSidebarMenu();   // 列表自己的右键菜单：两条固定条目建一次，右键时只改位置
  buildSidebarTree();
}
