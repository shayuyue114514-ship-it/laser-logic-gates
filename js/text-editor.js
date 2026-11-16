// text-editor.js：网格视口的三种视图：电路、文本、未打开任何文件。由左侧列表双击哪种文件就切到哪种。
// 状态只活在本文件里，不掺进电路的状态：打开哪个文件、有没有改动、是否正在写盘，与画布互不影响。
"use strict";

/* ========== 状态 ========== */

let teDom = null;        // HTMLElement|null：文本编辑器容器，display 为 block 时表示正显示在网格区上
let teArea = null;       // HTMLTextAreaElement|null：正文输入区
let tePreviewBtn = null; // HTMLButtonElement|null：标题栏里的「预览 / 编辑」切换按钮，只有 .md 文件才露出来
let tePreviewDom = null; // HTMLElement|null：按 Markdown 排版显示的阅读层，与输入区占同一块位置
let teNameDom = null;    // HTMLElement|null：标题栏里的文件名
let teStateDom = null;   // HTMLElement|null：标题栏右边的「未保存 / 已保存 / 保存中」小字
let emptyDom = null;     // HTMLElement|null：未打开任何文件时盖在网格区上的空白层
let teHandle = null;     // FileSystemFileHandle|null：当前编辑的文件句柄，null 表示没打开
let teName = "";         // string：当前文件名（带后缀），只用来显示
let teNode = null;       // object|null：这个文件在左侧列表里的那一行，用来把未保存状态标成与 .lccas 一样的圆点
let teDirty = false;     // boolean：正文自打开后有没有改过，决定切换视图时要不要先问一句
let teSaving = false;    // boolean：一趟保存还没收工（含等待收尾落地），期间再按只排队
let teWriting = false;   // boolean：正文正在交给浏览器写，标题栏靠它显示「保存中…」
let teSaveAgain = false; // boolean：写盘期间又被要求存一次，收尾落地后再补一趟
let teCommit = null;     // Promise<void>|null：最近一趟的收尾（把新内容换到原文件上）还没落地时非空
let teEditSeq = 0;       // number：正文改动序号，写盘时记下，收尾回来时靠它判断期间有没有又改过
let viewMode = "none";   // string：网格区现在显示什么，"none" 空白、"scene" 电路、"text" 文本

/* ========== 建界面 ========== */

// 初始化编辑器与空白层：取节点、接按钮和输入事件，只跑一次
// 输入事件与快捷键都挂在正文区上，不开编辑器时它们不会碰到键盘
function initTextEditorDom() {
  teDom = document.getElementById("textEditor");
  teArea = document.getElementById("textEditorArea");
  tePreviewBtn = document.getElementById("textEditorPreview");
  tePreviewDom = document.getElementById("textEditorPreviewArea");
  tePreviewBtn.style.display = "none";   // 只有 Markdown 文件才需要预览，别的文件先把按钮收起来
  tePreviewBtn.addEventListener("click", function () {
    setTextPreview(!teDom.classList.contains("previewing"));
  });
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
    teEditSeq++;   // 每一次改动都记一笔：写盘收尾回来时靠它判断这份内容之后有没有又变过
    if (!teDirty) {
      teDirty = true;
      refreshTextEditorHead();
      // 列表圆点与电路用同一套：改过就亮起，不必等写盘
      if (teNode !== null) { teNode.dirty = true; paintSidebarDot(teNode); }
    }
  });
  // 编辑器的快捷键：Cmd/Ctrl+S 存盘，Esc 回到「未打开任何文件」的空状态
  // 挂在容器上而不是输入区：预览时输入区是藏着的，焦点在阅读层，按键仍要能冒泡到这里
  // 全局键盘处理在识别到文本框时整段让路，所以这两个键必须在这里自己接
  teDom.addEventListener("keydown", function (e) {
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

/* ========== Markdown 预览 ========== */

// 切到预览或切回编辑：预览时按当前原文重新渲染一遍，然后藏起输入区、露出阅读层
// 阅读层可获焦，这样 Esc 关闭与 Cmd+S 保存仍能冒泡到容器的快捷键处理
function setTextPreview(on) {
  if (teDom === null || tePreviewDom === null) return;
  if (on) {
    renderMarkdownInto(tePreviewDom, teArea.value);   // 内容在切过去的那一刻现取，不会渲染一份旧稿
    teDom.classList.add("previewing");
    tePreviewBtn.textContent = "编辑";
    tePreviewDom.scrollTop = 0;
    tePreviewDom.focus();
  } else {
    teDom.classList.remove("previewing");
    tePreviewBtn.textContent = "预览";
    teArea.focus();
  }
}

// 把 Markdown 原文渲染进容器：先清空再逐块生成，所有文字都走 textContent，不拼 HTML 字符串
// 这样文件里写了什么就原样显示什么，尖括号与脚本也不会被当成标记执行
function renderMarkdownInto(container, src) {
  container.textContent = "";
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 围栏代码块：整段原样放进 pre，内部不再解释任何标记
    if (/^\s*```/.test(line)) {
      i++;
      const buf = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;   // 跳过结束围栏；没有结束围栏时循环自然走到末尾，不额外报错
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = buf.join("\n");
      pre.appendChild(code);
      container.appendChild(pre);
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }   // 空行只用来分段，不生成元素
    // 标题：井号个数决定层级，井号本身在预览里去掉
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head !== null) {
      const h = document.createElement("h" + head[1].length);
      appendMarkdownInline(h, head[2]);
      container.appendChild(h);
      i++;
      continue;
    }
    // 分隔线：三个以上的减号、星号或下划线单独成行
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
      container.appendChild(document.createElement("hr"));
      i++;
      continue;
    }
    // 引用：连续的引用行合成一块，块内换行照样保留
    if (/^\s*>\s?/.test(line)) {
      const quote = document.createElement("blockquote");
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      appendMarkdownInline(quote, buf.join("\n"));
      container.appendChild(quote);
      continue;
    }
    // 列表：连续的同类行合成一个列表；中途变了类型就结束这一块，留给下一轮重新起一个
    const itemHead = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/);
    if (itemHead !== null) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const list = document.createElement(ordered ? "ol" : "ul");
      while (i < lines.length) {
        const m = lines[i].match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)$/);
        if (m === null || /^\s*\d+[.)]\s+/.test(lines[i]) !== ordered) break;
        const li = document.createElement("li");
        appendMarkdownInline(li, m[1]);
        list.appendChild(li);
        i++;
      }
      container.appendChild(list);
      continue;
    }
    // 普通段落：把连续的非块级行收进同一段，段内换行显示为换行
    const buf = [];
    while (i < lines.length && !isMarkdownBlockStart(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    const p = document.createElement("p");
    appendMarkdownInline(p, buf.join("\n"));
    container.appendChild(p);
  }
}

// 这一行是不是会另起一块的写法：标题、围栏、引用、列表、分隔线、空行
// 段落遇到它们就收尾，免得把下一块的内容吸进自己的段落里
function isMarkdownBlockStart(line) {
  return /^\s*$/.test(line) || /^\s*```/.test(line) || /^(#{1,6})\s+/.test(line) ||
    /^\s*>\s?/.test(line) || /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line) ||
    /^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line);
}

// 段内文字：按换行拆开，行与行之间补一个换行元素，再逐行处理行内标记
function appendMarkdownInline(parent, text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) parent.appendChild(document.createElement("br"));
    appendMarkdownInlineLine(parent, lines[i]);
  }
}

// 行内标记：行内代码、加粗、斜体、删除线、链接；认不出的字符原样吐出，绝不吞字
// 每认出一段就整段跳过，避免同一段文字被反复套样式（例如加粗里的星号又被当成斜体）
function appendMarkdownInlineLine(parent, s) {
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m = rest.match(/^`([^`]+)`/);
    if (m !== null) {
      const code = document.createElement("code");
      code.textContent = m[1];
      parent.appendChild(code);
      i += m[0].length;
      continue;
    }
    m = rest.match(/^\*\*([\s\S]+?)\*\*/) || rest.match(/^__([\s\S]+?)__/);
    if (m !== null) {
      const strong = document.createElement("strong");
      appendMarkdownInlineLine(strong, m[1]);
      parent.appendChild(strong);
      i += m[0].length;
      continue;
    }
    m = rest.match(/^~~([\s\S]+?)~~/);
    if (m !== null) {
      const del = document.createElement("del");
      appendMarkdownInlineLine(del, m[1]);
      parent.appendChild(del);
      i += m[0].length;
      continue;
    }
    m = rest.match(/^\*([^*]+)\*/);
    if (m !== null) {
      const em = document.createElement("em");
      appendMarkdownInlineLine(em, m[1]);
      parent.appendChild(em);
      i += m[0].length;
      continue;
    }
    m = rest.match(/^\[([^\]]*)\]\(([^)\s]+)\)/);
    if (m !== null) {
      // 只把 http、https、mailto 做成可点链接，其它写法（如 javascript:）按纯文字显示
      if (/^(https?:|mailto:)/i.test(m[2])) {
        const a = document.createElement("a");
        a.textContent = m[1];
        a.href = m[2];
        a.target = "_blank";
        a.rel = "noopener";
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(m[1] + "（" + m[2] + "）"));
      }
      i += m[0].length;
      continue;
    }
    parent.appendChild(document.createTextNode(s[i]));
    i++;
  }
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
  // 只有 Markdown 才给「预览」按钮：纯文本没有样式可渲染，露出来只会让人白点一下
  tePreviewBtn.style.display = name.toLowerCase().endsWith(".md") ? "flex" : "none";
  teNode = (node === undefined) ? null : node;   // 从列表打开的才有圆点可标；从别处打开就传空
  teDirty = false;
  teSaving = false;
  teWriting = false;
  teSaveAgain = false;
  teEditSeq = 0;
  teArea.value = text;
  refreshTextEditorHead();
  setTextPreview(false);  // 每次打开都从「编辑」开始：新文件第一件事通常是改内容
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
  teWriting = false;
  teSaveAgain = false;
  // 预览态一并收掉：下次打开任何文件都该从编辑开始，不能带着上一次的阅读层与按钮文字
  teDom.classList.remove("previewing");
  if (tePreviewBtn !== null) tePreviewBtn.textContent = "预览";
  if (tePreviewDom !== null) tePreviewDom.textContent = "";
  if (teArea !== null) teArea.value = "";
}

// 关闭请求：正在写盘时先不关；有未保存的改动就先问一句，确认丢弃才回到空白状态
async function requestCloseTextEditor() {
  if (teDom === null || teDom.style.display === "none") return;
  if (teWriting) { showToast("正在保存，请稍候"); return; }   // 只有正文正在写的那一段不能走；收尾在后台时不拦
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
  if (teWriting) { showToast("正在保存，请稍候"); return false; }
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
  // 只有正文真在写的那一段才说「保存中」：收尾在后台，界面不该陪着等
  teStateDom.textContent = teWriting ? "保存中…" : (teDirty ? "未保存" : "已保存");
}

/* ========== 保存 ========== */

// 保存：与电路存档走同一套节奏——同一时刻只跑一趟，晚到的按键最多攒成「补一趟」
// 「成功」的界线也相同：整份正文交给浏览器就算写完，收尾（把新内容换到原文件上）放后台
async function saveTextEditor() {
  if (teDom === null || teDom.style.display === "none") return;
  if (teHandle === null) return;
  if (teSaving) {
    // 上一趟还在走或还在等收尾：记下这一次，等它收工后立刻写最新内容
    teSaveAgain = true;
    console.log("[文本] 已排队：上一趟还没收工，收工后立刻写入最新内容");
    return;
  }
  teSaving = true;
  try {
    for (;;) {
      teSaveAgain = false;                       // 内容在写的那一刻现取，晚到的改动一并带上
      if (!(await writeTextFile())) return;      // 写失败就先收手，不连着刷失败
      const commit = teCommit;
      if (commit !== null) await commit;         // 等收尾落地再考虑下一趟，免得两条流抢同一把锁
      if (teHandle === null) return;             // 期间关掉了编辑器，不再补写
      if (!teSaveAgain) return;
      if (!teDirty) return;                      // 期间没有新的改动，不必再写一遍
    }
  } finally {
    teSaving = false;
  }
}

// 把正文交给浏览器写进当前文件，成功返回 true
// 与电路存档相同：写完就停呼吸、灭未保存标记；收尾挂到 teCommit，失败再把未保存亮回去
async function writeTextFile() {
  // 先记下这一份写的是谁：收尾要几秒，期间可能已经切到别的文件，结果只该记到这一行上
  const node = teNode;
  setNodeSaving(node, true);   // 圆点从这一刻起呼吸，只呼吸到这一趟写完为止
  let stream = null;           // 写流：失败时必须在收尾里丢掉，否则它一直占着文件锁
  try {
    if (!(await ensureWritePermission(teHandle))) {
      console.log("[文本] 没有写入权限，本次保存放弃");
      showToast("没有写入权限，本次保存已放弃");
      return false;
    }
    stream = await teHandle.createWritable();
    const text = teArea.value;
    const editsAtWrite = teEditSeq;   // 这份内容对应到第几次改动，收尾回来时靠它判断期间有没有又改过
    teWriting = true;
    refreshTextEditorHead();
    await stream.write(text);
    // 走到这里整份正文已经写进工作区：呼吸立刻停；仍是同一份、期间没再改动才落「已保存」
    if (node === teNode && teEditSeq === editsAtWrite) teDirty = false;
    teWriting = false;
    setNodeSaving(node, false);
    refreshTextEditorHead();
    if (node !== null) {
      // 圆点只表示「还没保存」：写进工作区就算存好；要不要写出到文件夹另记一笔，与电路同一套
      markUnsynced(node.path);
      node.dirty = false;
      paintSidebarDot(node);
    }
    console.log("[文本] 已写入 " + teName + "（" + text.length + " 字符），收尾在后台进行");
    showToast("已保存");
    // 收尾交给后台：失败就把未保存亮回去，不让界面说谎
    teCommit = stream.close().then(function () {
      console.log("[文本] 收尾完成");
    }).catch(function (err) {
      console.log("[文本] 收尾失败，文件没有换成新的：", err);
      showToast("文件没有写完，请重新保存");
      teDirty = true;
      refreshTextEditorHead();
    }).finally(function () {
      teCommit = null;
    });
    stream = null;   // 已经交给收尾，这里不再负责丢弃它
    return true;
  } catch (err) {
    console.log("[文本] 写入失败：", err);
    showToast("保存失败，请重试");
    return false;
  } finally {
    // 失败时把流丢掉，让文件锁立刻释放；已经关掉的流再 abort 会抛，忽略即可
    if (stream !== null) {
      try { await stream.abort(); } catch (err) { /* 已失效，无需收拾 */ }
    }
    teWriting = false;
    refreshTextEditorHead();
    setNodeSaving(node, false);
  }
}
