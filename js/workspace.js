// workspace.js：浏览器内部工作区（OPFS）与用户文件夹之间的批量同步与绑定。
// 工作区文件树只受管 .lccas / .txt / .md 三种文件，其余文件永不导入、永不同步、永不删除。
"use strict";

/* ========== 常量 ========== */

const WORKSPACE_DIR_NAME = "workspace";      // string：OPFS 里工作区根目录的名字，所有工作区文件都放在它下面
const BOUND_FOLDER_KEY = "boundFolder";      // string：绑定文件夹句柄在 IndexedDB 里的键名
const BASELINE_KEY = "boundBaseline";        // string：上次同步时绑定文件夹里受管文件路径清单的键名
const UNSYNCED_KEY = "unsyncedPaths";        // string：还没写回文件夹的路径清单的键名
const PENDING_DELETES_KEY = "pendingDeletes";// string：工作区删过、还要从文件夹删掉的路径清单的键名

/* ========== 状态 ========== */

let workspaceRoot = null;    // FileSystemDirectoryHandle|null：OPFS 工作区根目录句柄，取到一次就缓存
let boundFolder = null;      // FileSystemDirectoryHandle|null：当前绑定的用户文件夹，null 表示还没绑定
let baselinePaths = [];      // Array<string>：上次同步时绑定文件夹里受管文件的相对路径，用来判「保留」
let unsyncedPaths = [];      // Array<string>：工作区里改过、还没写回绑定文件夹的路径
let pendingDeletes = [];     // Array<string>：工作区删过、还要从绑定文件夹删掉的路径
let openFilePath = "";       // string：当前打开的电路文件在工作区里的相对路径，空串表示没有落处

/* ========== 基础查询 ========== */

// 判断一个文件名是不是受管的那三种：大小写不敏感，其它后缀一律不碰
function isManagedFileName(name) {
  const lower = name.toLowerCase();
  return lower.endsWith(SAVE_EXT) || lower.endsWith(TXT_EXT) || lower.endsWith(MD_EXT);
}

// 取工作区根目录：没有就建一个，取到之后一直缓存
// OPFS 不需要任何权限，这一步不会弹系统询问，也是保存不再等七秒的根本原因
async function getWorkspaceRoot() {
  if (workspaceRoot !== null) return workspaceRoot;
  if (!navigator.storage || !navigator.storage.getDirectory) return null;
  try {
    const opfs = await navigator.storage.getDirectory();
    workspaceRoot = await opfs.getDirectoryHandle(WORKSPACE_DIR_NAME, { create: true });
    return workspaceRoot;
  } catch (err) {
    console.log("[工作区] 打不开内部工作区：", err);
    return null;
  }
}

// 启动时把绑定的文件夹句柄与基线清单读回内存：读不到就是还没绑定过
async function loadWorkspaceState() {
  const folder = await getStoredHandle(BOUND_FOLDER_KEY);
  const baseline = await getStoredHandle(BASELINE_KEY);
  const unsynced = await getStoredHandle(UNSYNCED_KEY);
  const deletes = await getStoredHandle(PENDING_DELETES_KEY);
  boundFolder = folder || null;
  baselinePaths = Array.isArray(baseline) ? baseline : [];
  unsyncedPaths = Array.isArray(unsynced) ? unsynced : [];
  pendingDeletes = Array.isArray(deletes) ? deletes : [];
}

// 把两张「待办」清单写回库：重开页面后圆点与待删项都还认得
// 调用频率很低（保存、新建、删除、改名各一次），直接写，不必攒批
function persistMarks() {
  putStoredHandle(UNSYNCED_KEY, unsyncedPaths);
  putStoredHandle(PENDING_DELETES_KEY, pendingDeletes);
}

// 把绑定文件夹与基线清单写进库：跨会话仍然记得上次同步到哪儿了
async function persistBindings() {
  await putStoredHandle(BOUND_FOLDER_KEY, boundFolder);
  await putStoredHandle(BASELINE_KEY, baselinePaths);
}

/* ========== 未同步标记 ========== */

// 把一个路径记成「改过、还没写回文件夹」：同一路径只留一份
function markUnsynced(path) {
  if (path === "") return;
  if (unsyncedPaths.indexOf(path) < 0) { unsyncedPaths.push(path); persistMarks(); }
}

// 把一个路径从「未同步」里去掉：它已经和文件夹对齐了
function clearUnsynced(path) {
  const i = unsyncedPaths.indexOf(path);
  if (i >= 0) { unsyncedPaths.splice(i, 1); persistMarks(); }
}

// 这个路径此刻是不是还没写回文件夹：列表圆点按它亮灭
function isWorkspaceUnsynced(path) {
  return unsyncedPaths.indexOf(path) >= 0;
}

// 记下「工作区删掉了一个文件」：刷新到文件夹时要据此删掉对面那一份
function markDeleted(path) {
  clearUnsynced(path);
  if (path === "" || pendingDeletes.indexOf(path) >= 0) return;
  pendingDeletes.push(path);
  persistMarks();
}

// 工作区里新增或改名出一个文件：它要写回文件夹，旧路径（改名时）要记成待删
function markCreated(path, oldPath) {
  markUnsynced(path);
  if (oldPath && baselinePaths.indexOf(oldPath) >= 0) markDeleted(oldPath);
}

/* ========== 路径工具 ========== */

// 相对路径的上一级：根目录下的文件返回空串
function dirPathOf(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

// 相对路径的文件名部分
function nameOfPath(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

// 按相对路径逐层取目录句柄；create 为真时缺哪层就建哪层
async function ensureDirByPath(root, path, create) {
  if (path === "") return root;
  const parts = path.split("/");
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = await cur.getDirectoryHandle(parts[i], { create: create === true });
  }
  return cur;
}

// 把整棵树里的每个节点补上 path：根是空串，子节点是「上级 + 名字」
// 新建、改名、刷新树之后都要调一次，路径与树才不会各说各的
function refreshTreePaths() {
  if (currentTree === null) return;
  currentTree.path = "";
  fillTreePaths(currentTree.children, "");
}

// 递归给一层节点补 path
function fillTreePaths(nodes, prefix) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    node.path = prefix === "" ? node.name : prefix + "/" + node.name;
    if (node.isFolder === true && node.children !== null) fillTreePaths(node.children, node.path);
  }
}

// 按路径在树里找一个节点；找不到返回 null
function findNodeByPath(path) {
  if (currentTree === null || path === "") return null;
  const stack = [currentTree.children];
  while (stack.length > 0) {
    const level = stack.pop();
    for (let i = 0; i < level.length; i++) {
      const node = level[i];
      if (node.path === path) return node;
      if (node.isFolder === true && node.children !== null) stack.push(node.children);
    }
  }
  return null;
}

/* ========== 磁盘操作 ========== */

// 递归收一个目录下的受管文件：返回 [{ path, name, handle }]，非受管文件与子目录里的其它文件都跳过
async function collectManagedFiles(dirHandle, prefix, out) {
  for await (const entry of dirHandle.values()) {
    const path = prefix === "" ? entry.name : prefix + "/" + entry.name;
    if (entry.kind === "directory") {
      await collectManagedFiles(entry, path, out);
    } else if (isManagedFileName(entry.name)) {
      out.push({ path: path, name: entry.name, handle: entry });
    }
  }
  return out;
}

// 把源文件夹里的受管文件全部拷进工作区，同名覆盖；返回实际写进去的路径
async function copyFolderIntoWorkspace(root, srcDir, prefix, written) {
  for await (const entry of srcDir.values()) {
    const path = prefix === "" ? entry.name : prefix + "/" + entry.name;
    if (entry.kind === "directory") {
      await copyFolderIntoWorkspace(root, entry, path, written);
      continue;
    }
    if (!isManagedFileName(entry.name)) continue;
    let text;
    try {
      text = await (await entry.getFile()).text();
    } catch (err) {
      console.log("[工作区] 读取 " + path + " 失败，已跳过：", err);
      continue;
    }
    const dir = await ensureDirByPath(root, dirPathOf(path), true);
    const fh = await dir.getFileHandle(nameOfPath(path), { create: true });
    const stream = await fh.createWritable();
    await stream.write(text);
    await stream.close();
    written.push(path);
  }
  return written;
}

// 把工作区里的一批受管文件写进目标文件夹，保持已有的层级；任何一次失败都直接抛出，由调用方中止
async function writeFilesToFolder(dstDir, files) {
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const text = await (await f.handle.getFile()).text();
    const dir = await ensureDirByPath(dstDir, dirPathOf(f.path), true);
    const fh = await dir.getFileHandle(f.name, { create: true });
    const stream = await fh.createWritable();
    await stream.write(text);
    await stream.close();
  }
}

// 按相对路径删掉目标文件夹里的一个文件；文件本来就不在时不算错
async function removeFileInFolder(dstDir, path) {
  try {
    const dir = await ensureDirByPath(dstDir, dirPathOf(path), false);
    await dir.removeEntry(nameOfPath(path));
  } catch (err) {
    if (err.name !== "NotFoundError") throw err;
  }
}

/* ========== 列表刷新 ========== */

// 重新从工作区读一层铺进列表，并把当前打开的那份按路径重新绑上
// 同步、导入这类整批动作之后调用：树换成新的，圆点与路径也一起对齐
async function reloadWorkspaceTree() {
  const root = await getWorkspaceRoot();
  if (root === null) return;
  await adoptWorkspaceFolder(root);
  const node = findNodeByPath(openFilePath);
  if (node !== null && node.isFolder !== true) S.openFileNode = node;
  // 正开着的文本编辑器也按路径重新绑上，否则它的圆点指向了已经不在树上的旧节点
  if (teNode !== null) {
    const tn = findNodeByPath(teNode.path);
    if (tn !== null && tn.isFolder !== true) teNode = tn;
  }
}

/* ========== 四个按钮 ========== */

// 按钮一：从一个任意文件夹导入（可以是绑定的，也可以是别的），只拷进工作区，不改绑定
// 同名覆盖，工作区里多出来的文件原样保留；导入进来的路径都记为待写回
async function onImportFolder() {
  if (!("showDirectoryPicker" in window)) { showToast("当前浏览器不支持选择文件夹"); return; }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ mode: "read" });
  } catch (err) {
    if (err.name !== "AbortError") { console.log("[工作区] 选文件夹出错：", err); showToast("选择文件夹失败，请重试"); }
    return;
  }
  const root = await getWorkspaceRoot();
  if (root === null) { showToast("当前浏览器不支持内部工作区"); return; }
  try {
    const written = await copyFolderIntoWorkspace(root, handle, "", []);
    for (let i = 0; i < written.length; i++) markUnsynced(written[i]);
    await reloadWorkspaceTree();
    console.log("[工作区] 从 " + handle.name + " 导入 " + written.length + " 个文件");
    showToast(written.length === 0 ? "这个文件夹里没有可导入的文件" : "已导入 " + written.length + " 个文件");
  } catch (err) {
    console.log("[工作区] 导入失败：", err);
    showToast("导入失败，请重试");
  }
}

// 按钮二：把当前绑定的文件夹整份拉进工作区，同名覆盖，不删工作区里多出来的文件
// 拉完之后两边这一部分就一致了，待删记号与未同步记号一并清掉
async function onRefreshFromFolder() {
  if (boundFolder === null) { showToast("还没有绑定文件夹，请先「另存为」选一个"); return; }
  if (!(await ensureWritePermission(boundFolder))) { showToast("没有文件夹的访问权限"); return; }
  const root = await getWorkspaceRoot();
  if (root === null) { showToast("当前浏览器不支持内部工作区"); return; }
  try {
    const written = await copyFolderIntoWorkspace(root, boundFolder, "", []);
    for (let i = 0; i < written.length; i++) clearUnsynced(written[i]);
    baselinePaths = written.slice();   // 文件夹里受管文件的全集，就是这一次拷进来的这一批
    pendingDeletes = [];                // 已按文件夹对齐，不存在待删项
    await persistBindings();
  persistMarks();
    await reloadWorkspaceTree();
    console.log("[工作区] 已从 " + boundFolder.name + " 刷新 " + written.length + " 个文件");
    showToast("已刷新 " + written.length + " 个文件到工作区");
  } catch (err) {
    console.log("[工作区] 刷新到工作区失败：", err);
    showToast("刷新失败，请重试");
  }
}

// 按钮三：把工作区整份写回绑定的文件夹，按需删除对面那一批
// 删除前先弹窗；写入失败时一个都不删，避免删完才发现新内容没写进去
async function onSyncToFolder() {
  if (boundFolder === null) { showToast("还没有绑定文件夹，请先「另存为」选一个"); return; }
  if (!(await ensureWritePermission(boundFolder))) { showToast("没有文件夹的写入权限"); return; }
  const root = await getWorkspaceRoot();
  if (root === null) { showToast("当前浏览器不支持内部工作区"); return; }
  let wsFiles;
  let folderFiles;
  try {
    wsFiles = await collectManagedFiles(root, "", []);
    folderFiles = await collectManagedFiles(boundFolder, "", []);
  } catch (err) {
    console.log("[工作区] 读取两边文件清单失败：", err);
    showToast("读取文件夹失败，请重试");
    return;
  }
  const wsPaths = wsFiles.map(function (f) { return f.path; });
  const folderPaths = folderFiles.map(function (f) { return f.path; });
  const deletes = pendingDeletes.filter(function (p) { return folderPaths.indexOf(p) >= 0; });
  const keeps = folderPaths.filter(function (p) {
    return wsPaths.indexOf(p) < 0 && baselinePaths.indexOf(p) < 0;
  });
  let action = "deleted-only";
  if (deletes.length > 0 || keeps.length > 0) {
    action = await askSyncDialog(deletes, keeps);
    if (action === "cancel") return;
  }
  try {
    await writeFilesToFolder(boundFolder, wsFiles);
  } catch (err) {
    console.log("[工作区] 写入文件夹失败，已中止：", err);
    showToast("写入文件夹失败，没有删除任何文件");
    return;
  }
  const toDelete = action === "all" ? deletes.concat(keeps) : deletes;
  try {
    for (let i = 0; i < toDelete.length; i++) await removeFileInFolder(boundFolder, toDelete[i]);
  } catch (err) {
    console.log("[工作区] 删除文件失败：", err);
    showToast("部分文件没有删除，请重试");
  }
  baselinePaths = wsPaths.slice();
  unsyncedPaths = [];
  pendingDeletes = [];
  await persistBindings();
  persistMarks();
  await reloadWorkspaceTree();
  console.log("[工作区] 已刷新到 " + boundFolder.name + "：写入 " + wsFiles.length + " 个，删除 " + toDelete.length + " 个");
  showToast("已刷新到文件夹「" + boundFolder.name + "」");
}

// 按钮四：把整个工作区写到一个新选的文件夹，并把这个文件夹设成新的绑定
async function onSaveWorkspaceAs() {
  if (!("showDirectoryPicker" in window)) { showToast("当前浏览器不支持选择文件夹"); return; }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ mode: "readwrite" });
  } catch (err) {
    if (err.name !== "AbortError") { console.log("[工作区] 选文件夹出错：", err); showToast("选择文件夹失败，请重试"); }
    return;
  }
  if (!(await ensureWritePermission(handle))) { showToast("没有文件夹的写入权限"); return; }
  const root = await getWorkspaceRoot();
  if (root === null) { showToast("当前浏览器不支持内部工作区"); return; }
  let files;
  try {
    files = await collectManagedFiles(root, "", []);
  } catch (err) {
    console.log("[工作区] 读取工作区失败：", err);
    showToast("读取工作区失败，请重试");
    return;
  }
  try {
    await writeFilesToFolder(handle, files);
  } catch (err) {
    console.log("[工作区] 另存为失败：", err);
    showToast("写入文件夹失败，请重试");
    return;
  }
  boundFolder = handle;
  baselinePaths = files.map(function (f) { return f.path; });
  unsyncedPaths = [];
  pendingDeletes = [];
  await persistBindings();
  persistMarks();
  await reloadWorkspaceTree();
  console.log("[工作区] 已另存为到 " + handle.name + "，共 " + files.length + " 个文件");
  showToast("已绑定文件夹「" + handle.name + "」");
}

/* ========== 同步确认弹窗 ========== */

let syncDialogDom = null;     // HTMLElement|null：弹窗整层，只建一次
let syncResolve = null;       // Function|null：这一轮等着的作答回调，同一时刻只允许一个弹窗

// 造弹窗的骨架：标题、说明、清单、按钮行，全部只建一次；之后每次只换内容
function initSyncDialogDom() {
  syncDialogDom = document.createElement("div");
  syncDialogDom.className = "sync-dialog";
  const card = document.createElement("div");
  card.className = "sync-card";
  const title = document.createElement("div");
  title.className = "sync-title";
  const sub = document.createElement("div");
  sub.className = "sync-sub";
  const list = document.createElement("div");
  list.className = "sync-list";
  const actions = document.createElement("div");
  actions.className = "sync-actions";
  card.appendChild(title);
  card.appendChild(sub);
  card.appendChild(list);
  card.appendChild(actions);
  syncDialogDom.appendChild(card);
  syncDialogDom.style.display = "none";
  document.body.appendChild(syncDialogDom);
  // Esc 等于按「取消」：与项目里其它浮层的习惯一致，不必去够右下角那个按钮
  window.addEventListener("keydown", function (e) {
    if (e.code === "Escape" && syncResolve !== null) {
      e.preventDefault();
      closeSyncDialog("cancel");
    }
  });
}

// 造一行清单：左边一个图标，右边一个文件名
// kind 为 "delete" 时图标是红色垃圾桶，为 "keep" 时是灰色的文件图标
function makeSyncRow(path, kind) {
  const row = document.createElement("div");
  row.className = "sync-row is-" + kind;
  const icon = kind === "delete" ? makeTrashIconSvg() : makeFileIconSvg(sidebarFileExt(path));
  icon.setAttribute("class", "sb-icon " + (kind === "delete" ? "sync-del-icon" : "sync-keep-icon"));
  row.appendChild(icon);
  const name = document.createElement("span");
  name.className = "sync-name";
  name.textContent = path;   // 路径是数据，用 textContent 写入，不经过 HTML 解析
  row.appendChild(name);
  return row;
}

// 弹窗作答：deletes 是将从文件夹删掉的，keeps 是文件夹里有、工作区里没有、也会被删掉的
// 返回 "cancel" / "deleted-only" / "all"；没有待删项只有保留项时，两个按钮是「取消」与「继续」
function askSyncDialog(deletes, keeps) {
  return new Promise(function (resolve) {
    if (syncResolve !== null) return;   // 已经有一个在等，不叠第二个
    syncResolve = resolve;
    const card = syncDialogDom.querySelector(".sync-card");
    const title = card.querySelector(".sync-title");
    const sub = card.querySelector(".sync-sub");
    const list = card.querySelector(".sync-list");
    const actions = card.querySelector(".sync-actions");
    list.textContent = "";
    actions.textContent = "";
    const all = deletes.concat(keeps);
    title.textContent = all.length > 0 ? "将删除 " + all.length + " 个文件" : "没有文件需要删除";
    sub.textContent = deletes.length > 0
      ? "这些文件在文件夹里已经找不到对应的电路，继续会一并删掉。"
      : "文件夹里还有一些文件不在这份工作区里，继续会一并删掉。";
    for (let i = 0; i < deletes.length; i++) list.appendChild(makeSyncRow(deletes[i], "delete"));
    for (let i = 0; i < keeps.length; i++) list.appendChild(makeSyncRow(keeps[i], "keep"));
    // 取消：常态配色，最左
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "sync-btn is-cancel";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", function () { closeSyncDialog("cancel"); });
    actions.appendChild(cancelBtn);
    // 只删工作区已删的：红色，只有真的存在待删项时才出现
    if (deletes.length > 0) {
      const onlyBtn = document.createElement("button");
      onlyBtn.type = "button";
      onlyBtn.className = "sync-btn is-delete";
      onlyBtn.textContent = "删除工作区已删的";
      onlyBtn.addEventListener("click", function () { closeSyncDialog("deleted-only"); });
      actions.appendChild(onlyBtn);
    }
    // 全部删除：更深一档的红色、加粗，只有存在保留项时才出现
    if (keeps.length > 0) {
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "sync-btn is-delete-all";
      allBtn.textContent = "全部删除";
      allBtn.addEventListener("click", function () { closeSyncDialog("all"); });
      actions.appendChild(allBtn);
    }
    syncDialogDom.style.display = "flex";
  });
}

// 收掉弹窗并把结论交回等待的那一段
function closeSyncDialog(action) {
  if (syncResolve === null) return;
  const resolve = syncResolve;
  syncResolve = null;
  syncDialogDom.style.display = "none";
  resolve(action);
}

/* ========== 按钮条 ========== */

// 一个按钮的图标：四条路径分别对应导入、拉取、写回、另存为
function workspaceButtonIcon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "ws-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  if (kind === "import") path.setAttribute("d", "M4 6h6l2 2h8v10H4zM12 11v5M9.5 13.5L12 16l2.5-2.5");
  else if (kind === "pull") path.setAttribute("d", "M4 6h6l2 2h8v10H4zM12 10v5M9.5 12.5L12 15l2.5-2.5");
  else if (kind === "push") path.setAttribute("d", "M4 6h6l2 2h8v10H4zM12 15V10M9.5 12.5L12 10l2.5 2.5");
  else path.setAttribute("d", "M4 6h6l2 2h8v10H4zM7 15h10M9 17.5h6");
  svg.appendChild(path);
  return svg;
}

// 建四个按钮：图标在上、短名称在下，点击各走一条流程
function initWorkspaceBar() {
  const bar = document.getElementById("workspaceBar");
  if (bar === null) return;
  const items = [
    { kind: "import", label: "导入", title: "从文件夹导入", run: onImportFolder },
    { kind: "pull", label: "拉取", title: "刷新到工作区", run: onRefreshFromFolder },
    { kind: "push", label: "写回", title: "刷新到文件夹", run: onSyncToFolder },
    { kind: "saveas", label: "另存为", title: "另存为并绑定", run: onSaveWorkspaceAs }
  ];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ws-btn";
    btn.title = item.title;
    btn.appendChild(workspaceButtonIcon(item.kind));
    const label = document.createElement("span");
    label.textContent = item.label;
    btn.appendChild(label);
    btn.addEventListener("click", function () { item.run(); });
    // 按下时不抢焦点：键盘快捷键绑在窗口上，按钮不该留着焦点框
    btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
    bar.appendChild(btn);
  }
}
