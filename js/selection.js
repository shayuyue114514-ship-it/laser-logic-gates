// selection.js：选区操作：选中、框选、拖动、整批旋转与落位。
"use strict";

/* ========== 选中 ========== */

// 当前是不是「选中工具」：只有它被选中时，画布上的左键才是选择而不是放置
// 放置与选择共用一个左键，靠这个判据分流，两边不会互相抢操作
function selectToolActive() {
  return slotSelectedIndex === SELECT_SLOT_INDEX;
}

// 切换选中的选项槽：手上虚影随之换成新类型；从选中工具切走时立刻把选区收掉
// 收选区必须「立刻」而不是等下次操作：元件一直离地会让画面和数据长期不一致，用户也看不到落位结果
function setSelectedSlot(index) {
  const wasSelect = selectToolActive();
  slotSelectedIndex = index;
  if (wasSelect && !selectToolActive()) exitSelectTool();
  applyGhostType();
}

// 退出选中模式：把所有选中一并取消，离地的元件就地落位（落点上的普通元件被顶掉）
// 走 applySelection 这个总入口，落位规则与「单击空白清空选中」完全一致，不会出现两套行为
function exitSelectTool() {
  let any = false;
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].selected) { any = true; break; }
  }
  if (!any) return;  // 本来就没选中：不白跑一遍落位
  applySelection(function () { return false; }, false);
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
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.selected || el.deleting) continue;        // 还在选区里的自己人不能动；正在消失的元件不参与判定
    if (landing.indexOf(el) >= 0) continue;          // 这次落地的自己人留着
    if (!cellOccupiedBy(landing, el.wx, el.wy)) continue;  // 没有落地元件压住它这一格，留着
    elements.splice(i, 1);
    removed++;
  }
  // 真的顶掉了才需要重算：否则每一下拉框都会全量重建阻挡图，白卡一顿
  if (removed > 0) rayGraph.dirty = true;  // splice 让下标前移，阻挡图里存的下标随之失效
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
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    let sel = false;
    if (!el.deleting) {  // 删除动画中的元件不参与选中
      const hit = isHit(el);
      sel = toggle ? (hit ? !el.selBase : el.selBase) : hit;
      if (el.selected && !sel) landing.push(el);  // 离开选区，这一刻才落地
    }
    nextSel.push(sel);
  }
  for (let i = 0; i < elements.length; i++) elements[i].selected = nextSel[i];  // 先写回状态，落地时按新状态认人
  landSelection(landing);  // 只有离开选区的那些才放下；Shift 加点新元件不会把手上这批顺手提交掉
  selOrientDir = 0;  // 这一批算新选区，朝向从朝上重新起算，接着按 WASD 才是相对「朝上」转
  rayGraph.dirty = true;  // 选中集合一变，参与模拟的元件就变了，阻挡图必须按新集合重建
  sceneDirty = true;
  // 记一步：元件落地、以及落点顶掉别人，都发生在这一刻，这才是电路真正被改动的时刻
  // 拉框途中不记：每动一下都记会把一次框选拆成几十步，等松手时统一记一次
  if (!marqueeActive) commitHistory();
}

// 单击选中：命中的是指针所在那一格的元件；点空白处谁都没命中，等于清空全部选中
// 按住 Shift 时和拉框一样走翻转，点一下就在「选中」与「未选中」之间切一次
function selectAtPointer(toggle) {
  const el = findElementAtPointer();
  const hitEl = (el !== null && !el.deleting) ? el : null;  // 删除动画中的元件不算点中，避免选到一个正在消失的东西
  applySelection(function (e) { return e === hitEl; }, toggle);
}

// 框选：逐个判元件所占的格子与拉框矩形是否相交，相交即命中
// 用整格去判而不是用格心：框擦到格子边缘也算命中，和常见画图软件的手感一致
function selectInMarquee(x0, y0, x1, y1, toggle) {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const half = state.scale / 2;  // 半格在屏幕上的像素数：一格是 1×1 世界单位，所以整格宽就是当前缩放
  applySelection(function (el) {
    const cx = worldToScreenX(el.wx);
    const cy = worldToScreenY(el.wy);
    if (!(cx + half >= left && cx - half <= right && cy + half >= top && cy - half <= bottom)) return false;
    // 同一格只认最上层那个：被压住的元件不参与命中，否则一格会同时选中两个元件
    return el === topElementAtCell(el.wx, el.wy);
  }, toggle);
}

// 拉框按下：记下起点并捕获指针，这样指针移出画布甚至移出窗口也能继续收到 move
function beginMarquee(e) {
  marqueePointerId = e.pointerId;
  marqueePressing = true;
  marqueeActive = false;
  marqueeStartSX = e.clientX;
  marqueeStartSY = e.clientY;
  marqueeEndSX = e.clientX;
  marqueeEndSY = e.clientY;
  // 按下的这一刻把每个元件的选中状态存一份快照：按住 Shift 框选时的翻转以它为基准，
  // 拖动过程中选中状态一直在变，不存快照的话同一个元件会被反复翻转
  for (let i = 0; i < elements.length; i++) elements[i].selBase = elements[i].selected;
  canvas.setPointerCapture(e.pointerId);
}

// 拉框移动：超过阈值才算真的在拉框，没超过仍按单击处理，避免手一抖就拉出一个空框把选中清掉
function moveMarquee(e) {
  if (!marqueePressing || e.pointerId !== marqueePointerId) return;
  marqueeEndSX = e.clientX;
  marqueeEndSY = e.clientY;
  if (!marqueeActive) {
    const dx = marqueeEndSX - marqueeStartSX;
    const dy = marqueeEndSY - marqueeStartSY;
    if (dx * dx + dy * dy < CONFIG.marqueeThreshold * CONFIG.marqueeThreshold) return;
    marqueeActive = true;
  }
  // 边拉边亮：每动一下都按当前框重算一遍选中，框到的元件立刻提亮，缩回去的自动退回未选中
  // 与松开时用的是同一个判定，所见即所得，不会出现「预览亮着、松手结果不一样」
  // 按住 Shift 就切到翻转模式，拖动途中按下或松开 Shift 都能即时切换，不必重新拉框
  selectInMarquee(marqueeStartSX, marqueeStartSY, marqueeEndSX, marqueeEndSY, e.shiftKey);
  sceneDirty = true;  // 框要跟着指针走，每动一下都得重画
}

// 拉框松开：真拉出框了就按框选一批，否则当成一次单击（选中点中的元件，或清空选中）
// 两条路都要走，否则「按下不动再松开」会既没选中也没清空，手感很怪
// 单击时把 Shift 状态一并传下去，这样 Shift+单击也能像 Shift+框选那样翻转，两边的规则完全一致
function endMarquee(e) {
  if (marqueeActive) selectInMarquee(marqueeStartSX, marqueeStartSY, marqueeEndSX, marqueeEndSY, e.shiftKey);
  else selectAtPointer(e.shiftKey);
  marqueePressing = false;
  marqueeActive = false;
  marqueePointerId = -1;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  sceneDirty = true;
  commitHistory();  // 框选期间刻意不记步，松手这一刻把整场框选（含落位顶替）合成一步
}

// 拉框被系统打断（如触控中断）：只收状态、不动选中，免得把用户已有的选择误清掉
function cancelMarquee(e) {
  marqueePressing = false;
  marqueeActive = false;
  marqueePointerId = -1;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  sceneDirty = true;
  commitHistory();  // 框选途中已经有元件落过地，被打断也要把那些改动记下来，否则会和后面的步混成一步
}

// 按下已选中的元件：进入拖动准备态，记下起点世界坐标，并把这一批选中的元件收进拖动组
// 组里存的是元件引用而不是下标：落地时可能删掉被覆盖的元件，下标会整体前移，存下标会指错人
function beginMove(e) {
  moveDragging = true;
  movePointerId = e.pointerId;
  moveStartWX = screenToWorldX(e.clientX);
  moveStartWY = screenToWorldY(e.clientY);
  moveDGX = 0;
  moveDGY = 0;
  moveGroup.length = 0;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.selected && !el.deleting) moveGroup.push(el);  // 删除动画中的元件不带走
  }
  canvas.setPointerCapture(e.pointerId);
}

// 拖动中：按指针相对按下点的位移算出整数格位移，只把「与上次的差值」加给元件，避免每帧重复累加
// 位移取整到整格，数据始终落在格心上；画面位置另加一份缓动偏移，松手前会平滑追上，看着不硬跳
// 拖动期间相机不动，所以直接用按下时的世界坐标当基准，不必每帧换算参考点
function moveSelectionDrag(e) {
  if (!moveDragging || e.pointerId !== movePointerId) return;
  const dgx = Math.round(screenToWorldX(e.clientX) - moveStartWX);
  const dgy = Math.round(screenToWorldY(e.clientY) - moveStartWY);
  if (dgx === moveDGX && dgy === moveDGY) return;  // 还没跨到下一格：不动元件，也不必重算激光
  const stepX = dgx - moveDGX;
  const stepY = dgy - moveDGY;
  moveDGX = dgx;
  moveDGY = dgy;
  for (let i = 0; i < moveGroup.length; i++) {
    const el = moveGroup[i];
    el.wx += stepX;
    el.wy += stepY;
    // 视觉偏移反向补上这一步：数据已经跳到新格，画面先留在原处，再由 updateMoveAnim 缓出追上
    el.mvOffU -= stepX;
    el.mvOffV -= stepY;
  }
  rayGraph.dirty = true;  // 位置变了，谁挡谁的结论随之改变，下一微帧按新位置重算激光
  sceneDirty = true;      // 元件节点要摆到新格心上，强制重绘一次
}

// 松开左键：只收拖动状态，不动地图上的其他元件
// 落点顶替不在这里做——选区结束（重新确定选区）时才统一落位，拖动中途随便改主意都不会造成不可逆的破坏
// 没挪动过（原地按下又松开）就什么都不做：多选时点一下已选中的元件不该把选中收缩成一个
function endMove(e) {
  moveDragging = false;
  movePointerId = -1;
  moveDGX = 0;
  moveDGY = 0;
  moveGroup.length = 0;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  sceneDirty = true;
}

// 拖动被系统打断（如触控中断）：把元件退回原位再收状态
// 位移是整组统一的整数格位移，反向加回去即可，不需要逐个记原始坐标
function cancelMove(e) {
  for (let i = 0; i < moveGroup.length; i++) {
    const el = moveGroup[i];
    el.wx -= moveDGX;
    el.wy -= moveDGY;
    el.mvOffU = 0;  // 退回原位是「撤销」，不该留缓动尾巴，直接归零让画面与数据立刻对齐
    el.mvOffV = 0;
  }
  if (moveDGX !== 0 || moveDGY !== 0) rayGraph.dirty = true;  // 退回去了，激光要按原位重算
  moveDragging = false;
  movePointerId = -1;
  moveDGX = 0;
  moveDGY = 0;
  moveGroup.length = 0;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  sceneDirty = true;
}

// 选中元件的包围盒，用格号表示：没有选中元件时返回 null
// 元件一定在格心上，格心坐标减 0.5 就是整数格号，可以直接取整
function selectionBounds() {
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity, n = 0;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
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
  orbitPivotU = pivotU;
  orbitPivotV = pivotV;
  orbitTurns = turns;
  orbitP = 0;
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
  orbitActive = true;
  sceneDirty = true;
}

// 走一步公转：上一段还在飞就先把它的终点落位，再按当前选中的元件重新起一段
// 这样连续跨过好几格也不丢步，只是每段动画被压缩成「立即到位」
// 拖拽弧线与 WASD 都走这里，选区朝向也在这里同步推进，两条入口不会各自记一份朝向
function applyOrbitStep(step) {
  if (step === 0) return;
  if (orbitActive) finishOrbit();
  const refs = [];
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].selected && !elements[i].deleting) refs.push(elements[i]);
  }
  if (refs.length === 0) return;
  // 整批转了 step 个 90°，选区朝向跟着一起走，下次按键才是相对新朝向算要转多少
  selOrientDir = ((selOrientDir + step) % 4 + 4) % 4;
  beginOrbit(refs, rotPivotU, rotPivotV, step);
}

// 用 WASD 把整个选区转到按下的方向：上、右、下、左，整批按最短路径一起转 90° 的整数倍
// 要转多少以选区自己的朝向为准（新选区一律朝上），不是看某个元件的角度，所以整批刚体旋转、相对形状不变
// 轴心沿用拖拽弧线那套「包围盒几何中心」，每次按键按当前包围盒重算，转完再吸附回格心
// 返回 true 表示这次按键已经由选区接手；没有选中元件时返回 false，让调用方退回悬停元件 / 虚影的老逻辑
function rotateSelectionToDir(dirKey) {
  let hasSelection = false;
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].selected && !elements[i].deleting) { hasSelection = true; break; }
  }
  if (!hasSelection) return false;
  // 上一段公转还在飞就先落位，否则朝向与画面错位，整批会多转一步或少转一步
  if (orbitActive) finishOrbit();
  const steps = Math.round(shortestTurnTo(selOrientDir * 90, dirKey * 90) / 90);
  if (steps === 0) return true;  // 已经朝着这个方向：不做动作，但也不能再落到悬停元件上
  const b = selectionBounds();
  if (b === null) return true;
  rotPivotU = (b.uMin + b.uMax) / 2;
  rotPivotV = (b.vMin + b.vMax) / 2;
  applyOrbitStep(steps);
  return true;
}

// 用 WASD 把指针悬停的那个元件转到按下的方向：没有选区时的第二顺位
// 与虚影共用同一套「最短路径」算法：元件自带朝向，只拨到目标朝向，不顺着累积角度绕远路
// 转完立刻记一步：悬停旋转是就地生效的改动，不像选区那样「悬空」，不记的话撤销会跳过它去撤更早的动作
// 返回 true 表示这次按键已经由悬停元件接手；指针下没元件（空格、视口外、正在消失的）时返回 false，让调用方退回虚影
function rotateHoveredElement(dirKey) {
  if (!pointerInside) return false;
  if (orbitActive) return false;  // 整批公转还在飞：这一拍让给选区，避免同一个元件被两套旋转同时改角度
  const el = findElementAtPointer();
  if (el === null || el.deleting) return false;
  const next = el.angleTarget + shortestTurnTo(el.angleTarget, dirKey * 90);
  if (next === el.angleTarget) return true;  // 已经朝着这个方向：不做动作，但也不能再落到虚影上
  el.angleTarget = next;
  commitHistory();  // 朝向是电路的一部分（决定激光往哪边走），转一下就该占一步历史
  sceneDirty = true;  // 角度目标变了，即使画面此刻静止也要重绘一帧把旋转动画推起来
  return true;
}

// 公转推进：进度按固定时长走满，配缓出曲线，起步快、收尾慢，落位干脆
function updateOrbit(dt) {
  if (!orbitActive) return;
  orbitP += dt / CONFIG.orbitDuration;
  if (orbitP >= 1) { finishOrbit(); return; }
  sceneDirty = true;  // 元件每帧都在弧线上挪位置，必须每帧重画
}

// 公转落位：把终点写回元件数据（格心、角度、离散朝向），再让阻挡图按新位置重算
// 动画期间只改画面不改数据，所以落位这一刻才是激光真正跟着转的一刻
// 这里不顶掉落点上的其他元件：选区还在，元件仍算离地，等选区结束那一刻才统一落位
function finishOrbit() {
  const total = orbitTurns * 90;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.orbitU0 === null) continue;
    // 落点先按精确位置算，再吸附回最近的格心：轴心在半格上时这一步会把整批平移半格
    const p = orbitPoint(el.orbitU0, el.orbitV0, total);
    el.wx = Math.round(p.u) + 0.5;
    el.wy = Math.round(p.v) + 0.5;
    el.angle = el.orbitAngle0 + total;
    el.angleTarget = el.angle;
    el.dir = ((Math.round(el.angle / 90) % 4) + 4) % 4;  // 离散朝向跟着落位角度走，激光逻辑读的是它
    el.orbitU0 = null;
    el.orbitV0 = null;
    el.orbitShiftU = 0;
    el.orbitShiftV = 0;
  }
  orbitActive = false;
  orbitP = 0;
  orbitTurns = 0;
  rayGraph.dirty = true;  // 位置与朝向都变了，阻挡图和激光场必须重算
  sceneDirty = true;
}

// 把某个格号绕轴心旋转指定角度，返回旋转后的精确位置（可能落在半格上，不做取整）
// 角度永远是 90 的整数倍，这里用精确的 0/±1 代替 cos/sin：浮点算出的 cos90° 是 6.1e-17 而不是 0，
// 会让恰好卡在半格边界上的结果多出 ±1e-17，Math.round 在 .5 处就会朝两边乱跳，整批形状被撕开
function orbitPoint(u, v, angleDeg) {
  const k = ((Math.round(angleDeg / 90) % 4) + 4) % 4;  // 归一化成四个象限，绕几圈都只看余数
  const c = [1, 0, -1, 0][k];  // cos(k×90°) 的精确值
  const s = [0, 1, 0, -1][k];  // sin(k×90°) 的精确值
  const du = u - orbitPivotU;
  const dv = v - orbitPivotV;
  return { u: orbitPivotU + du * c + dv * s, v: orbitPivotV - du * s + dv * c };
}

// 画拉框：半透明填充加一圈实线，直接用屏幕坐标画，不参与相机变换
function drawMarquee() {
  if (!marqueeActive) return;
  const x = Math.min(marqueeStartSX, marqueeEndSX);
  const y = Math.min(marqueeStartSY, marqueeEndSY);
  const w = Math.abs(marqueeEndSX - marqueeStartSX);
  const h = Math.abs(marqueeEndSY - marqueeStartSY);
  ctx.save();
  ctx.fillStyle = COLOR.selectFill;
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = CONFIG.marqueeWidth;
  ctx.strokeStyle = COLOR.selectBorder;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

