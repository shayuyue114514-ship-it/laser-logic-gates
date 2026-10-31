// selection.js：选区操作：选中、框选、拖动、整批旋转与落位。
"use strict";

/* ========== 选中 ========== */

// 当前是不是「选中工具」：只有它被选中时，画布上的左键才是选择而不是放置
// 放置与选择共用一个左键，靠这个判据分流，两边不会互相抢操作
function selectToolActive() {
  return S.slotSelectedIndex === SELECT_SLOT_INDEX;
}

// 当前是不是「文本工具」：只有它被选中时，画布上的左键才是「放一段浮动文本」
// 与选中工具是并列的两支：选中工具操作元件，文本工具操作文字，两者互不干涉
function textToolActive() {
  return S.slotSelectedIndex === TEXT_SLOT_INDEX;
}

// 切换选中的选项槽：手上虚影随之换成新类型；从选中工具切走时立刻把选区收掉
// 收选区必须「立刻」而不是等下次操作：元件一直离地会让画面和数据长期不一致，用户也看不到落位结果
function setSelectedSlot(index) {
  const wasSelect = selectToolActive();
  S.slotSelectedIndex = index;
  if (wasSelect && !selectToolActive()) exitSelectTool();
  applyGhostType();
}

// 退出选中模式：把所有选中一并取消，离地的元件就地落位（落点上的普通元件被顶掉）
// 走 applySelection 这个总入口，落位规则与「单击空白清空选中」完全一致，不会出现两套行为
function exitSelectTool() {
  let any = false;
  for (let i = 0; i < S.elements.length; i++) {
    if (S.elements[i].selected) { any = true; break; }
  }
  if (!any) {
    for (let i = 0; i < S.texts.length; i++) {
      if (S.texts[i].selected) { any = true; break; }
    }
  }
  if (!any) return;  // 本来就没选中：不白跑一遍落位
  // 先清浮动文本再走元件那个总入口：applySelection 那一次提交会把两半改动一起记成一步
  applyTextSelection(function () { return false; }, false);
  applySelection(function () { return false; }, false);
}

// 判断此刻是否还有东西悬空（被选中）：保存与「复制给 AI」都要在落位前拦下，
// 因为悬空的元件不写进文件，直接存出去会得到一份少了这批元件的存档
function selectionHeld() {
  for (let i = 0; i < S.elements.length; i++) {
    if (S.elements[i].selected && !S.elements[i].deleting) return true;
  }
  for (let i = 0; i < S.texts.length; i++) {
    if (S.texts[i].selected) return true;
  }
  return false;
}

// ===== 选区框架 =====
// 「谁被选中」和「选区有没有离地」是两件事：
// 离地 = 这批元件暂时不跟地图发生占用关系，压在别人的格子上也不会把别人顶掉，画面上允许暂时重叠；
// 只有元件离开选区那一刻才落地，落点格子上没被选中的元件才被顶掉。
// 单击和拉框共用 applySelection 这一个入口，「不按 Shift 只留命中的、按住 Shift 逐个翻转」只有一份规则。

// 落位：把「这一轮离开选区」的元件放下来，落点格子上没被选中的元件直接顶掉
// 用立即移除而不是走删除动画：动画期间那一格仍算被占用，会和刚落下的元件叠在同一格里
// 只有离开选区的元件才落地，继续留在选区里的仍然离地，所以拖动、旋转中途随便改主意都不会造成不可逆的破坏
function landSelection(landing) {
  if (landing.length === 0) return;
  let removed = 0;
  // 倒序遍历：splice 会让后面所有下标前移，倒着走不会漏掉还没处理的项
  for (let i = S.elements.length - 1; i >= 0; i--) {
    const el = S.elements[i];
    if (el.selected || el.deleting) continue;        // 还在选区里的自己人不能动；正在消失的元件不参与判定
    if (landing.indexOf(el) >= 0) continue;          // 这次落地的自己人留着
    if (!cellOccupiedBy(landing, el.wx, el.wy)) continue;  // 没有落地元件压住它这一格，留着
    unindexElement(el);  // 同时从格子索引里退掉：它这一格马上要归落地的那个元件
    S.elements.splice(i, 1);
    removed++;
  }
  // 真的顶掉了才需要重算：否则每一下拉框都会全量重建阻挡图，白卡一顿
  if (removed > 0) S.rayGraph.dirty = true;  // splice 让下标前移，阻挡图里存的下标随之失效
}

// 指定格心是否被名单里某个元件占着：落位判定用，只看格心相等
function cellOccupiedBy(list, wx, wy) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].wx === wx && list[i].wy === wy) return true;
  }
  return false;
}

// 选区判定总入口：单击与拉框都走这里，两边的规则不会各写一份、慢慢跑偏
// isHit 是个判定函数，告诉框架某个元件这一轮算不算被命中（单击看是不是指针所在那个，拉框看格子与框有没有相交）
// toggle 为真（按住 Shift）时以按下时的快照为基准逐个翻转；为假时按常规「只留命中的」处理
// 翻转用快照而不是当前状态，所以框拉大拉小、来回拖，同一个元件都不会反复横跳
function applySelection(isHit, toggle) {
  const landing = [];  // 这一轮从「选中」变成「不选中」的元件：只有它们算被放下
  const nextSel = [];  // 与 elements 一一对应的新选中状态，先全部算好再统一写回
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    let sel = false;
    if (!el.deleting) {  // 删除动画中的元件不参与选中
      const hit = isHit(el);
      sel = toggle ? (hit ? !el.selBase : el.selBase) : hit;
      if (el.selected && !sel) landing.push(el);  // 离开选区，这一刻才落地
    }
    nextSel.push(sel);
  }
  for (let i = 0; i < S.elements.length; i++) S.elements[i].selected = nextSel[i];  // 先写回状态，落地时按新状态认人
  landSelection(landing);  // 只有离开选区的那些才放下；Shift 加点新元件不会把手上这批顺手提交掉
  S.selOrientDir = 0;  // 这一批算新选区，朝向从朝上重新起算，接着按 WASD 才是相对「朝上」转
  S.rayGraph.dirty = true;  // 选中集合一变，参与模拟的元件就变了，阻挡图必须按新集合重建
  S.sceneDirty = true;
  // 选中即离地，离地就不该再挡光、发光，所以这里立刻按新集合把激光场重算一遍
  // 不补这一下的话，光的更新要等微帧时钟走到下一格，默认 0.12 秒、速度调慢时能到 1 秒，
  // 那段时间里元件明明已经提亮成选中态，光却还照着它在走，看着就像「选中了却仍在工作」
  // 这条路只在敲定选中的那一刻才走（拉框途中走的是预览，不进这里），所以手一松、光立刻就变
  refreshLightField();
  // 选中集变了：缓存里存的是「不选」的样子，选中那批要挪到每帧单独画的叠加层里
  // 先作废，落地时 commitHistory 还会再作废一次，两次都只是置一个标志，下一帧只重画一次
  invalidateElementCache();
  // 记一步：元件落地、以及落点顶掉别人，都发生在这一刻，这才是电路真正被改动的时刻
  // 拉框途中不记：每动一下都记会把一次框选拆成几十步，等松手时统一记一次
  if (!S.marqueeActive) commitHistory();
}

// 单击选中：命中的是指针所在那一格的元件；点空白处谁都没命中，等于清空全部选中
// 按住 Shift 时和拉框一样走翻转，点一下就在「选中」与「未选中」之间切一次
function selectAtPointer(toggle) {
  const el = findElementAtPointer();
  const hitEl = (el !== null && !el.deleting) ? el : null;  // 删除动画中的元件不算点中，避免选到一个正在消失的东西
  // 浮动文本也判一次：两者互不顶替，选中哪个只由「指针落在谁身上」决定
  const tx = textAtPointer(S.pointerSX, S.pointerSY);
  const hitTx = (tx !== null && !tx.deleting) ? tx : null;
  // 先写浮动文本：applySelection 那一次提交会把两半改动一起记成一步，顺序反过来会漏记文字那一半
  applyTextSelection(function (t) { return t === hitTx; }, toggle);
  applySelection(function (e) { return e === hitEl; }, toggle);
}

// 拉框的判定框：四个边界加上半格宽，算一次留给预览与敲定两处共用
// 半格指的是半格在屏幕上的像素数；一格是 1×1 世界单位，所以整格宽就是当前缩放
function marqueeBox(x0, y0, x1, y1) {
  return {
    left: Math.min(x0, x1),
    right: Math.max(x0, x1),
    top: Math.min(y0, y1),
    bottom: Math.max(y0, y1),
    half: state.scale / 2
  };
}

// 一个元件这一轮算不算被框命中：元件所占的整格与框相交就算
// 用整格去判而不是用格心：框擦到格子边缘也算命中，和常见画图软件的手感一致
// 同一格只认最上层那个：被压住的元件不参与命中，否则一格会同时选中两个元件
// 预览与松手敲定共用它，两边算出来的结果必然一致，不会出现「预览亮着、松手却不一样」
function marqueeHits(el, box) {
  if (el.deleting) return false;   // 正在消失的元件不参与选中，预览也一样不算
  const cx = worldToScreenX(el.wx);
  const cy = worldToScreenY(el.wy);
  if (!(cx + box.half >= box.left && cx - box.half <= box.right &&
        cy + box.half >= box.top && cy - box.half <= box.bottom)) return false;
  return el === topElementAtCell(el.wx, el.wy);
}

// 按框敲定选中：元件与浮动文本各按自己的判据来，两边都写进真实状态
// 只在松手那一刻调用；拉框途中走 previewInMarquee，只看不动
// 先写浮动文本：applySelection 那一次提交会把两半改动一起记成一步
function selectInMarquee(box, toggle) {
  applyTextSelection(function (tx) { return textHitsMarquee(tx, box); }, toggle);
  applySelection(function (el) { return marqueeHits(el, box); }, toggle);
}

// 拉框途中的预览：只记下「现在松手会选中谁」，真正的选中状态一动不动
// 用的是与敲定完全同一条规则（含 Shift 翻转），所以框里亮着的就是松手后会选中的
// 每个元件都记一份三态结果：true 会选中、false 会取消、null 表示没在预览（照它自己的选中状态画）
// 用三态而不是布尔：按住 Shift 框到已选中的元件是要把它们取消，那种「即将不再选中」也得先画出来
function previewInMarquee(box, toggle) {
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    const hit = marqueeHits(el, box);
    el.selPreview = el.deleting ? false : (toggle ? (hit ? !el.selBase : el.selBase) : hit);
  }
  // 浮动文本同一趟一起预览：它不占格子，判据换成「它自己的外框与框有没有相交」
  // 一起预览才是一致的：框里亮着的就是松手后会选中的，两类东西不会一个亮一个不亮
  for (let i = 0; i < S.texts.length; i++) {
    const tx = S.texts[i];
    const hit = textHitsMarquee(tx, box);
    tx.selPreview = toggle ? (hit ? !tx.selBase : tx.selBase) : hit;
  }
}

// 收掉预览：每样东西的预览结果回到 null，画面随即回到它真实的选中状态
function clearSelectionPreview() {
  for (let i = 0; i < S.elements.length; i++) S.elements[i].selPreview = null;
  for (let i = 0; i < S.texts.length; i++) S.texts[i].selPreview = null;
}

// 拉框按下：记下起点并捕获指针，这样指针移出画布甚至移出窗口也能继续收到 move
function beginMarquee(e) {
  S.marqueePointerId = e.pointerId;
  S.marqueePressing = true;
  S.marqueeActive = false;
  S.marqueeStartSX = e.clientX;
  S.marqueeStartSY = e.clientY;
  S.marqueeEndSX = e.clientX;
  S.marqueeEndSY = e.clientY;
  // 按下的这一刻把每个元件的选中状态存一份快照：按住 Shift 框选时的翻转以它为基准，
  // 拖动过程中选中状态一直在变，不存快照的话同一个元件会被反复翻转。浮动文本同样存一份
  for (let i = 0; i < S.elements.length; i++) S.elements[i].selBase = S.elements[i].selected;
  for (let i = 0; i < S.texts.length; i++) S.texts[i].selBase = S.texts[i].selected;
  S.canvas.setPointerCapture(e.pointerId);
}

// 拉框移动：超过阈值才算真的在拉框，没超过仍按单击处理，避免手一抖就拉出一个空框把选中清掉
function moveMarquee(e) {
  if (!S.marqueePressing || e.pointerId !== S.marqueePointerId) return;
  S.marqueeEndSX = e.clientX;
  S.marqueeEndSY = e.clientY;
  if (!S.marqueeActive) {
    const dx = S.marqueeEndSX - S.marqueeStartSX;
    const dy = S.marqueeEndSY - S.marqueeStartSY;
    if (dx * dx + dy * dy < CONFIG.marqueeThreshold * CONFIG.marqueeThreshold) return;
    S.marqueeActive = true;
  }
  // 边拉边亮：每动一下都按当前框重算一遍预览，框到的元件立刻提亮，缩回去的自动退回原样
  // 只写预览、不写选中，所以框还没松手时元件看着像是选中了，实则仍在电路里照常挡光发光
  // 按住 Shift 就切到翻转模式，拖动途中按下或松开 Shift 都能即时切换，不必重新拉框
  previewInMarquee(marqueeBox(S.marqueeStartSX, S.marqueeStartSY, S.marqueeEndSX, S.marqueeEndSY), e.shiftKey);
  S.sceneDirty = true;  // 框要跟着指针走，每动一下都得重画
}

// 拉框松开：真拉出框了就按框选一批，否则当成一次单击（选中点中的元件，或清空选中）
// 两条路都要走，否则「按下不动再松开」会既没选中也没清空，手感很怪
// 松手这一刻才真正落定：先收掉预览，再按同一个框把选中写进元件，元件就此离地、退出电路
// 单击时把 Shift 状态一并传下去，这样 Shift+单击也能像 Shift+框选那样翻转，两边的规则完全一致
function endMarquee(e) {
  clearSelectionPreview();  // 预览让位给真实状态，下面立刻写入，中间不留下「亮着却没选中」的一帧
  if (S.marqueeActive) selectInMarquee(marqueeBox(S.marqueeStartSX, S.marqueeStartSY, S.marqueeEndSX, S.marqueeEndSY), e.shiftKey);
  else selectAtPointer(e.shiftKey);
  S.marqueePressing = false;
  S.marqueeActive = false;
  S.marqueePointerId = -1;
  if (S.canvas.hasPointerCapture(e.pointerId)) S.canvas.releasePointerCapture(e.pointerId);
  S.sceneDirty = true;
  commitHistory();  // 框选期间刻意不记步，松手这一刻把整场框选（含落位顶替）合成一步
}

// 拉框被系统打断（如触控中断）：收掉预览、只收状态、不动选中，免得把用户已有的选择误清掉
function cancelMarquee(e) {
  clearSelectionPreview();  // 中断了就撤掉预览，画面回到真实的选中状态
  S.marqueePressing = false;
  S.marqueeActive = false;
  S.marqueePointerId = -1;
  if (S.canvas.hasPointerCapture(e.pointerId)) S.canvas.releasePointerCapture(e.pointerId);
  S.sceneDirty = true;
  commitHistory();  // 框选途中已经有元件落过地，被打断也要把那些改动记下来，否则会和后面的步混成一步
}

// 按下已选中的元件：进入拖动准备态，记下起点世界坐标，并把这一批选中的元件收进拖动组
// 组里存的是元件引用而不是下标：落地时可能删掉被覆盖的元件，下标会整体前移，存下标会指错人
function beginMove(e) {
  S.moveDragging = true;
  S.movePointerId = e.pointerId;
  S.moveStartWX = screenToWorldX(e.clientX);
  S.moveStartWY = screenToWorldY(e.clientY);
  S.moveDGX = 0;
  S.moveDGY = 0;
  S.moveDWX = 0;
  S.moveDWY = 0;
  S.moveGroup.length = 0;
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (el.selected && !el.deleting) S.moveGroup.push(el);  // 删除动画中的元件不带走
  }
  // 选中的浮动文本一起带走，另放一组：它不吸附网格，位移要按连续量走，不能与元件共用那个取整的位移
  S.moveGroupTexts.length = 0;
  for (let i = 0; i < S.texts.length; i++) {
    if (S.texts[i].selected) S.moveGroupTexts.push(S.texts[i]);
  }
  S.canvas.setPointerCapture(e.pointerId);
}

// 拖动中：元件按整格位移走，浮动文本按连续位移走，两边各算各的
// 元件那条：只把「与上次的差值」加给元件，避免每帧重复累加；位移取整到整格，数据始终落在格心上
// 文字那条：位移不取整，否则本来自由摆放的位置会被一格一格地吃掉，越拖越偏
// 两条都各自留一份缓动偏移，松手前画面会平滑追上，看着不硬跳
// 拖动期间相机不动，所以直接用按下时的世界坐标当基准，不必每帧换算参考点
function moveSelectionDrag(e) {
  if (!S.moveDragging || e.pointerId !== S.movePointerId) return;
  const dwx = screenToWorldX(e.clientX) - S.moveStartWX;   // 指针的连续世界位移
  const dwy = screenToWorldY(e.clientY) - S.moveStartWY;
  let moved = false;
  // 浮动文本先算：下面元件那条会在「还没跨到下一格」时提前返回，把文字这一半跳过
  if (S.moveGroupTexts.length > 0 && (dwx !== S.moveDWX || dwy !== S.moveDWY)) {
    const sx = dwx - S.moveDWX;
    const sy = dwy - S.moveDWY;
    S.moveDWX = dwx;
    S.moveDWY = dwy;
    for (let i = 0; i < S.moveGroupTexts.length; i++) {
      const tx = S.moveGroupTexts[i];
      tx.wx += sx;
      tx.wy += sy;
      // 视觉偏移反向补上这一步：数据已经走了，画面先留在原处，再由 updateMoveAnim 缓出追上
      tx.mvOffU -= sx;
      tx.mvOffV -= sy;
    }
    moved = true;
  }
  const dgx = Math.round(dwx);   // 元件的位移取整到整格，数据始终落在格心上
  const dgy = Math.round(dwy);
  if (dgx !== S.moveDGX || dgy !== S.moveDGY) {
    const stepX = dgx - S.moveDGX;
    const stepY = dgy - S.moveDGY;
    S.moveDGX = dgx;
    S.moveDGY = dgy;
    for (let i = 0; i < S.moveGroup.length; i++) {
      const el = S.moveGroup[i];
      const oldWx = el.wx, oldWy = el.wy;
      el.wx += stepX;
      el.wy += stepY;
      reindexElement(el, oldWx, oldWy);  // 跨了一格就换格子索引：按格查元件、拉框命中都要靠它
      el.mvOffU -= stepX;
      el.mvOffV -= stepY;
    }
    moved = true;
  }
  if (!moved) return;
  S.rayGraph.dirty = true;  // 位置变了，谁挡谁的结论随之改变，下一微帧按新位置重算激光
  S.sceneDirty = true;      // 元件节点要摆到新格心上，文字也要画到新位置
}

// 松开左键：只收拖动状态，不动地图上的其他元件
// 落点顶替不在这里做——选区结束（重新确定选区）时才统一落位，拖动中途随便改主意都不会造成不可逆的破坏
// 没挪动过（原地按下又松开）就什么都不做：多选时点一下已选中的元件不该把选中收缩成一个
function endMove(e) {
  S.moveDragging = false;
  S.movePointerId = -1;
  S.moveDGX = 0;
  S.moveDGY = 0;
  S.moveGroup.length = 0;
  S.moveGroupTexts.length = 0;
  // 浮动文本这一段位移不在 applySelection 那一步的覆盖范围内（它没有落位这回事），所以要在这里补记一步
  // 元件那一批仍照原样推迟到下一次选区确定时再记，不跟着一起记，改动范围保持最小
  if (S.moveDWX !== 0 || S.moveDWY !== 0) commitHistory();
  S.moveDWX = 0;
  S.moveDWY = 0;
  if (S.canvas.hasPointerCapture(e.pointerId)) S.canvas.releasePointerCapture(e.pointerId);
  S.sceneDirty = true;
}

// 拖动被系统打断（如触控中断）：把元件与文字都退回原位再收状态
// 位移是整组统一的，反向加回去即可，不需要逐个记原始坐标
function cancelMove(e) {
  for (let i = 0; i < S.moveGroup.length; i++) {
    const el = S.moveGroup[i];
    el.wx -= S.moveDGX;
    el.wy -= S.moveDGY;
    el.mvOffU = 0;  // 退回原位是「撤销」，不该留缓动尾巴，直接归零让画面与数据立刻对齐
    el.mvOffV = 0;
  }
  for (let i = 0; i < S.moveGroupTexts.length; i++) {
    const tx = S.moveGroupTexts[i];
    tx.wx -= S.moveDWX;
    tx.wy -= S.moveDWY;
    tx.mvOffU = 0;
    tx.mvOffV = 0;
  }
  if (S.moveDGX !== 0 || S.moveDGY !== 0) S.rayGraph.dirty = true;  // 退回去了，激光要按原位重算
  S.moveDragging = false;
  S.movePointerId = -1;
  S.moveDGX = 0;
  S.moveDGY = 0;
  S.moveDWX = 0;
  S.moveDWY = 0;
  S.moveGroup.length = 0;
  S.moveGroupTexts.length = 0;
  if (S.canvas.hasPointerCapture(e.pointerId)) S.canvas.releasePointerCapture(e.pointerId);
  S.sceneDirty = true;
}

// 选中元件的包围盒，用格号表示：没有选中元件时返回 null
// 元件一定在格心上，格心坐标减 0.5 就是整数格号，可以直接取整
function selectionBounds() {
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity, n = 0;
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (!el.selected || el.deleting) continue;
    const u = Math.round(el.wx - 0.5);
    const v = Math.round(el.wy - 0.5);
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
    n++;
  }
  if (n === 0) return null;
  return { uMin: uMin, uMax: uMax, vMin: vMin, vMax: vMax };
}

// 起一段公转：把每个元件的起点格号与起点角度记在它自己身上，进度归零
// 起点只记在元件上，动画期间元件的 wx/wy 一动不动，激光要等落位后才按新位置重算
function beginOrbit(refs, pivotU, pivotV, turns) {
  S.orbitPivotU = pivotU;
  S.orbitPivotV = pivotV;
  S.orbitTurns = turns;
  S.orbitP = 0;
  const total = turns * 90;
  for (let i = 0; i < refs.length; i++) {
    const el = refs[i];
    el.orbitU0 = Math.round(el.wx - 0.5);
    el.orbitV0 = Math.round(el.wy - 0.5);
    el.orbitAngle0 = el.angle;
    // 轴心在半格上时，转完的精确位置会卡在半格边界，落位要吸附回格心；把这个吸附量先记下来，
    // 动画途中按进度逐步补上，收尾那一下才不会整批跳半格
    const p = orbitPoint(el.orbitU0, el.orbitV0, total);
    el.orbitShiftU = Math.round(p.u) - p.u;
    el.orbitShiftV = Math.round(p.v) - p.v;
  }
  S.orbitActive = true;
  S.sceneDirty = true;
}

// 走一步公转：上一段还在飞就先把它的终点落位，再按当前选中的元件重新起一段
// 这样连续跨过好几格也不丢步，只是每段动画被压缩成「立即到位」
// 拖拽弧线与 WASD 都走这里，选区朝向也在这里同步推进，两条入口不会各自记一份朝向
function applyOrbitStep(step) {
  if (step === 0) return;
  if (S.orbitActive) finishOrbit();
  const refs = [];
  for (let i = 0; i < S.elements.length; i++) {
    if (S.elements[i].selected && !S.elements[i].deleting) refs.push(S.elements[i]);
  }
  if (refs.length === 0) return;
  // 整批转了 step 个 90°，选区朝向跟着一起走，下次按键才是相对新朝向算要转多少
  S.selOrientDir = ((S.selOrientDir + step) % 4 + 4) % 4;
  beginOrbit(refs, S.rotPivotU, S.rotPivotV, step);
}

// 用 WASD 把整个选区转到按下的方向：上、右、下、左，整批按最短路径一起转 90° 的整数倍
// 要转多少以选区自己的朝向为准（新选区一律朝上），不是看某个元件的角度，所以整批刚体旋转、相对形状不变
// 轴心沿用拖拽弧线那套「包围盒几何中心」，每次按键按当前包围盒重算，转完再吸附回格心
// 返回 true 表示这次按键已经由选区接手；没有选中元件时返回 false，让调用方退回悬停元件 / 虚影的老逻辑
function rotateSelectionToDir(dirKey) {
  let hasSelection = false;
  for (let i = 0; i < S.elements.length; i++) {
    if (S.elements[i].selected && !S.elements[i].deleting) { hasSelection = true; break; }
  }
  if (!hasSelection) return false;
  // 上一段公转还在飞就先落位，否则朝向与画面错位，整批会多转一步或少转一步
  if (S.orbitActive) finishOrbit();
  const steps = Math.round(shortestTurnTo(S.selOrientDir * 90, dirKey * 90) / 90);
  if (steps === 0) return true;  // 已经朝着这个方向：不做动作，但也不能再落到悬停元件上
  const b = selectionBounds();
  if (b === null) return true;
  S.rotPivotU = (b.uMin + b.uMax) / 2;
  S.rotPivotV = (b.vMin + b.vMax) / 2;
  applyOrbitStep(steps);
  return true;
}

// 镜像用的中线（世界坐标）：左右镜像给一条竖线、上下镜像给一条横线，翻折就照这条线做
// 选中有元件时一律按元件占的整格定线：格号是整数，中点加上半格仍是整数或半整数，
// 翻过去元件依然落在格心上；只选中了浮动文本时才按文本自己的外框定线
// 两者同时选中时中线仍只按元件算：文本是自由摆放的，把它那点零头算进来会让中线落在任意实数上，
// 元件就会翻到格子当中，从此不再是「一格一个元件」的那个位置
function mirrorLineWorld(axis, hasElement) {
  if (hasElement) {
    const b = selectionBounds();
    if (b !== null) return axis === "h" ? (b.uMin + b.uMax) / 2 + 0.5 : (b.vMin + b.vMax) / 2 + 0.5;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < S.texts.length; i++) {
    const tx = S.texts[i];
    if (!tx.selected) continue;
    const m = textBlockMetrics(tx);
    // 外框的世界尺寸：宽度是按屏幕量出来的像素，除以缩放换回世界单位
    const size = (axis === "h" ? m.w : m.h) / state.scale;
    const a = axis === "h" ? tx.wx : tx.wy;
    if (a < lo) lo = a;
    if (a + size > hi) hi = a + size;
  }
  if (lo > hi) return 0;   // 没有任何东西可选（调用方已经拦过，这里只是不让它算出 NaN）
  return (lo + hi) / 2;
}

// 把选中的这一批照中线翻一次：H 是左右镜像，V 是上下镜像
// 与 WASD 旋转走同一路：元件那半只改悬空中的坐标与朝向，历史留到选区结束、落位那一刻统一记，
// 于是「翻转 + 落位」在撤销栈里仍是一步，与拖动、旋转的记法完全一致
// 浮动文本跟着一起翻：它没有落位那一刻，所以文本那半在本函数末尾当场记一步（与拖动结束时同一套做法）
// 文本翻的是整块外框的位置，字本身仍正着读：把字形镜像过来就没法读了
// 返回 true 表示这次按键已经由选区接手；没有任何东西选中时返回 false，交给调用方收场
function mirrorSelection(axis) {
  // 上一段公转还在飞就先落位：镜像要按定下来的位置算中线，否则中线是按动画中途的姿态算的
  if (S.orbitActive) finishOrbit();
  let hasElement = false;
  for (let i = 0; i < S.elements.length; i++) {
    if (S.elements[i].selected && !S.elements[i].deleting) { hasElement = true; break; }
  }
  let hasText = false;
  for (let i = 0; i < S.texts.length; i++) {
    if (S.texts[i].selected) { hasText = true; break; }
  }
  if (!hasElement && !hasText) return false;
  const line = mirrorLineWorld(axis, hasElement);
  const table = axis === "h" ? MIRROR_DIR_H : MIRROR_DIR_V;
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (!el.selected || el.deleting) continue;
    // 位置照中线翻：照的是格心，中点又是整数或半整数，所以翻完仍是格心
    const oldWx = el.wx, oldWy = el.wy;   // 改坐标之前先记下旧格号，格子索引要按新旧两个格号摘挂
    if (axis === "h") el.wx = line * 2 - el.wx;
    else el.wy = line * 2 - el.wy;
    reindexElement(el, oldWx, oldWy);     // 翻完换了格，格子索引跟着一起挪
    // 朝向与角度一起换成翻过之后的那个方向，角度直接落到位，不走旋转动画：
    // 镜像不是旋转，让它顺着弧线转过去反而是在说「转了半圈」（形状一样、摆法不同的一格，二者不是一回事）
    // 当前朝向从目标角度换算，不直接读 el.dir：旋转动画还没停下时 el.dir 仍停在旧方向上，
    // 那一刻按 H/V 会照旧方向去翻，翻出来是错的（存档那边也是这么换算的，见 scene.js 的 elementToRecord）
    const cur = ((Math.round(el.angleTarget / 90) % 4) + 4) % 4;
    const dir = table[cur];
    el.dir = dir;
    el.angle = dir * 90;
    el.angleTarget = el.angle;
    el.mvOffU = 0;   // 拖动缓动的残留一并归零，否则翻完还会朝着拖动时的方向偏一点
    el.mvOffV = 0;
  }
  for (let i = 0; i < S.texts.length; i++) {
    const tx = S.texts[i];
    if (!tx.selected) continue;
    const m = textBlockMetrics(tx);
    if (axis === "h") tx.wx = line * 2 - (tx.wx + m.w / state.scale);
    else tx.wy = line * 2 - (tx.wy + m.h / state.scale);
    tx.mvOffU = 0;
    tx.mvOffV = 0;
  }
  // 选区自己的朝向：左右镜像把「上」留在上，朝向不变；上下镜像把整批的上翻成了下，朝向要跟着走两位，
  // 这样接着按 WASD 仍是「相对这批自己的上要转多少」，与镜像之前的手感一致
  if (hasElement && axis === "v") S.selOrientDir = (S.selOrientDir + 2) % 4;
  S.rayGraph.dirty = true;   // 位置与朝向都变了，谁挡谁与激光场要按新摆法重算
  S.sceneDirty = true;
  commitHistory();   // 文本那一半的位置变化在这里当场记账；元件那半还在悬空，这次提交不会记它
  return true;
}

// 用 WASD 把指针悬停的那个元件转到按下的方向：没有选区时的第二顺位
// 与虚影共用同一套「最短路径」算法：元件自带朝向，只拨到目标朝向，不顺着累积角度绕远路
// 转完立刻记一步：悬停旋转是就地生效的改动，不像选区那样「悬空」，不记的话撤销会跳过它去撤更早的动作
// 返回 true 表示这次按键已经由悬停元件接手；指针下没元件（空格、视口外、正在消失的）时返回 false，让调用方退回虚影
function rotateHoveredElement(dirKey) {
  if (!S.pointerInside) return false;
  if (S.orbitActive) return false;  // 整批公转还在飞：这一拍让给选区，避免同一个元件被两套旋转同时改角度
  const el = findElementAtPointer();
  if (el === null || el.deleting) return false;
  const next = el.angleTarget + shortestTurnTo(el.angleTarget, dirKey * 90);
  if (next === el.angleTarget) return true;  // 已经朝着这个方向：不做动作，但也不能再落到虚影上
  el.angleTarget = next;
  // 开始转之前也让缓存位图重画一次：位图里存的是它转之前的朝向，而转的过程中它改由叠加层画，
  // 不重画的话旧朝向那张会一直留在原位，看上去像两个元件叠在一起
  invalidateElementCache();
  commitHistory();  // 朝向是电路的一部分（决定激光往哪边走），转一下就该占一步历史
  S.sceneDirty = true;  // 角度目标变了，即使画面此刻静止也要重绘一帧把旋转动画推起来
  return true;
}

// 公转推进：进度按固定时长走满，配缓出曲线，起步快、收尾慢，落位干脆
function updateOrbit(dt) {
  if (!S.orbitActive) return;
  S.orbitP += dt / CONFIG.orbitDuration;
  if (S.orbitP >= 1) { finishOrbit(); return; }
  S.sceneDirty = true;  // 元件每帧都在弧线上挪位置，必须每帧重画
}

// 公转落位：把终点写回元件数据（格心、角度、离散朝向），再让阻挡图按新位置重算
// 动画期间只改画面不改数据，所以落位这一刻才是激光真正跟着转的一刻
// 这里不顶掉落点上的其他元件：选区还在，元件仍算离地，等选区结束那一刻才统一落位
function finishOrbit() {
  const total = S.orbitTurns * 90;
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (el.orbitU0 === null) continue;
    // 落点先按精确位置算，再吸附回最近的格心：轴心在半格上时这一步会把整批平移半格
    const p = orbitPoint(el.orbitU0, el.orbitV0, total);
    const oldWx = el.wx, oldWy = el.wy;   // 改坐标之前先记下旧格号，格子索引要按新旧两个格号摘挂
    el.wx = Math.round(p.u) + 0.5;
    el.wy = Math.round(p.v) + 0.5;
    reindexElement(el, oldWx, oldWy);     // 转完之后它多半换了格，格子索引跟着一起挪
    el.angle = el.orbitAngle0 + total;
    el.angleTarget = el.angle;
    el.dir = ((Math.round(el.angle / 90) % 4) + 4) % 4;  // 离散朝向跟着落位角度走，激光逻辑读的是它
    el.orbitU0 = null;
    el.orbitV0 = null;
    el.orbitShiftU = 0;
    el.orbitShiftV = 0;
  }
  S.orbitActive = false;
  S.orbitP = 0;
  S.orbitTurns = 0;
  S.rayGraph.dirty = true;  // 位置与朝向都变了，阻挡图和激光场必须重算
  // 公转途中这批元件一直在叠加层上走，缓存位图里留的是它们的旧位置；落位后必须整张重画，
  // 否则旧位置会留下残影、新位置又什么都没有
  invalidateElementCache();
  S.sceneDirty = true;
}

// 把某个格号绕轴心旋转指定角度，返回旋转后的精确位置（可能落在半格上，不做取整）
// 角度永远是 90 的整数倍，这里用精确的 0/±1 代替 cos/sin：浮点算出的 cos90° 是 6.1e-17 而不是 0，
// 会让恰好卡在半格边界上的结果多出 ±1e-17，Math.round 在 .5 处就会朝两边乱跳，整批形状被撕开
function orbitPoint(u, v, angleDeg) {
  const k = ((Math.round(angleDeg / 90) % 4) + 4) % 4;  // 归一化成四个象限，绕几圈都只看余数
  const c = [1, 0, -1, 0][k];  // cos(k×90°) 的精确值
  const s = [0, 1, 0, -1][k];  // sin(k×90°) 的精确值
  const du = u - S.orbitPivotU;
  const dv = v - S.orbitPivotV;
  return { u: S.orbitPivotU + du * c + dv * s, v: S.orbitPivotV - du * s + dv * c };
}

// 画拉框：半透明填充加一圈实线，直接用屏幕坐标画，不参与相机变换
function drawMarquee() {
  if (!S.marqueeActive) return;
  const x = Math.min(S.marqueeStartSX, S.marqueeEndSX);
  const y = Math.min(S.marqueeStartSY, S.marqueeEndSY);
  const w = Math.abs(S.marqueeEndSX - S.marqueeStartSX);
  const h = Math.abs(S.marqueeEndSY - S.marqueeStartSY);
  S.ctx.save();
  S.ctx.fillStyle = COLOR.selectFill;
  S.ctx.fillRect(x, y, w, h);
  S.ctx.lineWidth = CONFIG.marqueeWidth;
  S.ctx.strokeStyle = COLOR.selectBorder;
  S.ctx.strokeRect(x, y, w, h);
  S.ctx.restore();
}

