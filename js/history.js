// history.js：撤销与重做：差分记录、提交、回退与应用。
"use strict";

/* ========== 撤销 / 重做 ========== */

// 两条记录是否描述同一个元件的同一状态：类型、格号、朝向、开关、标签全一样才算没变
// 标签的三项都要比：改文字、把标签拖到另一个方位、把它拉近拉远，都是要能撤销的动作，漏掉任何一项都撤不回来
function recordEquals(a, b) {
  return a.type === b.type && a.gx === b.gx && a.gy === b.gy && a.dir === b.dir && a.on === b.on &&
    a.label === b.label && a.labelAngle === b.labelAngle && a.labelGap === b.labelGap;
}

// 两条记录里的标签三项是否一致：改文字、把标签拖到另一个方位、把它拉近拉远，各占一项
// 单独拎出来比，是因为悬空中的元件只按这一组判断「改过标签没有」，见 commitHistory 里那一段
function labelEquals(a, b) {
  return a.label === b.label && a.labelAngle === b.labelAngle && a.labelGap === b.labelGap;
}

// 拿基准记录的位置、朝向、开关，配上当前记录的标签三项，得到一条「只差标签」的记录
// 位置沿用基准而不沿用当前，这一点是关键：悬空中的元件还没落位，
// 这一步只该改标签，绝不能把它挪到别处（它现在的位置由选区那一套管着）
function mergeLabelRecord(base, cur) {
  const rec = { type: base.type, gx: base.gx, gy: base.gy, dir: base.dir, on: base.on };
  if (cur.label !== undefined) {
    rec.label = cur.label;
    rec.labelAngle = cur.labelAngle;
    rec.labelGap = cur.labelGap;
  }
  return rec;
}

// 把元件按记录摆回原样：位置、朝向、开关，以及各种动画与拖动的残留一并归零
// 撤销与重做都走它，两个方向写的是同一套字段，不会出现「撤销干净、重做留尾巴」
function writeRecord(el, rec) {
  const oldWx = el.wx, oldWy = el.wy;   // 改坐标之前先记下旧格号，格子索引要按新旧两个格号摘挂
  el.wx = rec.gx + 0.5;   // 元件恒在格心，格号加半格就是世界坐标
  el.wy = rec.gy + 0.5;
  reindexElement(el, oldWx, oldWy);   // 位置可能被摆回别处，格子索引跟着一起挪，按格查元件才不会查空
  el.dir = rec.dir;
  el.angle = rec.dir * 90;
  el.angleTarget = el.angle;
  el.on = rec.on;
  // 标签：记录里没有 label 就说明撤销到的那一刻这个元件没有标签，文字清空、方位与距离回默认
  // 只清文字而不复位这两个量的话，下次再给它起名会突然出现在上一次拖过的那个方位与远近上
  el.labelText = rec.label === undefined ? "" : rec.label;
  el.labelAngle = rec.labelAngle === undefined ? CONFIG.labelAngleDefault : rec.labelAngle;
  el.labelGap = rec.labelGap === undefined ? CONFIG.labelGapDefault : rec.labelGap;
  el.mvOffU = 0;      // 拖动缓动的视觉偏移归零，画面与数据立刻对齐
  el.mvOffV = 0;
  el.orbitU0 = null;  // 公转起点作废，避免残留的起点被下一段公转当成自己人
  el.orbitV0 = null;
  el.deleting = false;
  el.deleteP = 0;
}

// 只把标签三项写回元件，位置、朝向、开关一律不碰
// 与 writeRecord 分开，是因为标签的改动是就地确定的，与位置无关：
// 记下这一步时那个元件可能还悬在半空，位置一动它就会跳到别处，而位置本该由选区那一套去管
function writeLabelRecord(el, rec) {
  el.labelText = rec.label === undefined ? "" : rec.label;
  el.labelAngle = rec.labelAngle === undefined ? CONFIG.labelAngleDefault : rec.labelAngle;
  el.labelGap = rec.labelGap === undefined ? CONFIG.labelGapDefault : rec.labelGap;
}

// 把元件挂回画面：数据回到列表即可；已经在列表里的只补状态，不重复插入
// 元件直接画在画布上，没有节点要挂；撤销回来的元件一律是落定状态，不会带着悬空身份复活
function attachElement(el) {
  if (S.elements.indexOf(el) < 0) {
    S.elements.push(el);
    indexElement(el);      // 挂回元件表的同时挂回格子索引，按格查元件才不会漏掉它
    S.rayGraph.dirty = true; // 下标变了，阻挡图与结算缓冲下一微帧会一起重建
  }
  el.selected = false;
  el.deleting = false;  // 撤销删除时元件可能还在播消失动画，不清掉的话动画会接着放完、把它真的摘走
  el.deleteP = 0;
  el.selP = newEased(0);  // 选中缓动重新起算，否则会从上次留下的进度接着亮
  el.litP = newEased(0);  // 灯的亮起缓动同样重新起算，撤销回来的灯不会带着上次的亮态
  el.litIn = false;       // 照到没照到由下一微帧的结算重新判定
  el.litK = -1;           // 逼下一帧重写配色，把可能残留的选中配色刷回常态
}

// 把元件从画面摘掉：数据出列表，同时从拖动组里除名
// 摘掉只是「离开画面」，元件对象还被历史里的差分引用着，撤销时原样挂回去
function detachElement(el) {
  const i = S.elements.indexOf(el);
  if (i >= 0) {
    unindexElement(el);    // 先从格子索引里退掉，它那一格随它一起离开画面
    S.elements.splice(i, 1);
    S.rayGraph.dirty = true; // 下标变了，阻挡图与结算缓冲下一微帧会一起重建
  }
  const g = S.moveGroup.indexOf(el);
  if (g >= 0) S.moveGroup.splice(g, 1);
  el.selected = false;
}

// 重建已落定对照表：只有不正在消失的元件才算电路里的人
// 悬空中的元件保留它进悬空前的记录：它只是暂时离地，位置还没定下来，不能拿它现在的位置当基准
// 每次记步与每次撤销/重做之后都要重建，否则下一次比对会拿旧样子当基准、算出假差异
// 浮动文本那张表也一并重建：文字没有「悬空」这回事，画面上的每一块就是它落定的样子
function rebuildCommittedTable() {
  const next = new Map();
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (el.deleting) continue;
    if (el.selected) {
      const prev = S.committedTable.get(el.id);
      // 悬空期间新来的（粘贴、导入）本来就不在表里，不建条目
      // 已经在表里的：位置与朝向沿用进悬空前的旧记录（取消悬空时要靠它摆回原位），但标签三项换成当前的
      // 不换的话，下一次改标签会拿一个过时的基准去比，撤销时会一次退掉两步
      if (prev !== undefined) next.set(el.id, { rec: mergeLabelRecord(prev.rec, elementToRecord(el)), el: el });
      continue;
    }
    next.set(el.id, { rec: elementToRecord(el), el: el });
  }
  S.committedTable = next;
  const nextTexts = new Map();
  for (let i = 0; i < S.texts.length; i++) nextTexts.set(S.texts[i].id, { rec: textToRecord(S.texts[i]), tx: S.texts[i] });
  S.committedTextTable = nextTexts;
}

// 记一步：把这一刻的画面与上一次落定时逐条比，差异就是这一步
// 新出现的记「挂上来」、消失的记「摘下去」、字段变了的记「从什么样变成什么样」
// 悬空与正在消失要分开看：正在消失才算离开电路，悬空只是暂时离地，既不算离开也不算新来
// 浮动文本同一套规矩，只是挂在它自己那张对照表与自己那组差分类型上
function commitHistory() {
  const ops = [];
  const seen = new Set();
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (el.deleting) continue;  // 正在消失的元件已经不算电路里的人，会被下面那条「摘下去」认领
    seen.add(el.id);
    const rec = elementToRecord(el);
    const prev = S.committedTable.get(el.id);
    if (el.selected) {
      // 悬空中的元件：位置与朝向还没定下来，整条留到落地那一刻再比 —— 对照表也要替它留着进悬空前的记录，
      // 取消悬空时要靠那份旧记录把元件摆回原位。
      // 但标签三项是就地确定的，必须单独比一次：双击元件本体写标签之前，那第一次点击就已经把它选中了，
      // 所以「选中 → 写标签」是最常见的顺序，整条跳过的话这一步永远不记，撤销看上去对标签毫无作用。
      // 更糟的是取消悬空会拿旧记录把元件摆回去，而旧记录里没有标签，于是标签被顺手抹掉、还没有一步可撤
      if (prev !== undefined && !labelEquals(prev.rec, rec)) {
        ops.push({ kind: "labelSet", el: el, before: prev.rec, after: mergeLabelRecord(prev.rec, rec) });
      }
      continue;
    }
    if (prev === undefined) ops.push({ kind: "attach", el: el, after: rec });
    else if (!recordEquals(prev.rec, rec)) ops.push({ kind: "set", el: el, before: prev.rec, after: rec });
  }
  S.committedTable.forEach(function (v, id) {
    // 消失的元件按它「离开那一刻」的样子记，而不是上一次落定的样子：
    // 它可能在悬空期间被搬动过，撤销删除时应该回到用户最后看到的位置
    if (!seen.has(id)) ops.push({ kind: "detach", el: v.el, before: elementToRecord(v.el) });
  });
  const seenTexts = new Set();
  for (let i = 0; i < S.texts.length; i++) {
    const tx = S.texts[i];
    seenTexts.add(tx.id);
    const rec = textToRecord(tx);
    const prev = S.committedTextTable.get(tx.id);
    if (prev === undefined) ops.push({ kind: "textAttach", tx: tx, after: rec });
    else if (!textRecordEquals(prev.rec, rec)) ops.push({ kind: "textSet", tx: tx, before: prev.rec, after: rec });
  }
  S.committedTextTable.forEach(function (v, id) {
    if (!seenTexts.has(id)) ops.push({ kind: "textDetach", tx: v.tx, before: textToRecord(v.tx) });
  });
  if (ops.length === 0) return;  // 没有真实变化就不占一步，免得空点一下也吃满一百步
  // 电路结构确实变了：元件缓存位图里存的是上一次的样子，整张作废，下一帧重画
  invalidateElementCache();
  S.docDirty = true;  // 画面确实变了：从这一刻起它与磁盘上的存档不再一致，列表上那一条要标出未保存
  S.docEditSeq++;     // 记下改动序号：保存时靠它判断写出去的那份之后有没有又改过
  S.historyStack.length = S.historyIndex + 1;  // 在历史中间做了新动作，后面的重做分支作废
  S.historyStack.push(ops);
  S.historyIndex = S.historyStack.length - 1;
  if (S.historyStack.length > S.HISTORY_LIMIT) { S.historyStack.shift(); S.historyIndex--; }
  rebuildCommittedTable();
}

// 执行一组差分：reverse 为真表示撤销（每条反过来做），为假表示重做
// 元件与浮动文本各有各的几条，写法一一对应：进入、退出、改字段
function applyOps(ops, reverse) {
  const list = reverse ? ops.slice().reverse() : ops;
  for (let i = 0; i < list.length; i++) {
    const op = list[i];
    if (op.kind === "attach") {
      // 正着走 = 元件进入电路，倒着走 = 退出；进入时按记录摆正，位置才不会停在别处
      if (reverse) detachElement(op.el);
      else { attachElement(op.el); writeRecord(op.el, op.after); }
    } else if (op.kind === "detach") {
      if (reverse) { attachElement(op.el); writeRecord(op.el, op.before); }
      else detachElement(op.el);
    } else if (op.kind === "textAttach") {
      if (reverse) detachText(op.tx);
      else { attachText(op.tx); writeTextRecord(op.tx, op.after); }
    } else if (op.kind === "textDetach") {
      if (reverse) { attachText(op.tx); writeTextRecord(op.tx, op.before); }
      else detachText(op.tx);
    } else if (op.kind === "textSet") {
      writeTextRecord(op.tx, reverse ? op.before : op.after);
    } else if (op.kind === "labelSet") {
      // 只改标签三项，位置与朝向一律不碰：这一条多半是元件还悬空时记下的，
      // 那种时刻它的位置由选区管着，把位置写回去会让它当场跳走
      writeLabelRecord(op.el, reverse ? op.before : op.after);
    } else {
      writeRecord(op.el, reverse ? op.before : op.after);
    }
  }
  S.rayGraph.dirty = true;  // 元件增删或字段变了，谁挡谁与激光场都得重算
  // 元件是画在缓存位图上的：撤销/重做改了场景却没作废缓存时，画面上仍是撤销前那一份，看起来像没反应
  invalidateElementCache();
  S.sceneDirty = true;
  S.docDirty = true;  // 撤销与重做同样在改画面：改完就与磁盘上那份不一样了，未保存的标记照旧要亮
  S.docEditSeq++;     // 撤销与重做也算一次改动，序号照加：它们同样改变了画面内容
}

// 撤销/重做前先把正在进行的交互收干净：拖动、拉框、拖标签、拖浮动文本、公转全部中断
// 不回退它们已经造成的画面状态，因为紧接着的撤销/重做会把画面整个摆正
function settleInteractions() {
  S.moveDragging = false;
  S.movePointerId = -1;
  S.moveDGX = 0;
  S.moveDGY = 0;
  S.moveGroup.length = 0;
  S.marqueePressing = false;
  S.marqueeActive = false;
  S.marqueePointerId = -1;
  S.labelDragging = false;
  S.labelDragActive = false;
  S.labelPointerId = -1;
  S.labelDragEl = null;
  S.textDragging = false;
  S.textDragActive = false;
  S.textPointerId = -1;
  S.textDragEl = null;
  // 原地输入中的浮动文本一并收掉，且按「放弃」收：紧接着的撤销/重做会把画面整个摆正，
  // 若在这里把它当成一次新改动记一步，就会在撤销的途中又插进一条历史
  if (S.textEditing) endTextEditing(false);
  S.orbitActive = false;
  S.orbitP = 0;
  S.orbitTurns = 0;
  for (let i = 0; i < S.elements.length; i++) {
    // 公转起点与拖动偏移只存在元件身上，不逐个清掉会留下半截姿态
    S.elements[i].orbitU0 = null;
    S.elements[i].orbitV0 = null;
    S.elements[i].mvOffU = 0;
    S.elements[i].mvOffV = 0;
  }
}

// 取消当前悬空的一批：整个悬空会话本来就不在历史里，所以这里不动历史，只是把它整个抹掉
// 原本就在电路里的元件摆回它进入悬空前的样子（位置从已落定对照表里取，对照表在悬空期间一直替它留着旧记录）；
// 悬空期间新加进来的（粘贴、导入）在对照表里查无此人，说明电路里本来就没有它，直接摘掉
// 返回 true 表示手上确实有悬空、这次按键已经被它吃掉
function cancelFloat() {
  let any = false;
  // 倒序遍历：摘掉当前项会让后面所有下标前移，倒着走不会漏掉还没处理的项
  for (let i = S.elements.length - 1; i >= 0; i--) {
    const el = S.elements[i];
    if (!el.selected || el.deleting) continue;
    any = true;
    const prev = S.committedTable.get(el.id);
    if (prev === undefined) detachElement(el);
    else writeRecord(el, prev.rec);
  }
  if (!any) return false;
  settleInteractions();
  applySelection(function () { return false; }, false);  // 走总入口统一取消选中，落位规则与平时完全一致
  return true;
}

// 撤销：手上有悬空就先把它取消（这一步不进历史），否则往回退一步
function undo() {
  if (cancelFloat()) return;
  if (S.historyIndex < 0) return;
  settleInteractions();
  applyOps(S.historyStack[S.historyIndex], true);
  S.historyIndex--;
  rebuildCommittedTable();  // 电路已经变了，对照表必须跟着换，否则下一次记步会算出假差异
  S.sceneDirty = true;
}

// 重做：与撤销对称，手上有悬空同样先取消，再往前恢复一步
function redo() {
  if (cancelFloat()) return;
  if (S.historyIndex + 1 >= S.historyStack.length) return;
  settleInteractions();
  S.historyIndex++;
  applyOps(S.historyStack[S.historyIndex], false);
  rebuildCommittedTable();
  S.sceneDirty = true;
}

// 换文档（打开文件）后历史跟着清空：换文档不是编辑动作，留着上一条电路的历史只会撤出莫名其妙的画面
function resetHistory() {
  S.historyStack = [];
  S.historyIndex = -1;
  rebuildCommittedTable();
}

