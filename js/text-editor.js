// text-editor.js：网格视口的三种视图：电路、文本、未打开任何文件。由左侧列表双击哪种文件就切到哪种。
// 状态只活在本文件里，不掺进电路的状态：打开哪个文件、有没有改动、是否正在写盘，与画布互不影响。
"use strict";

/* ========== 状态 ========== */

let teDom = null;        // HTMLElement|null：文本编辑器容器，display 为 block 时表示正显示在网格区上
let teArea = null;       // HTMLTextAreaElement|null：正文输入区
let teNameDom = null;    // HTMLElement|null：标题栏里的文件名
let teStateDom = null;   // HTMLElement|null：标题栏右边的「未保存 / 已保存 / 保存中」小字
let emptyDom = null;     // HTMLElement|null：未打开任何文件时盖在网格区上的空白层
let teHandle = null;     // FileSystemFileHandle|null：当前编辑的文件句柄，null 表示没打开
let teName = "";         // string：当前文件名（带后缀），只用来显示
let teNode = null;       // object|null：这个文件在左侧列表里的那一行，用来把未保存状态标成与 .lccas 一样的圆点
let teDirty = false;     // boolean：正文自打开后有没有改过，决定切换视图时要不要先问一句
let teSaving = false;    // boolean：是否正在写盘，防止连按保存排出两趟
let viewMode = "none";   // string：网格区现在显示什么，"none" 空白、"scene" 电路、"text" 文本

/* ========== 建界面 ========== */

// 初始化编辑器与空白层：取节点、接按钮和输入事件，只跑一次
// 输入事件与快捷键都挂在正文区上，不开编辑器时它们不会碰到键盘
function initTextEditorDom() {
  teDom = document.getElementById("textEditor");
  teArea = document.getElementById("textEditorArea");
  teNameDom = document.getElementById("textEditorName");
  teStateDom = document.getElementById("textEditorState");
  emptyDom = document.getElementById("emptyView");
  teDom.style.display = "none";   // 显式写成 none：后面几处判断靠这个字符串认「开没开」，不能留空值
  document.getElementById("textEditorSave").addEventListener("click", function () { saveTextEditor(); });
  // 按钮按下时不抢焦点：焦点留在正文区，打下字时不会被按钮截走
  teDom.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains("btn")) e.preventDefault();
  });
  teArea.addEventListener("input", function () {
    if (!teDirty) {
      teDirty = true;
      refreshTextEditorHead();
      // 列表圆点与电路用同一套：改过就亮起，不必等写盘
      if (teNode !== null) { teNode.dirty = true; paintSidebarDot(teNode); }
    }
  });
  // 正文区的快捷键：Cmd/Ctrl+S 存盘，Esc 回到「未打开任何文件」的空状态
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
  // 窗口尺寸变了，网格视口跟着变：哪一层正显示就立刻重新贴合，不跟着变会留出半截网格
  window.addEventListener("resize", function () { placeOverlays(); });
  showEmptyView();   // 启动时还没有打开文件，网格区先摆出空白与那行小字
}

/* ========== 视图切换 ========== */

// 把两张覆盖层都摆到网格视口的位置与大小：与画布的网格区严格重合
function placeOverlays() {
  const vp = getViewport();
  const rects = [[teDom, vp], [emptyDom, vp]];
  for (let i = 0; i < rects.length; i++) {
    rects[i][0].style.left = rects[i][1].x + "px";
    rects[i][0].style.top = rects[i][1].y + "px";
    rects[i][0].style.width = rects[i][1].w + "px";
    rects[i][0].style.height = rects[i][1].h + "px";
  }
}

// 切到电路：两层覆盖都收起，画布连激光一起露出来
function showSceneView() {
  viewMode = "scene";
  teDom.style.display = "none";
  emptyDom.style.display = "none";
}

// 切到空白：收起编辑器，网格区换成白底与「未打开任何文件」那行小字
function showEmptyView() {
  viewMode = "none";
  teDom.style.display = "none";
  hideTextEditor();
  placeOverlays();
  emptyDom.style.display = "flex";
}

// 切到文本：收起空白层，露出编辑器并重新贴合网格区
function showTextEditorView() {
  viewMode = "text";
  emptyDom.style.display = "none";
  placeOverlays();
  teDom.style.display = "block";
}

/* ========== 开关 ========== */

// 双击一个文本文件：读原文、摆上编辑器，然后把焦点交给正文区
// 读失败就只提示、不打开，免得让人对着一个空编辑器以为文件本来就是空的
async function openTextEditor(handle, name, node) {
  if (teDom === null) return;
  if (teDom.style.display !== "none") {
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
  teNode = (node === undefined) ? null : node;   // 从列表打开的才有圆点可标；从别处打开就传空
  teDirty = false;
  teSaving = false;
  teArea.value = text;
  refreshTextEditorHead();
  showTextEditorView();   // 先摆好再露出来，避免先闪一下错误尺寸
  teArea.focus();
  teArea.setSelectionRange(0, 0);   // 光标落在开头，与打开一份文档的直觉一致
  teArea.scrollTop = 0;
}

// 收起编辑器：只改显示状态，文件本身不动
function hideTextEditor() {
  teDom.style.display = "none";
  // 收起时把列表圆点也一并灭掉：这一步只会发生在确认丢弃改动之后
  if (teNode !== null) { teNode.dirty = false; teNode.saving = false; paintSidebarDot(teNode); }
  teNode = null;
  teHandle = null;
  teName = "";
  teDirty = false;
  teSaving = false;
  if (teArea !== null) teArea.value = "";
}

// 关闭请求：正在写盘时先不关；有未保存的改动就先问一句，确认丢弃才回到空白状态
async function requestCloseTextEditor() {
  if (teDom === null || teDom.style.display === "none") return;
  if (teSaving) { showToast("正在保存，请稍候"); return; }
  if (teDirty) {
    const discard = await askConfirm("这份文本还有未保存的改动，确定关闭吗？");
    if (!discard) return;
  }
  hideTextEditor();
  showEmptyView();
}

// 切换到别的文件之前先问一句：编辑器正开着且有改动时，问过才允许切走
// 返回 true 表示可以继续切；返回 false 时保持原样，调用方直接收手
async function leaveTextEditorForSwitch() {
  if (teDom === null || teDom.style.display === "none") return true;
  if (teSaving) { showToast("正在保存，请稍候"); return false; }
  if (!teDirty) { hideTextEditor(); return true; }
  const ok = await askConfirm("这份文本还有未保存的改动，切换后会丢失，确定离开吗？", "离开");
  if (!ok) return false;
  teDirty = false;
  hideTextEditor();
  return true;
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
  if (teDom === null || teDom.style.display === "none") return;
  if (teHandle === null) return;
  if (teSaving) return;
  teSaving = true;
  refreshTextEditorHead();
  if (teNode !== null) setNodeSaving(teNode, true);   // 圆点原地呼吸，和存档写盘时一样
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
    // 写进工作区只等于本地存好：还没写回文件夹，圆点继续亮着，与电路那条规矩一致
    if (teNode !== null) {
      markUnsynced(teNode.path);
      teNode.dirty = true;
      paintSidebarDot(teNode);
    }
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
    if (teNode !== null) setNodeSaving(teNode, false);
  }
}
