// sidebar-menu.js：列表上的右键菜单、菜单引出的子列表，以及删条目那几条动作。
"use strict";

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
  S.sidebarMenuDom.appendChild(makeSidebarMenuItem("folder", "新建文件夹", makeNewEntryIconSvg(makeFolderShape())));
  // 「新建文件」这一条单独留个引用：指针压在它身上时要引出右边那一列文件类型
  S.sidebarFileItem = makeSidebarMenuItem("file", "新建文件", makeNewEntryIconSvg(makeInverterShape()));
  S.sidebarMenuDom.appendChild(S.sidebarFileItem);
  // 第三条「更改文件名」：压在文件行或文件夹行上时才露出来，压在别处整条都不在
  sidebarRenameItem = makeSidebarMenuItem("rename", "更改文件名", makeRenameIconSvg());
  sidebarRenameItem.classList.add("is-off");
  S.sidebarMenuDom.appendChild(sidebarRenameItem);
  // 最后一条「删除」先带着 is-off 藏起来：右键落在文件行上时才露出来，落在别处时它整条都不在
  sidebarDeleteItem = makeSidebarMenuItem("delete", "删除", makeTrashIconSvg());
  sidebarDeleteItem.classList.add("is-off");
  S.sidebarMenuDom.appendChild(sidebarDeleteItem);
  setupSidebarSubmenu();   // 「新建文件」右侧那一列文件类型：只建一次，悬停时只改位置与显示
  S.sidebarMenuDom.addEventListener("click", onSidebarMenuClick);
  // 悬停分级：压在「新建文件」上引出右侧那一列，压在别的条目上把它收掉；指针离开整个菜单也收
  S.sidebarMenuDom.addEventListener("mouseover", onSidebarMenuOver);
  S.sidebarMenuDom.addEventListener("mouseleave", laterHideSidebarSubmenu);
  // 点菜单以外的任何地方都收起：绑在捕获阶段，别处就算拦了冒泡也拦不住这一下
  document.addEventListener("mousedown", function (e) {
    if (!S.sidebarMenuOpen) return;
    if (e.target.closest !== undefined &&
        (e.target.closest("#sidebarMenu") !== null || e.target.closest("#sidebarSubmenu") !== null)) return;   // 点在两层菜单自己身上，那一下留给它们的 click
    closeSidebarMenu();
  }, true);
  // 下面几种情况一发生，菜单贴着指针的那个位置就不对了，一律收起，免得它孤零零停在半空中
  S.sidebarTreeDom.addEventListener("scroll", closeSidebarMenu);
  window.addEventListener("resize", closeSidebarMenu);
  window.addEventListener("blur", closeSidebarMenu);
  window.addEventListener("keydown", function (e) {
    if (e.code === "Escape") closeSidebarMenu();   // Esc 关浮层是通用习惯，弹窗那边也认它
  });
  S.sidebarTreeDom.addEventListener("contextmenu", onSidebarTreeContextMenu);
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
  S.sidebarMenuTarget = targets.folder;   // 新建落到哪一层
  S.sidebarMenuNode = targets.node;       // 改名作用在它上面，删除也读它
  // 「更改文件名」压在条目行上就露出来，文件与文件夹都能改；「删除」只在文件行上露出来
  sidebarRenameItem.classList.toggle("is-off", targets.node === null);
  sidebarDeleteItem.classList.toggle("is-off", targets.file === null);
  S.sidebarMenuOpen = true;
  S.sidebarMenuDom.style.display = "block";
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
  const w = S.sidebarMenuDom.offsetWidth;
  const h = S.sidebarMenuDom.offsetHeight;
  let left = mx + 2;
  let top = my + 2;
  if (left + w > window.innerWidth - 8) left = mx - w - 2;   // 右边放不下就翻到指针左侧
  if (top + h > window.innerHeight - 8) top = my - h - 2;    // 下边放不下就翻到指针上方
  if (left < 8) left = 8;   // 两边都放不下时宁可压住指针，也不让它出窗口
  if (top < 8) top = 8;
  S.sidebarMenuDom.style.left = left + "px";
  S.sidebarMenuDom.style.top = top + "px";
}

// 收起菜单：只改显示与标记，目标文件夹留着不动，它由新建那一段接着用
// 子列表是菜单的下一级，菜单一收它不能还孤零零留在半空中，所以在这里一并收掉
function closeSidebarMenu() {
  hideSidebarSubmenu();
  if (!S.sidebarMenuOpen) return;
  S.sidebarMenuOpen = false;
  S.sidebarMenuDom.style.display = "none";
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
    S.sidebarSubmenuDom.appendChild(item);
  }
  // 这几条与菜单里那几条共用同一个处理：它们都带着 kind 字段，点下来都是「开始新建」，
  // 只是各自还带着自己的后缀，不必为它们另写一份新建的调用
  S.sidebarSubmenuDom.addEventListener("click", onSidebarMenuClick);
  // 指针落进子列表就把「延时收起」撤掉：从条目挪过来要跨过中间的缝，那一下会先收到一次离开
  S.sidebarSubmenuDom.addEventListener("mouseenter", cancelSidebarSubmenuTimer);
  // 离开子列表也按延时收：往回挪到「新建文件」上时，那一条会把它重新叫出来，
  // 若这里当场收掉，子列表会先闪没再出现；延时收的话它一直都在，只是继续开着
  S.sidebarSubmenuDom.addEventListener("mouseleave", laterHideSidebarSubmenu);
}

// 指针压在菜单的某一条上：压的是「新建文件」就把子列表引出来，压在别的条目上就立刻收掉
// 用 mouseover 挂在菜单容器上，靠冒泡从每条条目上收到这一次；条目以后增多也不必逐条再绑一遍
function onSidebarMenuOver(e) {
  const item = e.target.closest(".sb-menu-item");
  if (item === S.sidebarFileItem) showSidebarSubmenu(item);
  else if (item !== null) hideSidebarSubmenu();
  // item 为 null 是指针落在菜单的内边距上，这时什么都不做：
  // 从条目挪进右侧子列表恰好要跨过这几像素，这里一收，子列表就先闪没了，指针接着的进入便落空
}

// 指针离开菜单：不当场收，隔一小会儿再收
// 从「新建文件」斜着挪进子列表时，中间会先收到一次「离开菜单」；当场收掉的话子列表会闪一下再回来
function laterHideSidebarSubmenu() {
  cancelSidebarSubmenuTimer();
  S.sidebarSubmenuTimer = setTimeout(function () {
    S.sidebarSubmenuTimer = null;
    hideSidebarSubmenu();
  }, Math.round(CONFIG.sidebarSubmenuDelay * 1000));
}

// 撤掉那个等着收起的钟：指针又落回子列表、或菜单已经收掉时，这一次延时就不该再生效
function cancelSidebarSubmenuTimer() {
  if (S.sidebarSubmenuTimer === null) return;
  clearTimeout(S.sidebarSubmenuTimer);
  S.sidebarSubmenuTimer = null;
}

// 把子列表摆到「新建文件」的右侧：上下与那一条对齐，右边放不下就翻到菜单左侧
// 先显示再量尺寸：宽高由内容决定，量出来才摆得准，与右键菜单那一处是同一套做法
function showSidebarSubmenu(item) {
  cancelSidebarSubmenuTimer();
  if (S.sidebarSubmenuOpen === true) return;   // 已经开着就不再量一遍：指针在条目里挪动时这里会被反复叫到
  const box = item.getBoundingClientRect();
  S.sidebarSubmenuDom.style.display = "block";
  const w = S.sidebarSubmenuDom.offsetWidth;
  const h = S.sidebarSubmenuDom.offsetHeight;
  let left = box.right + 2;   // 贴着这一条的右缘，中间留一条很窄的缝，看得出是从它引出来的
  let top = box.top;          // 与这一条上下对齐，视线从菜单跳到子列表时不用上下找
  // 右边放不下就翻到菜单左侧：若翻到条目的左侧，子列表会压在菜单自己身上，把菜单那几条盖住
  if (left + w > window.innerWidth - 8) left = S.sidebarMenuDom.getBoundingClientRect().left - w - 2;
  if (top + h > window.innerHeight - 8) top = window.innerHeight - 8 - h;   // 下边放不下就往上收，仍与条目大致齐平
  if (left < 8) left = 8;   // 两边都放不下时宁可压住菜单，也不让它探出窗口
  if (top < 8) top = 8;
  S.sidebarSubmenuDom.style.left = left + "px";
  S.sidebarSubmenuDom.style.top = top + "px";
  S.sidebarSubmenuOpen = true;
}

// 收起子列表：先撤掉等着收起的钟，再改显示
// 反复调用是常态（指针在菜单里挪来挪去、菜单整个收起时都会叫到），所以先判一次是否已经收起
function hideSidebarSubmenu() {
  cancelSidebarSubmenuTimer();
  if (S.sidebarSubmenuOpen !== true) return;
  S.sidebarSubmenuOpen = false;
  S.sidebarSubmenuDom.style.display = "none";
}

/* ========== 删除条目 ========== */

// 删掉右键点中的那个文件：先问一句，再动磁盘，最后把它从列表里摘掉
// 只做文件，不做文件夹：删文件夹要连里面的一起删，是一次不可逆的批量动作，不该放在顺手就能点到的地方
async function onSidebarMenuDelete() {
  const node = S.sidebarMenuNode;
  // 先取走再往下走：这一轮右键的结论只用一次，弹窗开着时又去右键了别的行，不该串到这一回上来
  S.sidebarMenuNode = null;
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
  // 记下「工作区里删了一份」：刷新到文件夹时据此删掉对面那一份（对面本来就没有也不算错）
  markDeleted(node.path);
  // 删掉的可能正是编辑器里打开的那一个，那样必须先把绑定解掉
  // 先按列表记着的那一条判（同一个节点，最直接）；它为空时（当初从系统文件框打开的）再问一次磁盘上的句柄
  // 是不是同一个文件：同一个文件每次拿到的句柄是两个对象，拿它们比相等是比不出来的，要用 isSameEntry
  let wasOpen = S.openFileNode === node;
  if (!wasOpen && S.currentFileHandle !== null) {
    try { wasOpen = await S.currentFileHandle.isSameEntry(node.handle); } catch (err) { wasOpen = false; }
  }
  if (wasOpen) {
    // 文件已经不在磁盘上了，还绑着它的话，下一次保存会把它原样写回来
    // 画面上的电路不动，它自此是一份没有落处的改动：名字回到占位名，并按未保存算，
    // 之后换文件夹时仍会照常问一句要不要丢弃，不会不声不响地把它丢掉
    S.currentFileHandle = null;
    S.currentFileName = "";
    S.openFileNode = null;
    openFilePath = "";
    S.docDirty = true;
    S.docEditSeq++;   // 原来绑着的那份文件没了，画面按未保存算，序号也要往前走
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

