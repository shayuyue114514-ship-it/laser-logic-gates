// text-editor.js：提醒文本编辑器：双击工作区里的 .txt / .md 文件时盖一层编辑器，直接改原文。
// 状态只活在本文件里，不掺进电路的状态：打开哪个文件、有没有改动、是否正在写盘，与画布互不影响。
"use strict";

/* ========== 状态 ========== */

let teDom = null;        // HTMLElement|null：整层编辑器容器，display 为 flex 时表示正开着
let teArea = null;       // HTMLTextAreaElement|null：正文输入区
let teNameDom = null;    // HTMLElement|null：标题栏里的文件名
let teStateDom = null;   // HTMLElement|null：标题栏右边的「未保存 / 已保存 / 保存中」小字
let teHandle = null;     // FileSystemFileHandle|null：当前编辑的文件句柄，null 表示没打开
let teName = "";         // string：当前文件名（带后缀），只用来显示
let teDirty = false;     // boolean：正文自打开后有没有改过，决定关闭时要不要先问一句
let teSaving = false;    // boolean：是否正在写盘，防止连按保存排出两趟

/* ========== 建界面 ========== */

// 初始化编辑器：取节点、接按钮和输入事件，只跑一次
// 输入事件与快捷键都挂在正文区上，不开编辑器时它们不会碰到键盘
function initTextEditorDom() {
  teDom = document.getElementById("textEditor");
  teArea = document.getElementById("textEditorArea");
  teNameDom = document.getElementById("textEditorName");
  teStateDom = document.getElementById("textEditorState");
  document.getElementById("textEditorSave").addEventListener("click", function () { saveTextEditor(); });
  document.getElementById("textEditorClose").addEventListener("click", function () { requestCloseTextEditor(); });
  // 按钮按下时不抢焦点：焦点留在正文区，关掉后接着打字不会被按钮截走
  teDom.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains("btn")) e.preventDefault();
  });
  teArea.addEventListener("input", function () {
    if (!teDirty) { teDirty = true; refreshTextEditorHead(); }
  });
  // 正文区的快捷键：Cmd/Ctrl+S 存盘，Esc 走与关闭按钮同一套「有改动先问一句」的流程
  // 全局键盘处理在识别到文本框时整段让路，所以这两个键必须在这里自己接
  teArea.addEventListener("keydown", function (e) {
    if (e.code === "KeyS" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveTextEditor();
    } else if (e.code === "Escape") {
      e.preventDefault();
      requestCloseTextEditor();
    }
  });
}

/* ========== 开关 ========== */

// 双击一个文本文件：读原文、摆上编辑器，然后把焦点交给正文区
// 读失败就只提示、不打开，免得让人对着一个空编辑器以为文件本来就是空的
async function openTextEditor(handle, name) {
  if (teDom === null) return;
  if (teDom.style.display === "flex") {
    if (teHandle === handle) { teArea.focus(); return; }
    showToast("请先关闭当前文本编辑器");
    return;
  }
  let text = "";
  try {
    const file = await handle.getFile();
    text = await file.text();
  } catch (err) {
    console.log("[文本] 读取失败：", err);
    showToast("读取文本失败，请重试");
    return;
  }
  teHandle = handle;
  teName = name;
  teDirty = false;
  teSaving = false;
  teArea.value = text;
  refreshTextEditorHead();
  teDom.style.display = "flex";
  teArea.focus();
  teArea.setSelectionRange(0, 0);   // 光标落在开头，与打开一份文档的直觉一致
  teArea.scrollTop = 0;
}

// 收起编辑器：只改显示状态，文件本身不动
function hideTextEditor() {
  teDom.style.display = "none";
  teHandle = null;
  teName = "";
  teDirty = false;
  teSaving = false;
  teArea.value = "";
}

// 关闭请求：正在写盘时先不关；有未保存的改动就先问一句，确认丢弃才收起
async function requestCloseTextEditor() {
  if (teDom === null || teDom.style.display !== "flex") return;
  if (teSaving) { showToast("正在保存，请稍候"); return; }
  if (teDirty) {
    const discard = await askConfirm("这份文本还有未保存的改动，确定关闭吗？");
    if (!discard) return;
  }
  hideTextEditor();
}

/* ========== 标题栏 ========== */

// 刷新标题栏：文件名后有改动就带一个星号，右边写出当前是未保存、保存中还是已保存
function refreshTextEditorHead() {
  teNameDom.textContent = teName + (teDirty ? " *" : "");
  teStateDom.textContent = teSaving ? "保存中…" : (teDirty ? "未保存" : "已保存");
}

/* ========== 保存 ========== */

// 把正文写回文件：先确认写权限，再开写流一次性写完整份文本
// 文本文件都很小，不必像存档那样把收尾放到后台；这里等它写完再落「已保存」，结果更直观
async function saveTextEditor() {
  if (teDom === null || teDom.style.display !== "flex") return;
  if (teHandle === null) return;
  if (teSaving) return;
  teSaving = true;
  refreshTextEditorHead();
  let stream = null;
  try {
    if (!(await ensureWritePermission(teHandle))) {
      console.log("[文本] 没有写入权限，本次保存放弃");
      showToast("没有写入权限，本次保存已放弃");
      return;
    }
    const text = teArea.value;
    stream = await teHandle.createWritable();
    await stream.write(text);
    await stream.close();
    stream = null;
    teDirty = false;
    console.log("[文本] 已写入 " + teName + "（" + text.length + " 字符）");
    showToast("已保存");
  } catch (err) {
    console.log("[文本] 写入失败：", err);
    showToast("保存失败，请重试");
  } finally {
    // 失败时把流丢掉，尽快释放文件锁；已经关掉的流再 abort 会抛，忽略即可
    if (stream !== null) {
      try { await stream.abort(); } catch (err) { /* 已失效，无需收拾 */ }
    }
    teSaving = false;
    refreshTextEditorHead();
  }
}
