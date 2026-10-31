// files.js：文件读写与剪贴板：打开、保存、另存为、选区导入导出、复制粘贴。
"use strict";

// 打开句柄库、记住句柄、读回句柄、起始目录这四件事都在 handle-store.js：
// 它们是编辑器与首页共用的，首页不加载本文件，所以不能留在这里；本文件按名字直接调用即可

/* ========== 从首页接过来的存档 ========== */

// 接着首页刚选好的那份存档打开：只在这两样同时成立时才动手——地址带着标记，且暂存里真有内容
// 「打开」的系统文件框只允许在用户刚点过东西的那一刻调用，所以首页读完文件只能先跳过来，由这里把内容接上
// 检查放在初始化的最后（main.js 里那一句），此时画布、元件层、各面板都已就绪，铺存档不会被后面的步骤冲掉
async function resumePendingScene() {
  if (location.hash !== HANDOFF_MARK) return;   // 不是从首页跳来的，一切照常，不动画面
  // 标记用过就抹掉：不清的话刷新一次会再导入一遍，把用户之后的编辑整个顶掉
  history.replaceState(null, "", location.pathname + location.search);
  const text = sessionStorage.getItem(HANDOFF_KEY);
  sessionStorage.removeItem(HANDOFF_KEY);   // 同样取完即清：暂存只负责这一次交接，不留到下一次
  if (text === null) return;                // 只有标记没有内容（比如用户手工敲的地址）：静默退回普通启动
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.log("[文件] 从首页带来的内容不是合法 JSON，已忽略");
    showToast("首页带来的文件不是本程序的存档，已忽略");
    return;
  }
  const parsed = parseScene(raw);
  if (!parsed.ok) { console.log("[文件] 从首页带来的存档不可用：" + parsed.reason); showToast("存档无法打开：" + parsed.reason); return; }
  applyScene(parsed);
  showSceneView();   // 从首页接过来的存档也算打开了文件，网格区切成画布
  // 句柄：首页已经把它写进同一个库、同一个键，上一句读完的 lastPickerHandle 就是刚选的那个文件
  // 这里把它接成「当前文件」，之后点保存仍然直接写回原文件，不必再去选一次
  if (lastPickerHandle !== null) {
    S.currentFileHandle = lastPickerHandle;
    S.currentFileName = lastPickerHandle.name;
  }
  console.log("[文件] 已接着打开 " + (S.currentFileName || "未命名") +
    (parsed.skipped.length ? "，跳过 " + parsed.skipped.length + " 条坏数据" : ""));
}

// 打开：选一个存档读进画面
// 顺序是「先全部读完并校验通过，再动画面」：任何一步失败都原样返回，正在编的电路不会被毁掉
async function onOpenFile() {
  if (!canUseLocalFile) { console.log("[文件] 当前浏览器不支持直接读文件"); showToast("当前浏览器不支持读取本地文件"); return; }
  let handle;
  try {
    // 打开框不带类型过滤：过滤规则由系统按文件类型判定，曾出现本程序后缀的文件在框里选不到的情形
    // 能不能用不靠后缀把关，而是由读进来之后的内容校验决定，所以这里不传 types
    const handles = await window.showOpenFilePicker(Object.assign({ multiple: false }, startInOption()));
    handle = handles[0];   // 只允许选一个，返回的数组里必定有且只有一项
  } catch (err) {
    // 取消同样不是错误，静默收场
    if (err.name !== "AbortError") { console.log("[文件] 打开框出错：", err); showToast("打开文件失败，请重试"); }
    return;
  }
  rememberPickerHandle(handle);  // 记住这次所在的目录，下次打开框直接从这儿起步
  stashCurrentScene();  // 先把手上这份没保存的改动收起来，再换文档，否则它会被新读进来的内容顶掉
  if (await openFromHandle(handle)) S.openFileNode = null;  // 从系统文件框打开的，列表里没有对应行，标记无处可标
}

// 把当前这一份画面收进它所绑的那条存档里，只在它真有未保存的改动时才收
// 收的是内存里的快照（与存档同一个结构），不碰磁盘：目的是让「切走再切回来」还能拿回这份改动，
// 否则一切走，它就被磁盘上那份旧存档永久盖掉了
function stashCurrentScene() {
  if (S.openFileNode === null || !S.docDirty) return;
  S.openFileNode.scene = serializeScene();
}

// 一份已经校验过的存档落到画面上，并把「当前文件」绑到它的句柄上，成功返回 true
// 「从磁盘读出来再打开」与「把这次会话里存下的那份改动摆回来」两条路共用它，收尾才不会各写一套
function adoptScene(handle, parsed) {
  if (!parsed.ok) { console.log("[文件] " + handle.name + "：" + parsed.reason); showToast("「" + handle.name + "」无法打开：" + parsed.reason); return false; }
  applyScene(parsed);
  // 确认用上了才改绑定：读失败时「当前文件」仍指向原来那个，不会显示成刚选的坏文件
  S.currentFileHandle = handle;
  S.currentFileName = handle.name;
  showSceneView();   // 存档读进来了，网格区露出画布，把空白层与文本编辑器收起来
  console.log("[文件] 已打开 " + S.currentFileName +
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
    showToast("读取「" + handle.name + "」失败，请重试");
    return false;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.log("[文件] " + handle.name + " 不是本程序的存档：内容不是合法的 JSON");
    showToast("「" + handle.name + "」不是本程序的存档");
    return false;
  }
  return adoptScene(handle, parseScene(raw));
}

// 另存为：弹保存框挑一个新文件，把当前电路写进去，并把它记为当前文件
async function onSaveFileAs() {
  if (!canUseLocalFile) { console.log("[文件] 当前浏览器不支持直接写文件"); showToast("当前浏览器不支持写入本地文件"); return; }
  // 悬空的元件不进存档：这时存出去会得到一份少了这批元件的文件，先拦下并提示用户落位
  if (selectionHeld()) { showToast("选区尚未落位，无法保存"); return; }
  let handle;
  const t0 = performance.now();   // 保存框自己也可能要等：这一段单独计时，好与写盘那几段分开看
  try {
    handle = await window.showSaveFilePicker(Object.assign({
      suggestedName: S.currentFileName || ("未命名" + SAVE_EXT),
      types: SAVE_FILE_TYPES
    }, startInOption()));
  } catch (err) {
    // 用户按取消不是错误，静默收场；其它错误才报出来，免得一次取消就弹一堆提示
    if (err.name !== "AbortError") { console.log("[文件] 保存框出错：", err); showToast("保存文件失败，请重试"); }
    return;
  }
  console.log("[文件] 保存框用时 " + Math.round(performance.now() - t0) + " ms");
  rememberPickerHandle(handle);  // 记住这次所在的目录，下次保存框直接从这儿起步
  // 名字和句柄一起记：两者说的都是「现在绑在哪个文件上」，要改就一起改，不能只改一个
  S.currentFileHandle = handle;
  S.currentFileName = handle.name;
  await runSave();
}

// 保存：写回当前文件；还没绑定过文件就退化成另存为，让「保存」永远有结果，不必先去点另存为
async function onSaveFile() {
  if (selectionHeld()) { showToast("选区尚未落位，无法保存"); return; }   // 与另存为同一条规矩：先落位再存
  // 起手先记一行：这条路上若有几秒的迟滞，靠它才能分清是「按键没能及时进来」还是「写盘那几步慢」
  // 这一行是同步打出来的，它出现得晚，就说明问题在它之前，与下面几段无关
  console.log("[文件] 保存开始：" + (S.currentFileHandle === null ? "尚未绑定文件，转另存为" : S.currentFileName));
  if (S.currentFileHandle === null) { await onSaveFileAs(); return; }
  await runSave();
}

let savingNow = false;    // boolean：已经有一趟写盘在路上
let saveAgain = false;    // boolean：写盘期间又被要求存一次，收尾再补一趟
let pendingCommit = null; // Promise<void>|null：最近一趟保存的收尾（系统把新内容换到原文件上）还没落地时非空

// 同一时刻只允许一趟写盘
// 两趟并发时，第二趟的 createWritable 要等第一趟关掉文件锁，那段等待全落在圆点的呼吸上，
// 看起来就是「保存很久」；攒成「最多补一趟」也够，因为晚到的那次按的是同一份内容
async function runSave() {
  if (savingNow) {
    // 上一趟还在收尾：收尾一旦开始就中断不了——写流进入 closing 之后 abort() 只会被拒绝，
    // 文件锁也由浏览器握着，页面没有接口让它提前放手；就算能打断，也得从头再写一遍，总时长不会更短
    // 能做的只是记下这一次，等它落地立刻写最新内容；打出这一行，免得按下去像没反应
    saveAgain = true;
    console.log("[文件] 已排队：上一趟收尾还没落地，落地后立刻写入最新内容");
    return;
  }
  savingNow = true;
  try {
    for (;;) {
      saveAgain = false;                          // 内容在写的那一刻现取，晚到的改动一并带上
      if (!(await writeCurrentFile())) return;    // 写失败就先收手，不连着刷失败
      // 等这一趟的收尾落地再考虑下一趟：同时开两条流会抢同一把文件锁，反而更慢
      // 界面不等它：未保存的标记在上一步就灭了，这里只是队列里的一道闸
      const commit = pendingCommit;
      if (commit !== null) await commit;
      if (!saveAgain) return;                     // 期间没人再按，收工
      if (!S.docDirty) return;                      // 期间没有新的改动，不必再写一遍
    }
  } finally {
    savingNow = false;
  }
}

// 确认这份句柄还带着写权限；没有就当场申请一次
// 必须在这里问：申请授权要求一个真实的用户手势，而这段时间里唯一的手势就是按下保存的那一下
// 若拖到 createWritable 里去弹，等待会整段落进圆点的呼吸里，看上去像是写盘慢
async function ensureWritePermission(handle) {
  if (handle.queryPermission === undefined || handle.requestPermission === undefined) return true;  // 老浏览器没有这套接口，交给 createWritable 去要求
  const opts = { mode: "readwrite" };
  try {
    if (await handle.queryPermission(opts) === "granted") return true;   // 还带着权限，直接放行，不弹任何东西
    return await handle.requestPermission(opts) === "granted";
  } catch (err) {
    console.log("[文件] 权限检查出错：", err);
    return false;
  }
}

// 把当前电路交给浏览器写进当前文件，成功返回 true
// 「成功」指整份内容已经交给浏览器，不包括它把临时文件换到原文件上的那一下
// 那一下在本机实测要 7 秒左右：磁盘实测 0.4～22 毫秒，断网照旧，也没装扩展，是 Chrome 自己的提交流程
// 界面不该陪它等：未保存的标记与圆点的呼吸都在写完之后立刻收，收尾放后台，见 pendingCommit
async function writeCurrentFile() {
  const t0 = performance.now();
  // 先记下这一份写的是谁：收尾要好几秒，期间用户可能已经切到别的存档上去了，
  // 收尾回来时只认这个节点，结果才不会记到别人头上
  const node = S.openFileNode;
  setNodeSaving(node, true);   // 圆点从这一刻起开始呼吸，但它只呼吸到这一趟写完为止
  let stream = null;   // 写流：写失败时必须在收尾里丢掉，否则它一直占着文件锁
  try {
    if (!(await ensureWritePermission(S.currentFileHandle))) {
      console.log("[文件] 没有写权限，本次保存放弃");
      showToast("没有写入权限，本次保存已放弃");
      return false;
    }
    stream = await S.currentFileHandle.createWritable();
    const t1 = performance.now();
    const text = JSON.stringify(serializeScene());  // 不缩进：存档是给程序读的，缩进只是把文件撑大，没有别的好处
    const editsAtWrite = S.docEditSeq;   // 这份内容对应到第几次改动，收尾回来时靠它判断期间有没有又改过
    await stream.write(text);
    const t2 = performance.now();
    // 走到这里整份内容已经在浏览器手里，界面上就算存好了：呼吸立刻停，未保存的标记立刻灭
    // 后面那几秒只是系统把临时文件换到原文件上，不该让圆点一直呼吸，也不该让人以为还没存
    if (S.openFileNode === node && S.docEditSeq === editsAtWrite) S.docDirty = false;
    setNodeSaving(node, false);
    console.log("[文件] 已写入 " + S.currentFileName + "（" + text.length + " 字节，开流 " + Math.round(t1 - t0) +
      " ms，写入 " + Math.round(t2 - t1) + " ms），收尾在后台进行");
    // 收尾交给后台：成功才丢掉内存里那份旧快照；失败就把未保存亮回去，不让界面说谎
    pendingCommit = stream.close().then(function () {
      if (node !== null && S.openFileNode === node) node.scene = null;
      console.log("[文件] 收尾完成：" + Math.round(performance.now() - t2) + " ms");
    }).catch(function (err) {
      console.log("[文件] 收尾失败，文件没有换成新的：", err);
      showToast("文件没有写完，请重新保存");
      S.docDirty = true;   // 圆点会按这个标记在下一帧重新亮起，syncSidebarDirty 每帧都会对照
    }).finally(function () {
      pendingCommit = null;
    });
    stream = null;   // 已经交给收尾，这里不再负责丢弃它
    return true;
  } catch (err) {
    console.log("[文件] 写入失败：", err);
    showToast("保存失败，请重试");
    return false;
  } finally {
    if (stream !== null) {
      // 失败时把流丢掉，让文件锁立刻释放；abort 在已失效的流上会抛，忽略即可
      try { await stream.abort(); } catch (err) { /* 已经关掉或已失效，没有可收拾的 */ }
    }
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
    // 标签跟着一起搬：复制一段带说明文字的电路，粘出来的那份文字也要在，否则用户还得逐个重标一遍
    // 方位角与距离都是相对量（相对元件格心的方向与距离），整批平移之后原样照搬就是对的
    el.labelText = e.labelText;
    el.labelAngle = e.labelAngle;
    el.labelGap = e.labelGap;
    added.push(el);
  }
  // 走选区总入口：这一批成为新的选中集合，原来那批选中在这里落地（落点上的普通元件照旧被顶掉）
  // 复用总入口而不是自己挨个置选中，是为了让落位、置顶、朝向归零这些收尾行为和手动框选完全一致
  applySelection(function (e) { return added.indexOf(e) >= 0; }, false);
  // 切到选中工具：只有在这个工具下，画布上的拖动才是「整批搬走」
  setSelectedSlot(SELECT_SLOT_INDEX);
  // 同样把电路一次推到稳定态：新粘的这批是悬空的、参与不了模拟，但上一批恰好在这一刻落地，
  // 落地会让它下游重新推一遍；按默认速度那又是一层层爬，看上去和读档时一样像乱了套
  runToQuiescence();
  return added.length;
}

// 以选区导入：选一个存档，把里面的元件作为一批悬空选区加进当前画面
// 与「打开」的区别：不替换当前画面，也不改「当前文件」的绑定，只是往现有电路上再添一批元件
// 落点规则：整批保持相对位置不变，把这一批的包围盒中心挪到当前视野中央
async function onImportSelection() {
  if (!canUseLocalFile) { console.log("[文件] 当前浏览器不支持直接读文件"); showToast("当前浏览器不支持读取本地文件"); return; }
  let handle;
  try {
    // 导入框与打开框同一条规矩：不传 types，避免系统按类型过滤把本程序的文件挡在外面
    const handles = await window.showOpenFilePicker(Object.assign({ multiple: false }, startInOption()));
    handle = handles[0];   // 只允许选一个，返回的数组里必定有且只有一项
  } catch (err) {
    // 取消同样不是错误，静默收场
    if (err.name !== "AbortError") { console.log("[文件] 导入框出错：", err); showToast("打开文件失败，请重试"); }
    return;
  }
  rememberPickerHandle(handle);  // 记住这次所在的目录，下次导入框直接从这儿起步
  let text;
  try {
    const file = await handle.getFile();
    text = await file.text();
  } catch (err) {
    console.log("[文件] 读取失败：", err);
    showToast("读取「" + handle.name + "」失败，请重试");
    return;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.log("[文件] 不是本程序的存档：内容不是合法的 JSON");
    showToast("「" + handle.name + "」不是本程序的存档");
    return;
  }
  const parsed = parseScene(raw);
  if (!parsed.ok) { console.log("[文件] " + parsed.reason); showToast("「" + handle.name + "」无法导入：" + parsed.reason); return; }   // 整份不可用就整个放弃
  if (parsed.elements.length === 0) { console.log("[文件] " + handle.name + " 里没有可导入的元件"); showToast("「" + handle.name + "」里没有可导入的元件"); return; }

  const target = viewCenterCell();
  const n = addRecordsAsSelection(parsed.elements, target.cx, target.cy);
  console.log("[文件] 已从 " + handle.name + " 导入 " + n + " 个元件作为选区" +
    (parsed.skipped.length ? "，跳过 " + parsed.skipped.length + " 条坏数据" : ""));
  showToast("已导入 " + n + " 个元件作为选区");
}

// 以选区导出：把当前选区单独存成一个存档文件，结构与整份存档一致，只是不含视野
// 与「另存为」的区别：导出的是一份新文件，不替换画面、也不改「当前文件」的绑定，当前编辑的还是原来那个
async function onExportSelection() {
  const payload = serializeSelection();
  if (payload.elements.length === 0) { console.log("[文件] 没有选区，没东西可导出"); showToast("没有选区，没东西可导出"); return; }
  if (!canUseLocalFile) { console.log("[文件] 当前浏览器不支持直接写文件"); showToast("当前浏览器不支持写入本地文件"); return; }
  let handle;
  try {
    // 默认名字跟着当前存档走，加个「-选区」后缀，连续导几个不同选区时不会互相覆盖
    const base = S.currentFileName ? S.currentFileName.replace(/\.lccas$/i, "") : "未命名";
    handle = await window.showSaveFilePicker(Object.assign({
      suggestedName: base + "-选区" + SAVE_EXT,
      types: SAVE_FILE_TYPES
    }, startInOption()));
  } catch (err) {
    // 用户按取消不是错误，静默收场；其它错误才报出来，免得一次取消就弹一堆提示
    if (err.name !== "AbortError") { console.log("[文件] 保存框出错：", err); showToast("导出失败，请重试"); }
    return;
  }
  rememberPickerHandle(handle);  // 记住这次所在的目录，下次导出框直接从这儿起步
  try {
    const stream = await handle.createWritable();
    await stream.write(JSON.stringify(payload));  // 与整份存档同样不缩进，两处格式保持一致
    await stream.close();
    console.log("[文件] 已把 " + payload.elements.length + " 个元件导出到 " + handle.name);
    showToast("已导出 " + payload.elements.length + " 个元件到「" + handle.name + "」");
  } catch (err) {
    console.log("[文件] 写入失败：", err);
    showToast("导出失败，请重试");
  }
}

/* ========== 剪贴板（复制选区 / 粘贴） ========== */

// 序列化当前选区，作为剪贴板里的内容：结构与存档一致，只是不带视野——粘贴时落在哪由那时的指针决定
// 与存档的差别只有一条：存档不收悬空的元件，而剪贴板要的恰恰就是这批悬空的元件
function serializeSelection() {
  const list = [];
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (!el.selected || el.deleting) continue;
    list.push(elementToRecord(el));
  }
  // 格式标记与版本号直接取存档那两处常量：这份内容将来要原样走一遍 parseScene，两处的版本必须同源，
  // 写死一个数字的话，存档结构一升版，剪贴板就会先被自己的校验挡在门外
  return { format: SCENE_FORMAT, version: SCENE_VERSION, elements: list };
}

// 复制选区到系统剪贴板：内容是一段纯文本 JSON，与存档同格式，粘回编辑器能原样读回来
// 写剪贴板要用系统的接口，用户按下的那一下就是「用户手势」，浏览器不会拦
async function copySelection() {
  const payload = serializeSelection();
  if (payload.elements.length === 0) { console.log("[剪贴板] 没有选区，没东西可复制"); showToast("没有选区，没东西可复制"); return; }
  if (!S.canUseClipboard) { console.log("[剪贴板] 当前环境不支持写剪贴板"); showToast("当前环境不支持写剪贴板"); return; }
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload));  // 不缩进：这份要能原样粘回来，不是给人看的
    console.log("[剪贴板] 已复制 " + payload.elements.length + " 个元件");
    showToast("已复制 " + payload.elements.length + " 个元件");
  } catch (err) {
    console.log("[剪贴板] 写入失败：", err);
    showToast("复制失败，请重试");
  }
}

/* ========== 给 AI 的文本（只出不进） ========== */

// 把当前电路写成一段紧凑的纯文本：一行一个元件，列序固定，头两行是给读的人（或 AI）的图例
// 为什么另做一份而不复用存档：存档要能原样读回来，字段名与结构一个都不能动；
// 给 AI 看的这一份只要信息够、字数少，键名可以整列省掉，改成一行一个元件后比缩进 JSON 少一个量级
// 只导出电路，不含视野与界面设置：那些是编辑环境，对看懂电路没有帮助
// 顺序沿用元件在画面上的先后，不另排序：同一份电路每次复制出来都一样，方便前后对照
function serializeSceneText() {
  const list = [];
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (el.deleting) continue;   // 正在播放消失动画的元件不算数，写进去会凭空多出一个
    list.push(elementToRecord(el));
  }
  const lines = [];
  lines.push("# 激光门电路，共 " + list.length + " 个元件");
  lines.push("# 列序 type gx gy dir on；dir 0上 1右 2下 3左；on 0关 1开；gx 向右增、gy 向下增");
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    lines.push(r.type + " " + r.gx + " " + r.gy + " " + r.dir + " " + (r.on ? 1 : 0));
  }
  return lines.join("\n");
}

// 复制给 AI：把上面那段文本写进剪贴板，直接粘进对话里就行
// 与「复制选区」分开：那份是存档格式，必须能原样粘回编辑器，所以字段名不能省；
// 这份只出不进，怎么省字怎么来，用不着迁就读档那一侧
// 复制的是整份电路而不是选区：给 AI 看电路通常要它看到全貌，只给一半反而看不懂
async function copyForAi() {
  if (S.elements.length === 0) { console.log("[AI 文本] 画面上还没有元件，没东西可复制"); showToast("画面上还没有元件"); return; }
  // 与保存同一条规矩：悬空的元件不在这份文本里，这时复制出去会漏掉一批元件，先拦下并提示
  if (selectionHeld()) { showToast("选区尚未落位，无法复制"); return; }
  if (!S.canUseClipboard) { console.log("[AI 文本] 当前环境不支持写剪贴板"); showToast("当前环境不支持写剪贴板"); return; }
  const text = serializeSceneText();
  try {
    await navigator.clipboard.writeText(text);
    console.log("[AI 文本] 已复制当前电路，" + text.length + " 字符");
    showToast("已复制给 AI 的电路文本");
  } catch (err) {
    console.log("[AI 文本] 写入失败：", err);
    showToast("复制失败，请重试");
  }
}

// 粘贴：把剪贴板里的文本解析成元件记录，作为一批悬空选区加进画面
// 必须走系统的粘贴事件，而不是去调「读剪贴板」的接口：那个接口要授权，在本地文件下不可靠；
// 粘贴事件是浏览器主动把内容递过来，不需要任何授权
// 剪贴板里不是本程序的内容就静默忽略，不去动画面
function onPaste(e) {
  // 焦点在文本框里时不认领这一下：那是往框里粘一段字，不是往画面上贴元件
  // 认领了就会去解析剪贴板里那串普通文字，解析不出来还会把「已忽略」写进日志
  if (isTextEntry(e.target)) return;
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
  if (parsed.elements.length === 0) { console.log("[剪贴板] 剪贴板里没有可粘贴的元件"); showToast("剪贴板里没有可粘贴的元件"); return; }
  e.preventDefault();   // 确认要用了才拦默认行为，用不上时留给浏览器自己处理
  // 落点：指针在画布内就以指针所在格为中心，指针不在就退回视野中心
  const target = S.pointerInside
    ? { cx: cellCenterX(screenToWorldX(S.pointerSX)), cy: cellCenterY(screenToWorldY(S.pointerSY)) }
    : viewCenterCell();
  const n = addRecordsAsSelection(parsed.elements, target.cx, target.cy);
  console.log("[剪贴板] 已粘贴 " + n + " 个元件" +
    (parsed.skipped.length ? "，跳过 " + parsed.skipped.length + " 条坏数据" : ""));
}

