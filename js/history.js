// history.js：撤销与重做：差分记录、提交、回退与应用。
"use strict";

/* ========== 撤销 / 重做 ========== */

// 两条记录是否描述同一个元件的同一状态：类型、格号、朝向、开关全一样才算没变
function recordEquals(a, b) {
  return a.type === b.type && a.gx === b.gx && a.gy === b.gy && a.dir === b.dir && a.on === b.on;
}

// 把元件按记录摆回原样：位置、朝向、开关，以及各种动画与拖动的残留一并归零
// 撤销与重做都走它，两个方向写的是同一套字段，不会出现「撤销干净、重做留尾巴」
function writeRecord(el, rec) {
  el.wx = rec.gx + 0.5;   // 元件恒在格心，格号加半格就是世界坐标
  el.wy = rec.gy + 0.5;
  el.dir = rec.dir;
  el.angle = rec.dir * 90;
  el.angleTarget = el.angle;
  el.on = rec.on;
  el.mvOffU = 0;      // 拖动缓动的视觉偏移归零，画面与数据立刻对齐
  el.mvOffV = 0;
  el.orbitU0 = null;  // 公转起点作废，避免残留的起点被下一段公转当成自己人
  el.orbitV0 = null;
  el.deleting = false;
  el.deleteP = 0;
}

// 把元件挂回画面：数据回到列表即可；已经在列表里的只补状态，不重复插入
// 元件直接画在画布上，没有节点要挂；撤销回来的元件一律是落定状态，不会带着悬空身份复活
function attachElement(el) {
  if (elements.indexOf(el) < 0) elements.push(el);
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
  const i = elements.indexOf(el);
  if (i >= 0) elements.splice(i, 1);
  const g = moveGroup.indexOf(el);
  if (g >= 0) moveGroup.splice(g, 1);
  el.selected = false;
}

// 重建已落定对照表：只有不正在消失的元件才算电路里的人
// 悬空中的元件保留它进悬空前的记录：它只是暂时离地，位置还没定下来，不能拿它现在的位置当基准
// 每次记步与每次撤销/重做之后都要重建，否则下一次比对会拿旧样子当基准、算出假差异
function rebuildCommittedTable() {
  const next = new Map();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.deleting) continue;
    if (el.selected) {
      const prev = committedTable.get(el.id);
      if (prev !== undefined) next.set(el.id, prev);  // 悬空期间新来的（粘贴、导入）本来就不在表里，不建条目
      continue;
    }
    next.set(el.id, { rec: elementToRecord(el), el: el });
  }
  committedTable = next;
}

// 记一步：把这一刻的已落定电路与上一次落定时逐条比，差异就是这一步
// 新出现的记「挂上来」、消失的记「摘下去」、字段变了的记「从什么样变成什么样」
// 悬空与正在消失要分开看：正在消失才算离开电路，悬空只是暂时离地，既不算离开也不算新来
function commitHistory() {
  const ops = [];
  const seen = new Set();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.deleting) continue;  // 正在消失的元件已经不算电路里的人，会被下面那条「摘下去」认领
    seen.add(el.id);
    if (el.selected) continue;  // 悬空中的这一轮不比对：位置还没定下来，落地那一刻才比
    const rec = elementToRecord(el);
    const prev = committedTable.get(el.id);
    if (prev === undefined) ops.push({ kind: "attach", el: el, after: rec });
    else if (!recordEquals(prev.rec, rec)) ops.push({ kind: "set", el: el, before: prev.rec, after: rec });
  }
  committedTable.forEach(function (v, id) {
    // 消失的元件按它「离开那一刻」的样子记，而不是上一次落定的样子：
    // 它可能在悬空期间被搬动过，撤销删除时应该回到用户最后看到的位置
    if (!seen.has(id)) ops.push({ kind: "detach", el: v.el, before: elementToRecord(v.el) });
  });
  if (ops.length === 0) return;  // 没有真实变化就不占一步，免得空点一下也吃满一百步
  docDirty = true;  // 电路确实变了：从这一刻起它与磁盘上的存档不再一致，列表上那一条要标出未保存
  historyStack.length = historyIndex + 1;  // 在历史中间做了新动作，后面的重做分支作废
  historyStack.push(ops);
  historyIndex = historyStack.length - 1;
  if (historyStack.length > HISTORY_LIMIT) { historyStack.shift(); historyIndex--; }
  rebuildCommittedTable();
}

// 执行一组差分：reverse 为真表示撤销（每条反过来做），为假表示重做
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
    } else {
      writeRecord(op.el, reverse ? op.before : op.after);
    }
  }
  rayGraph.dirty = true;  // 元件增删或字段变了，谁挡谁与激光场都得重算
  sceneDirty = true;
  docDirty = true;  // 撤销与重做同样在改电路：改完就与磁盘上那份不一样了，未保存的标记照旧要亮
}

// 撤销/重做前先把正在进行的交互收干净：拖动、拉框、公转全部中断
// 不回退它们已经造成的画面状态，因为紧接着的撤销/重做会把电路整个摆正
function settleInteractions() {
  moveDragging = false;
  movePointerId = -1;
  moveDGX = 0;
  moveDGY = 0;
  moveGroup.length = 0;
  marqueePressing = false;
  marqueeActive = false;
  marqueePointerId = -1;
  orbitActive = false;
  orbitP = 0;
  orbitTurns = 0;
  for (let i = 0; i < elements.length; i++) {
    // 公转起点与拖动偏移只存在元件身上，不逐个清掉会留下半截姿态
    elements[i].orbitU0 = null;
    elements[i].orbitV0 = null;
    elements[i].mvOffU = 0;
    elements[i].mvOffV = 0;
  }
}

// 取消当前悬空的一批：整个悬空会话本来就不在历史里，所以这里不动历史，只是把它整个抹掉
// 原本就在电路里的元件摆回它进入悬空前的样子（位置从已落定对照表里取，对照表在悬空期间一直替它留着旧记录）；
// 悬空期间新加进来的（粘贴、导入）在对照表里查无此人，说明电路里本来就没有它，直接摘掉
// 返回 true 表示手上确实有悬空、这次按键已经被它吃掉
function cancelFloat() {
  let any = false;
  // 倒序遍历：摘掉当前项会让后面所有下标前移，倒着走不会漏掉还没处理的项
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el.selected || el.deleting) continue;
    any = true;
    const prev = committedTable.get(el.id);
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
  if (historyIndex < 0) return;
  settleInteractions();
  applyOps(historyStack[historyIndex], true);
  historyIndex--;
  rebuildCommittedTable();  // 电路已经变了，对照表必须跟着换，否则下一次记步会算出假差异
  sceneDirty = true;
}

// 重做：与撤销对称，手上有悬空同样先取消，再往前恢复一步
function redo() {
  if (cancelFloat()) return;
  if (historyIndex + 1 >= historyStack.length) return;
  settleInteractions();
  historyIndex++;
  applyOps(historyStack[historyIndex], false);
  rebuildCommittedTable();
  sceneDirty = true;
}

// 换文档（打开文件）后历史跟着清空：换文档不是编辑动作，留着上一条电路的历史只会撤出莫名其妙的画面
function resetHistory() {
  historyStack = [];
  historyIndex = -1;
  rebuildCommittedTable();
}

