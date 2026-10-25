// handle-store.js：文件句柄的记忆，以及存档文件的类型声明。
// 编辑器与首页共用这一份：两页读写的是同一个库、同一个键，所以首页记下的句柄，编辑器启动时读得到。
// 本文件不依赖任何编辑器的状态，也不依赖 state.js，所以首页可以单独加载它。
"use strict";

/* ========== 存档文件的类型声明 ========== */

// 存档文件的后缀名：只有这一处写死，两页的读写、名字显示与文件框过滤都从它推出来
const SAVE_EXT = ".lccas";    // string：存档文件的后缀名

// 另外两种可以直接新建的文件：纯文本，与电路无关，只借工作区文件夹放笔记
// 后缀写在这里而不是散在界面那几处：以后要添一种格式，改这一行与下面那张表即可
const TXT_EXT = ".txt";       // string：纯文本文件的后缀名
const MD_EXT = ".md";         // string：Markdown 文件的后缀名

// 能新建的文件类型：子列表按这个顺序铺条目，第一项是电路存档（默认的那一种），其余是纯文本
const NEW_FILE_EXTS = [SAVE_EXT, TXT_EXT, MD_EXT];  // Array<string>：新建文件时可选的几种后缀

// 存档的文件类型声明：保存框与打开框共用一份，两边的扩展名写法才不会各写各的
const SAVE_FILE_TYPES = [{ description: "激光门存档", accept: { "application/json": [SAVE_EXT] } }];  // Array：交给系统文件框的类型过滤表

// 本地文件读写能力：保存对话框与打开对话框是同一批方法，任一存在就说明整条路线可用
// 只在脚本加载时检测一次：这个能力在页面存活期间不会变，不必每到一处重算
const canUseLocalFile = "showSaveFilePicker" in window;  // boolean：浏览器是否支持直接读写本地文件

/* ========== 文件句柄的记忆 ========== */

// 存放文件句柄的小库：库名、仓库名、键名三件套，两页必须完全一致，所以集中写在这一处
const FS_DB_NAME = "laser-gate-files";  // string：存放文件句柄的小数据库名
const FS_STORE_NAME = "handles";        // string：对象仓库名
const FS_HANDLE_KEY = "last";           // string：上次用过的文件句柄的键名，只用来给系统选择器定「从哪个目录起步」
const FS_WORKSPACE_KEY = "workspace";   // string：上次当工作区用的目录句柄的键名，编辑器启动时试着接着打开它

// 两个键各自的句柄：启动时异步读回内存，读不到就是 null
// 文件句柄与「当前绑定哪个文件」是两件事；工作区句柄是「上次打开的那个文件夹」，
// 编辑器启动时由 sidebar.js 的 resumeWorkspace 决定是直接进去，还是先摆一条入口等一次点击
let lastPickerHandle = null;      // FileSystemFileHandle | null：上次用过的文件句柄
let lastWorkspaceHandle = null;   // FileSystemDirectoryHandle | null：上次当工作区用的目录句柄

// 打开（或首次建立）句柄库；不支持 IndexedDB 时静默返回 null，记忆功能降级为「不记忆」，不影响正常存取
function openHandleDB() {
  return new Promise(function (resolve) {
    let req;
    try { req = indexedDB.open(FS_DB_NAME, 1); } catch (err) { resolve(null); return; }
    req.onupgradeneeded = function () { req.result.createObjectStore(FS_STORE_NAME); };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { resolve(null); };
  });
}

// 往库里存一个句柄：句柄是可序列化的，能直接存进 IndexedDB
// 写库失败只影响「下次还能不能接着打开」，不影响本次存取，所以静默吞掉
function putStoredHandle(key, handle) {
  return openHandleDB().then(function (db) {
    if (db === null) return;
    db.transaction(FS_STORE_NAME, "readwrite").objectStore(FS_STORE_NAME).put(handle, key);
  }).catch(function () {});
}

// 从库里读一个句柄：不支持、键上没有、读失败三种情形都返回 null，调用方一律按「没记过」处理
function getStoredHandle(key) {
  return openHandleDB().then(function (db) {
    if (db === null) return null;
    return new Promise(function (resolve) {
      const req = db.transaction(FS_STORE_NAME, "readonly").objectStore(FS_STORE_NAME).get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { resolve(null); };
    });
  }).catch(function () { return null; });
}

// 把这次用过的文件句柄记下来：同时更新内存，本次会话马上生效；再写进库，跨会话也能读回
function rememberPickerHandle(handle) {
  lastPickerHandle = handle;
  return putStoredHandle(FS_HANDLE_KEY, handle);
}

// 启动时把上次的文件句柄读回内存：之后选择器要用时直接读内存，不必在点击那一刻再去等异步，用户手势不会被打断
// 返回一个 Promise：调用方可以等它读完再决定下一步（编辑器就是等它读完才去接首页送来的存档）
function loadPickerHandle() {
  return getStoredHandle(FS_HANDLE_KEY).then(function (h) { lastPickerHandle = h || null; });
}

// 把这次选中的工作区文件夹记下来：编辑器下次打开时会试着接着打开它
function rememberWorkspaceHandle(handle) {
  lastWorkspaceHandle = handle;
  return putStoredHandle(FS_WORKSPACE_KEY, handle);
}

// 启动时把上次的工作区句柄读回内存：读完由 sidebar.js 决定是直接打开，还是先摆一条入口等一次点击
function loadWorkspaceHandle() {
  return getStoredHandle(FS_WORKSPACE_KEY).then(function (h) { lastWorkspaceHandle = h || null; });
}

// 忘掉记着的那个工作区：那个文件夹已经被删掉或挪走时用，清掉之后再启动就不会白试一次
// 用删除而不是写一个 null 进去：键上没有东西，与「从来没记过」是同一种情形，读回来天然就是 null
function forgetWorkspaceHandle() {
  lastWorkspaceHandle = null;
  return openHandleDB().then(function (db) {
    if (db === null) return;
    db.transaction(FS_STORE_NAME, "readwrite").objectStore(FS_STORE_NAME).delete(FS_WORKSPACE_KEY);
  }).catch(function () {});
}

// 选择器选项里的起始目录：有记住的句柄就带上，框会从那个文件所在的目录打开；没有就不带，交给浏览器默认
// startIn 接受文件句柄，落在它所在的那个目录，所以不必额外去取父目录句柄
function startInOption() {
  return lastPickerHandle === null ? {} : { startIn: lastPickerHandle };
}
