// sidebar-rename.js：就地更改文件名：右键菜单与悬停按回车两条入口都汇到同一段逻辑。
"use strict";

/* ========== 更改文件名 ========== */

// 右键「更改文件名」或悬停某一行按回车：把目标那一行原位换成一个输入框，名字与后缀一起预填，只预选名字那一段
// 不另开弹窗：改名是一步就完成的小事，就地和新建文件用同一套输入行，手感一致
// 文件与文件夹走同一条路：文件夹没有后缀，输入框里就是整个名字
function beginSidebarRename() {
  const node = S.sidebarMenuNode;
  S.sidebarMenuNode = null;   // 这一轮右键的结论只用一次，先取走
  if (node === null) return;
  const isFolder = node.isFolder === true;
  if (S.sidebarCreateKind !== "") cancelSidebarCreate();   // 新建的输入行还挂着就先收掉，两行不能同时在场
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
    wasOpen = S.openFileNode === node;
    if (!wasOpen && S.currentFileHandle !== null) {
      try { wasOpen = await S.currentFileHandle.isSameEntry(node.handle); } catch (err) { wasOpen = false; }
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
    const oldPath = node.path;
    node.name = name;
    node.handle = newHandle;
    refreshTreePaths();   // 名字变了，整棵树的路径跟着重算（文件夹改名时它的所有下级也要一起变）
    // 旧路径在绑定文件夹里见过：刷新时要删掉对面那一份；新路径随后要写回去
    if (oldPath !== node.path) {
      markUnsynced(node.path);
      if (baselinePaths.indexOf(oldPath) >= 0) markDeleted(oldPath);
    }
    // 正打开着的那一份跟着换绑：不改的话，下一次保存会按旧名字把它重新写出一份来
    if (wasOpen) {
      S.currentFileHandle = newHandle;
      S.currentFileName = name;
      S.openFileNode = node;
      openFilePath = node.path;
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
  const row = S.sidebarTipRow;
  if (row === null || row.isConnected !== true) return null;
  return row.sidebarNode === undefined ? null : row.sidebarNode;
}

// 悬停某一行时按回车：与右键菜单里那条「更改文件名」等价，省掉一次右键
// 只认回车，别的键留给画布那一套快捷键；焦点在输入框里、模态弹窗或右键菜单开着时都不抢
function onSidebarKeyDown(e) {
  if (e.code !== "Enter" && e.code !== "NumpadEnter") return;
  if (e.isComposing || e.keyCode === 229) return;   // 输入法正在组字：这一下回车是在选候选词
  if (S.confirmOpen || S.tutorialOpen || S.sidebarMenuOpen) return;
  if (isTextEntry(e.target)) return;   // 就地输入的那一行自己认回车，不能两头都处理
  if (sidebarRenameNode !== null || S.sidebarCreateKind !== "") return;   // 已经有一行输入在场了
  const node = sidebarHoveredNode();
  if (node === null) return;   // 指针不在条目行上：回车在这里没有别的事可做
  e.preventDefault();
  S.sidebarMenuNode = node;   // 改名那一段读的就是这个变量，这里先把它摆成指针停着的那一条
  beginSidebarRename();
}

