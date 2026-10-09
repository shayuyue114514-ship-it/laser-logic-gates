// ghost.js：虚影与各类动画：虚影跟随、旋转收敛、选中缓动、灯的亮灭、拖动缓动。
"use strict";

/* ========== 虚影 ========== */

// 建虚影节点：形状取当前选中的类型，整体降低不透明度表示「尚未放置」；虚影不接收指针事件
// 手上没拿元件（选中工具）时没有形状可预览，返回 null，由调用方决定要不要挂上去
function createGhostNode() {
  const typeId = selectedTypeId();
  if (typeId === null) return null;
  const node = createElementNode(typeId, CONFIG.ghostOpacity);
  node.setAttribute("pointer-events", "none");
  return node;
}

// 把虚影换成当前选中的类型：切换选项槽时调用，虚影立即变成手上的那个元件
// 这里整体重建一只新节点而不是原地改 d 属性：换类型时描边与透明度也要跟着刷新，重建一次比逐项比对更省事
function applyGhostType() {
  if (elemLayer === null) return;  // 元件层还没建（初始化阶段）：虚影由 initElementLayer 统一建，这里跳过
  // 先摘掉旧节点：不摘的话换类型会在元件层里越堆越多
  if (ghostNode !== null) {
    if (ghostNode.parentNode === elemLayer) elemLayer.removeChild(ghostNode);
    ghostNode = null;
  }
  const node = createGhostNode();
  if (node === null) return;   // 选中工具：没有形状可预览，虚影整体收起，renderGhost 会直接跳过
  elemLayer.appendChild(node); // 追加到元件层末尾，虚影仍然压在已放置元件之上
  ghostNode = node;
}

// 每帧更新虚影：先从指针位置重算目标格心（相机可能正在平移缩放），再按「可放置 / 不可放置」两条分支推进
function updateGhost(dt) {
  // 指针不在画布内、或跑到视口外时立刻隐藏，也不做「进不去」动画
  if (!pointerInside || !isInViewport(pointerSX, pointerSY)) {
    ghostVisible = false;
    ghostRejectActive = false;
    ghostAlpha = 0;
    return;
  }
  // 手上拿的是选中工具时没有元件要预览，虚影直接收起，同样不走「进不去」动画
  if (selectedTypeId() === null) {
    ghostVisible = false;
    ghostRejectActive = false;
    ghostAlpha = 0;
    return;
  }
  const wx = cellCenterX(screenToWorldX(pointerSX));
  const wy = cellCenterY(screenToWorldY(pointerSY));

  // 分支一：目标格可放置 —— 淡入并向格心平滑靠近，同时取消可能还在走的「进不去」动画
  if (findElementAt(wx, wy) === null) {
    ghostRejectActive = false;
    ghostTWX = wx;
    ghostTWY = wy;
    // 从隐藏变为显示时直接落到目标格，避免虚影从上一个位置飞过来
    if (!ghostVisible) {
      ghostWX = ghostTWX;
      ghostWY = ghostTWY;
    }
    ghostVisible = true;
    const k = 1 - Math.exp(-CONFIG.ghostLambda * dt);
    ghostWX += (ghostTWX - ghostWX) * k;
    ghostWY += (ghostTWY - ghostWY) * k;
    // 和相机一样做吸附，否则虚影会在格心附近永远做亚像素漂移
    if (Math.abs(ghostTWX - ghostWX) < CONFIG.ghostSettle) ghostWX = ghostTWX;
    if (Math.abs(ghostTWY - ghostWY) < CONFIG.ghostSettle) ghostWY = ghostTWY;
    const kf = 1 - Math.exp(-CONFIG.ghostFadeInLambda * dt);
    ghostAlpha += (1 - ghostAlpha) * kf;
    // 指数平滑逼近而不到达，到达端直接吸附，避免永远留一丝透明
    if (ghostAlpha > 0.998) ghostAlpha = 1;
    return;
  }

  // 分支二：目标格不可放置 —— 一边朝那一格格心移动一边消失，表示这一格进不去
  // 位移与透明度共用同一条缓动进度，所以「位移走到一半」与「透明度归零」仍是同一时刻
  if (!ghostRejectActive || ghostRejectToWX !== wx || ghostRejectToWY !== wy) {
    // 首次进入、或鼠标又滑到另一个不可放置格：都从当前位置重新起算，透明度才不会跳变
    ghostRejectActive = true;
    ghostRejectP = 0;
    ghostRejectStartAlpha = ghostAlpha;
    ghostRejectFromWX = ghostWX;
    ghostRejectFromWY = ghostWY;
    ghostRejectToWX = wx;
    ghostRejectToWY = wy;
  }
  ghostVisible = false;
  // 进度按固定时长推进，帧率不同也走同样长的时间
  ghostRejectP = Math.min(1, ghostRejectP + dt / CONFIG.ghostRejectDuration);
  // 缓动值同时喂给位置和透明度：位移走完一半距离时，缓动值正好 0.5，透明度也正好归零
  const e = easeOutExpo(ghostRejectP);
  ghostWX = ghostRejectFromWX + (ghostRejectToWX - ghostRejectFromWX) * e;
  ghostWY = ghostRejectFromWY + (ghostRejectToWY - ghostRejectFromWY) * e;
  // 乘起始系数是为了中途换格时不闪一下
  ghostAlpha = ghostRejectStartAlpha * Math.max(0, 1 - 2 * e);
  if (ghostAlpha < 0.002) ghostAlpha = 0;
}

// 求「从当前角度拨到某个朝向」所需的最小增量，结果落在 (-180, 180]
// 角度是连续累积的，所以不能直接赋绝对值；这里只算最近的那条路，避免按反方向键时顺着累积角度绕一大圈
function shortestTurnTo(curAngle, dirAngle) {
  let delta = (dirAngle - (curAngle % 360)) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

// 把数字键的键位码解析成从 0 开始的槽序号，主键盘与小键盘都认；不是 1~9 就返回 -1
// 用键位码而不是键名，同样是为了避开中文输入法把字母与数字变成 "Process" 的情况
function digitKeyIndex(code) {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m === null ? -1 : Number(m[1]) - 1;
}

// 每帧把虚影朝向的角度推向目标角度：指数收敛（先快后慢），停下后吸附并归一化
function updateGhostRotation(dt) {
  const k = 1 - Math.exp(-CONFIG.rotateLambda * dt);
  ghostAngle += (ghostAngleTarget - ghostAngle) * k;
  // 指数平滑永远逼近而不到达，误差足够小就直接吸附，避免长期停在零点几度的残差上
  if (Math.abs(ghostAngleTarget - ghostAngle) < CONFIG.rotateSettle) {
    ghostAngle = ghostAngleTarget;
    // 停下后把两者一起对 360 取模：此刻两者是同一个角度，同时取模不会让画面跳变，又能防止数值无限增大
    ghostAngle = ghostAngle % 360;
    ghostAngleTarget = ghostAngleTarget % 360;
  }
}

// 每帧把每个元件的角度推向它自己的目标角度：与虚影同一套收敛和归一化，手感保持一致
function updateElementRotations(dt) {
  const k = 1 - Math.exp(-CONFIG.rotateLambda * dt);
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    // 已经静止的元件直接跳过，省掉每帧的无谓计算
    if (el.angle === el.angleTarget) continue;
    el.angle += (el.angleTarget - el.angle) * k;
    if (Math.abs(el.angleTarget - el.angle) < CONFIG.rotateSettle) {
      el.angle = el.angleTarget;
      // 停下后归一化角度，并把离散朝向索引同步成最终朝向，供后续激光逻辑读取
      el.angle = el.angle % 360;
      el.angleTarget = el.angleTarget % 360;
      el.dir = ((Math.round(el.angleTarget / 90) % 4) + 4) % 4;
      rayGraph.dirty = true;  // 朝向变了，全局阻挡属性可能随之在水平/垂直之间互换
    }
  }
}

// 每帧推进所有元件的选中缓动：目标由「是否被选中」决定，固定时长走缓出曲线，很快但不生硬
// 正在删除的元件目标直接归零，跟着淡出一起退回常态配色，不会留下半亮的样子
function updateSelectionAnim(dt) {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    stepEased(el.selP, el.selected && !el.deleting ? 1 : 0, dt, CONFIG.selectAnimDuration);
  }
}

// 每帧推进所有灯的亮起缓动：目标由「本微帧有没有被激光照到」决定，固定时长走缓出曲线
// 正在删除的灯目标直接归零，跟着淡出一起退回常态，不会留下半亮的残影
// 灯以外的元件直接跳过，省掉每帧一次无谓的 stepEased
function updateLampAnim(dt) {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.typeId !== "lamp") continue;
    stepEased(el.litP, el.litIn && !el.deleting ? 1 : 0, dt, CONFIG.lampAnimDuration);
  }
}

// 每帧推进拖动缓动：把元件的视觉偏移按指数缓出收回到 0，元件平滑滑向数据所在的格心
// 用指数收敛而不是固定时长：连续跨格时每一步都从当前偏移接着走，快拖不会一顿一顿，慢拖也跟得住
function updateMoveAnim(dt) {
  const k = 1 - Math.exp(-CONFIG.moveLambda * dt);
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.mvOffU === 0 && el.mvOffV === 0) continue;  // 已经归零的直接跳过，省掉每帧的无谓计算
    el.mvOffU *= 1 - k;
    el.mvOffV *= 1 - k;
    // 残差小于阈值就直接归零：指数收敛永远到不了 0，不吸附的话画面会一直停着一丝抖动
    if (Math.abs(el.mvOffU) < CONFIG.moveSettle) el.mvOffU = 0;
    if (Math.abs(el.mvOffV) < CONFIG.moveSettle) el.mvOffV = 0;
    sceneDirty = true;  // 视觉位置每帧都在变，必须重绘
  }
}

// 每帧把虚影摆到屏幕上；完全透明时直接隐藏节点，连 transform 都不用算
function renderGhost() {
  if (ghostNode === null) return;
  if (ghostAlpha <= 0) {
    ghostNode.style.display = "none";
    return;
  }
  ghostNode.style.display = "";
  // ghostOpacity 是虚影的不透明度上限，实际透明度再乘上淡入淡出系数
  ghostNode.setAttribute("opacity", CONFIG.ghostOpacity * ghostAlpha);
  // 用动画中的连续角度：旋转过程中虚影是斜着的，转到位才正对格子
  ghostNode.setAttribute("transform", elementTransform(ghostWX, ghostWY, ghostAngle, state.scale));
}

// 初始化元件层：建裁剪路径，再建虚影节点（虚影要盖在已放置元件之上）
function initElementLayer() {
  elemLayer = document.getElementById("elemLayer");
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.setAttribute("id", "viewportClip");
  clipRect = document.createElementNS(SVG_NS, "rect");
  clipPath.appendChild(clipRect);
  elemLayer.appendChild(clipPath);
  elemLayer.setAttribute("clip-path", "url(#viewportClip)");
  resizeElementLayer();
  // 虚影放在已放置元件之后，保证它画在最上层
  ghostNode = createGhostNode();
  if (ghostNode !== null) elemLayer.appendChild(ghostNode);
}

