// files.js：文件读写与剪贴板：打开、保存、另存为、选区导入导出、复制粘贴。
"use strict";

// 把当前文件名写进弹窗：还没存过时用占位名，后缀始终带着，让人知道存出来会叫什么
function refreshFileName() {
  fileNameDom.textContent = currentFileName || ("未命名" + SAVE_EXT);
}

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

// 把这次用过的文件句柄记下来：同时更新内存，本次会话马上生效；再写进库，跨会话也能读回
// 句柄是可序列化的，能直接存进 IndexedDB；写库失败只影响下次的起始目录，不影响本次存取，所以静默吞掉
function rememberPickerHandle(handle) {
  lastPickerHandle = handle;
  openHandleDB().then(function (db) {
    if (db === null) return;
    db.transaction(FS_STORE_NAME, "readwrite").objectStore(FS_STORE_NAME).put(handle, FS_HANDLE_KEY);
  }).catch(function () {});
}

// 启动时把上次的句柄读回内存：之后选择器要用时直接读内存，不必在点击那一刻再去等异步，用户手势不会被打断
function loadPickerHandle() {
  openHandleDB().then(function (db) {
    if (db === null) return null;
    return new Promise(function (resolve) {
      const req = db.transaction(FS_STORE_NAME, "readonly").objectStore(FS_STORE_NAME).get(FS_HANDLE_KEY);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { resolve(null); };
    });
  }).then(function (h) { lastPickerHandle = h || null; }).catch(function () {});
}

// 选择器选项里的起始目录：有记住的句柄就带上，框会从那个文件所在的目录打开；没有就不带，交给浏览器默认
// startIn 接受文件句柄，落在它所在的那个目录，所以不必额外去取父目录句柄
function startInOption() {
  return lastPickerHandle === null ? {} : { startIn: lastPickerHandle };
}

// 打开：选一个存档读进画面
// 顺序是「先全部读完并校验通过，再动画面」：任何一步失败都原样返回，正在编的电路不会被毁掉
async function onOpenFile() {
  if (!canUseLocalFile) { console.log("[文件] 当前浏览器不支持直接读文件"); return; }
  let handle;
  try {
    const handles = await window.showOpenFilePicker(Object.assign({ multiple: false, types: SAVE_FILE_TYPES }, startInOption()));
    handle = handles[0];   // 只允许选一个，返回的数组里必定有且只有一项
  } catch (err) {
    // 取消同样不是错误，静默收场
    if (err.name !== "AbortError") console.log("[文件] 打开框出错：", err);
    return;
  }
  rememberPickerHandle(handle);  // 记住这次所在的目录，下次打开框直接从这儿起步
  stashCurrentScene();  // 先把手上这份没保存的改动收起来，再换文档，否则它会被新读进来的内容顶掉
  if (await openFromHandle(handle)) openFileNode = null;  // 从系统文件框打开的，列表里没有对应行，标记无处可标
}

// 把当前这一份画面收进它所绑的那条存档里，只在它真有未保存的改动时才收
// 收的是内存里的快照（与存档同一个结构），不碰磁盘：目的是让「切走再切回来」还能拿回这份改动，
// 否则一切走，它就被磁盘上那份旧存档永久盖掉了
function stashCurrentScene() {
  if (openFileNode === null || !docDirty) return;
  openFileNode.scene = serializeScene();
}

// 一份已经校验过的存档落到画面上，并把「当前文件」绑到它的句柄上，成功返回 true
// 「从磁盘读出来再打开」与「把这次会话里存下的那份改动摆回来」两条路共用它，收尾才不会各写一套
function adoptScene(handle, parsed) {
  if (!parsed.ok) { console.log("[文件] " + handle.name + "：" + parsed.reason); return false; }
  applyScene(parsed);
  // 确认用上了才改绑定：读失败时「当前文件」仍指向原来那个，不会显示成刚选的坏文件
  currentFileHandle = handle;
  currentFileName = handle.name;
  refreshFileName();
  console.log("[文件] 已打开 " + currentFileName +
    (parsed.skipped.length ? "，跳过 " + parsed.skipped.length + " 条坏数据" : ""));
  return true;
}

// 把一个已知句柄的存档从磁盘读进画面，成功返回 true
// 「文件」按钮选完文件后走这里，竖栏列表里双击某一条也走这里，两条路的读入、校验与收尾完全一致
// 顺序是「先全部读完并校验通过，再动画面」：任何一步失败都原样返回，正在编的电路不会被毁掉
async function openFromHandle(handle) {
  let text;
  try {
    const file = await handle.getFile();
    text = await file.text();
  } catch (err) {
    console.log("[文件] 读取 " + handle.name + " 失败：", err);
    return false;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.log("[文件] " + handle.name + " 不是本程序的存档：内容不是合法的 JSON");
    return false;
  }
  return adoptScene(handle, parseScene(raw));
}

// 另存为：弹保存框挑一个新文件，把当前电路写进去，并把它记为当前文件
async function onSaveFileAs() {
  if (!canUseLocalFile) { console.log("[文件] 当前浏览器不支持直接写文件"); return; }
  let handle;
  const t0 = performance.now();   // 保存框自己也可能要等：这一段单独计时，好与写盘那几段分开看
  try {
    handle = await window.showSaveFilePicker(Object.assign({
      suggestedName: currentFileName || ("未命名" + SAVE_EXT),
      types: SAVE_FILE_TYPES
    }, startInOption()));
  } catch (err) {
    // 用户按取消不是错误，静默收场；其它错误才报出来，免得一次取消就弹一堆提示
    if (err.name !== "AbortError") console.log("[文件] 保存框出错：", err);
    return;
  }
  console.log("[文件] 保存框用时 " + Math.round(performance.now() - t0) + " ms");
  rememberPickerHandle(handle);  // 记住这次所在的目录，下次保存框直接从这儿起步
  // 名字和句柄一起记：两者说的都是「现在绑在哪个文件上」，要改就一起改，不能只改一个
  currentFileHandle = handle;
  currentFileName = handle.name;
  refreshFileName();
  if (await writeCurrentFile()) console.log("[文件] 已另存为 " + currentFileName);
}

// 保存：写回当前文件；还没绑定过文件就退化成另存为，让「保存」永远有结果，不必先去点另存为
async function onSaveFile() {
  // 起手先记一行：这条路上若有几秒的迟滞，靠它才能分清是「按键没能及时进来」还是「写盘那几步慢」
  // 这一行是同步打出来的，它出现得晚，就说明问题在它之前，与下面几段无关
  console.log("[文件] 保存开始：" + (currentFileHandle === null ? "尚未绑定文件，转另存为" : currentFileName));
  if (currentFileHandle === null) { await onSaveFileAs(); return; }
  if (await writeCurrentFile()) console.log("[文件] 已保存到 " + currentFileName);
}

// 把当前电路写进当前文件，成功返回 true
// 写入期间改的是临时文件，关流那一下才真正替换原文件，所以中途出错不会把旧存档毁掉
async function writeCurrentFile() {
  const t0 = performance.now();
  // 先记下这一份写的是谁：写盘那一下可能要好几秒，期间用户可能已经切到别的存档上去了，
  // 收尾时只认这个节点，结果才不会记到别人头上（否则会把刚切过去那一份的未保存标记错误地灭掉）
  const node = openFileNode;
  setNodeSaving(node, true);   // 圆点从这一刻起开始呼吸：让人看出这几秒是在等写盘，不是在发呆
  try {
    const stream = await currentFileHandle.createWritable();
    const t1 = performance.now();
    await stream.write(JSON.stringify(serializeScene(), null, 2));  // 缩进两格：存档是给人看的，手工改也方便
    const t2 = performance.now();
    await stream.close();
    const t3 = performance.now();
    // 真写进去了才算数：关流成功之后，画面与文件一致，未保存的标记在这里灭掉
    // 只在「这个文件仍是当前文件」时才动这些状态：中途切走了，那份结果就不该拿去改别人
    if (openFileNode === node) {
      docDirty = false;
      // 顺手丢掉内存里那份旧快照：内容已经进磁盘了，留着它只会让下次切回来摆出一个过期的画面
      if (node !== null) node.scene = null;
    }
    // 分段耗时：慢在开流、写入、还是关流提交，一眼能看出来；正常都是几毫秒
    // 计时用 performance.now()，与主循环里的耗时读数同一套口径
    console.log("[文件] 写盘分段：开流 " + Math.round(t1 - t0) + " ms，写入 " + Math.round(t2 - t1) +
      " ms，提交 " + Math.round(t3 - t2) + " ms");
    return true;
  } catch (err) {
    console.log("[文件] 写入失败：", err);
    return false;
  } finally {
    // 无论写成没写成，呼吸都要停下来；写失败时圆点仍旧亮着，改动还在，等下次再存
    setNodeSaving(node, false);
  }
}

// 视野中心所在的格心：整批元件没有别的落点参考时，用它当目标
function viewCenterCell() {
  const vp = getViewport();
  return {
    cx: cellCenterX(screenToWorldX(vp.x + vp.w / 2)),
    cy: cellCenterY(screenToWorldY(vp.y + vp.h / 2))
  };
}

// 把一批「已校验的元件记录」作为悬空选区加进画面：整批保持相对位置，包围盒中心吸附到指定格心
// 偏移取两个格心之差，必是整数格，所以元件之间的相对位置一格不差地保留下来
// 「以选区导入」与「粘贴」共用它，两者的差别只在目标格心怎么定，落位、选中、置顶这些收尾完全一致
// 返回实际加进画面的元件个数
function addRecordsAsSelection(records, targetCX, targetCY) {
  let minWx = Infinity, maxWx = -Infinity, minWy = Infinity, maxWy = -Infinity;
  for (let i = 0; i < records.length; i++) {
    const e = records[i];
    if (e.wx < minWx) minWx = e.wx;
    if (e.wx > maxWx) maxWx = e.wx;
    if (e.wy < minWy) minWy = e.wy;
    if (e.wy > maxWy) maxWy = e.wy;
  }
  const offX = targetCX - cellCenterX((minWx + maxWx) / 2);
  const offY = targetCY - cellCenterY((minWy + maxWy) / 2);

  // 逐个放进画面，先不管选中状态；光源开关按记录还原
  const added = [];
  for (let i = 0; i < records.length; i++) {
    const e = records[i];
    const el = placeElement(e.wx + offX, e.wy + offY, e.dir, e.typeId);
    el.on = e.on;
    added.push(el);
  }
  // 走选区总入口：这一批成为新的选中集合，原来那批选中在这里落地（落点上的普通元件照旧被顶掉）
  // 复用总入口而不是自己挨个置选中，是为了让落位、置顶、朝向归零这些收尾行为和手动框选完全一致
  applySelection(function (e) { return added.indexOf(e) >= 0; }, false);
  // 切到选中工具：只有在这个工具下，画布上的拖动才是「整批搬走」
  setSelectedSlot(SELECT_SLOT_INDEX);
  return added.length;
}

// 以选区导入：选一个存档，把里面的元件作为一批悬空选区加进当前画面
// 与「打开」的区别：不替换当前画面，也不改「当前文件」的绑定，只是往现有电路上再添一批元件
// 落点规则：整批保持相对位置不变，把这一批的包围盒中心挪到当前视野中央
async function onImportSelection() {
  if (!canUseLocalFile) { console.log("[文件] 当前浏览器不支持直接读文件"); return; }
  let handle;
  try {
    const handles = await window.showOpenFilePicker(Object.assign({ multiple: false, types: SAVE_FILE_TYPES }, startInOption()));
    handle = handles[0];   // 只允许选一个，返回的数组里必定有且只有一项
  } catch (err) {
    // 取消同样不是错误，静默收场
    if (err.name !== "AbortError") console.log("[文件] 导入框出错：", err);
    return;
  }
  rememberPickerHandle(handle);  // 记住这次所在的目录，下次导入框直接从这儿起步
  let text;
  try {
    const file = await handle.getFile();
    text = await file.text();
  } catch (err) {
    console.log("[文件] 读取失败：", err);
    return;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.log("[文件] 不是本程序的存档：内容不是合法的 JSON");
    return;
  }
  const parsed = parseScene(raw);
  if (!parsed.ok) { console.log("[文件] " + parsed.reason); return; }   // 整份不可用就整个放弃
  if (parsed.elements.length === 0) { console.log("[文件] " + handle.name + " 里没有可导入的元件"); return; }

  const target = viewCenterCell();
  const n = addRecordsAsSelection(parsed.elements, target.cx, target.cy);
  console.log("[文件] 已从 " + handle.name + " 导入 " + n + " 个元件作为选区" +
    (parsed.skipped.length ? "，跳过 " + parsed.skipped.length + " 条坏数据" : ""));
}

// 以选区导出：把当前选区单独存成一个存档文件，结构与整份存档一致，只是不含视野
// 与「另存为」的区别：导出的是一份新文件，不替换画面、也不改「当前文件」的绑定，当前编辑的还是原来那个
async function onExportSelection() {
  const payload = serializeSelection();
  if (payload.elements.length === 0) { console.log("[文件] 没有选区，没东西可导出"); return; }
  if (!canUseLocalFile) { console.log("[文件] 当前浏览器不支持直接写文件"); return; }
  let handle;
  try {
    // 默认名字跟着当前存档走，加个「-选区」后缀，连续导几个不同选区时不会互相覆盖
    const base = currentFileName ? currentFileName.replace(/\.lccas$/i, "") : "未命名";
    handle = await window.showSaveFilePicker(Object.assign({
      suggestedName: base + "-选区" + SAVE_EXT,
      types: SAVE_FILE_TYPES
    }, startInOption()));
  } catch (err) {
    // 用户按取消不是错误，静默收场；其它错误才报出来，免得一次取消就弹一堆提示
    if (err.name !== "AbortError") console.log("[文件] 保存框出错：", err);
    return;
  }
  rememberPickerHandle(handle);  // 记住这次所在的目录，下次导出框直接从这儿起步
  try {
    const stream = await handle.createWritable();
    await stream.write(JSON.stringify(payload, null, 2));  // 与整份存档同样缩进两格，导出的文件也是给人看的
    await stream.close();
    console.log("[文件] 已把 " + payload.elements.length + " 个元件导出到 " + handle.name);
  } catch (err) {
    console.log("[文件] 写入失败：", err);
  }
}

/* ========== 剪贴板（复制选区 / 粘贴） ========== */

// 序列化当前选区，作为剪贴板里的内容：结构与存档一致，只是不带视野——粘贴时落在哪由那时的指针决定
// 与存档的差别只有一条：存档不收悬空的元件，而剪贴板要的恰恰就是这批悬空的元件
function serializeSelection() {
  const list = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el.selected || el.deleting) continue;
    list.push(elementToRecord(el));
  }
  return { format: "laser-gate", version: 1, elements: list };
}

// 复制选区到系统剪贴板：内容是一段纯文本 JSON，与存档同格式，所以粘进文本编辑器也能直接读
// 写剪贴板要用系统的接口，用户按下的那一下就是「用户手势」，浏览器不会拦
async function copySelection() {
  const payload = serializeSelection();
  if (payload.elements.length === 0) { console.log("[剪贴板] 没有选区，没东西可复制"); return; }
  if (!canUseClipboard) { console.log("[剪贴板] 当前环境不支持写剪贴板"); return; }
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    console.log("[剪贴板] 已复制 " + payload.elements.length + " 个元件");
  } catch (err) {
    console.log("[剪贴板] 写入失败：", err);
  }
}

// 粘贴：把剪贴板里的文本解析成元件记录，作为一批悬空选区加进画面
// 必须走系统的粘贴事件，而不是去调「读剪贴板」的接口：那个接口要授权，在本地文件下不可靠；
// 粘贴事件是浏览器主动把内容递过来，不需要任何授权
// 剪贴板里不是本程序的内容就静默忽略，不去动画面
function onPaste(e) {
  const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
  if (!text) return;   // 剪贴板里没有文本：不认领，交给浏览器按默认处理
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.log("[剪贴板] 剪贴板里的内容不是本程序的元件，已忽略");
    return;
  }
  const parsed = parseScene(raw);
  if (!parsed.ok) { console.log("[剪贴板] " + parsed.reason + "，已忽略"); return; }
  if (parsed.elements.length === 0) { console.log("[剪贴板] 剪贴板里没有可粘贴的元件"); return; }
  e.preventDefault();   // 确认要用了才拦默认行为，用不上时留给浏览器自己处理
  // 落点：指针在画布内就以指针所在格为中心，指针不在就退回视野中心
  const target = pointerInside
    ? { cx: cellCenterX(screenToWorldX(pointerSX)), cy: cellCenterY(screenToWorldY(pointerSY)) }
    : viewCenterCell();
  const n = addRecordsAsSelection(parsed.elements, target.cx, target.cy);
  console.log("[剪贴板] 已粘贴 " + n + " 个元件" +
    (parsed.skipped.length ? "，跳过 " + parsed.skipped.length + " 条坏数据" : ""));
}

