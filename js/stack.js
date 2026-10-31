// stack.js：堆叠工具的设置框、实时虚影与落成。
// 点右侧工具栏的「堆叠」后，选中一批元件就能在这里设定层数、每层的整格偏移与是否逐层镜像；
// 设置框锚在视野正中的那个世界点上，随地图一起平移缩放，改动时画布上立刻显示将要叠出来的虚影。
"use strict";

/* ========== 设置框 ========== */

// 初始化设置框：外观与另外几个弹窗同源，控件只在这一处绑定，init 只跑一次
function initStackPanelDom() {
  const dom = S.stackPanelDom;
  if (dom === null) return;  // 页面里没有这个框（例如首页），初始化直接跳过
  initPopupDom(dom);         // 底板色、圆角、内边距、行高一律从 CONFIG / COLOR 注入，与设置弹窗同一套
  dom.style.width = CONFIG.stackPanelWidth + "px";
  // 三个数字框的范围由配置推出：层数至少 1，偏移不设上限但落成前会按网格夹一次
  S.stackCountInputDom.min = "1";
  S.stackCountInputDom.max = String(CONFIG.stackMaxLayers);
  S.stackCountInputDom.step = "1";
  S.stackDXInputDom.step = "1";
  S.stackDYInputDom.step = "1";
  // 输入与步进键都改同一份状态，改完统一走 refreshStackPreview
  S.stackCountInputDom.addEventListener("input", readStackInputs);
  S.stackDXInputDom.addEventListener("input", readStackInputs);
  S.stackDYInputDom.addEventListener("input", readStackInputs);
  bindStackStep("stackCountPlus", "count", 1);
  bindStackStep("stackCountMinus", "count", -1);
  bindStackStep("stackDXPlus", "dx", 1);
  bindStackStep("stackDXMinus", "dx", -1);
  bindStackStep("stackDYPlus", "dy", 1);
  bindStackStep("stackDYMinus", "dy", -1);
  // 「每次镜像」只切一个类与一个布尔，动画交给样式表那条 0.16 秒过渡
  S.stackMirrorDom.addEventListener("click", function () {
    S.stackMirrorOn = !S.stackMirrorOn;
    S.stackMirrorDom.classList.toggle("on", S.stackMirrorOn);
    refreshStackPreview();
  });
  // 「替换重叠的元件」同理：开着时副本直接顶掉目标格上原有的元件，关着时那一格跳过
  S.stackReplaceDom.addEventListener("click", function () {
    S.stackReplaceOn = !S.stackReplaceOn;
    S.stackReplaceDom.classList.toggle("on", S.stackReplaceOn);
    refreshStackPreview();
  });
  document.getElementById("btnStackCancel").addEventListener("click", function () {
    closeStackPanel();
  });
  document.getElementById("btnStackOk").addEventListener("click", confirmStack);
  // 按钮与开关不抢焦点：焦点若被它们占住，之后按回车会被浏览器当成又点了一次，键盘要留给画布与输入框
  dom.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains("btn") || e.target.classList.contains("st-step") ||
        e.target.id === "stackMirror" || e.target.id === "stackReplace" ||
        e.target.classList.contains("knob")) e.preventDefault();
  });
  syncStackPanelControls();
  setupStackPanelDrag(dom);  // 整块可以拖着走：标题与空白处都能抓，控件让给它们自己的点击
  // 指针压在设置框上时滚轮照样交给地图：框本身跟着地图走，用户不该先把指针挪出框才能缩放
  dom.addEventListener("wheel", function (e) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : 1;   // 以「行」为单位时换算成像素，与画布上的滚轮走同一条曲线
    if (e.ctrlKey || !S.wheelPanOn) {
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * CONFIG.wheelZoomRate));
      return;
    }
    // 设置里选了「滚轮平移」时，压在框上的滚轮也按平移走，与画布上的行为保持一致
    state.tAnchorSX -= e.deltaX * unit;
    state.tAnchorSY -= e.deltaY * unit;
    S.sceneDirty = true;
  }, { passive: false });
}

// 拖动整个设置框：按住框上任意非控件的位置拖，框跟着指针平移
// 控件（输入框、步进键、开关、按钮）保留各自的点击与键入，所以从它们身上按下不进入拖动
function setupStackPanelDrag(dom) {
  dom.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    if (e.target.closest("input, button, .sw")) return;  // 控件上的按下是操作控件，不是拖框
    S.stackDragging = true;
    S.stackDragPointerId = e.pointerId;
    S.stackDragStartWX = screenToWorldX(e.clientX);  // 记的是指针下的世界点：拖动按地图走，缩放时框才不会跟丢原位
    S.stackDragStartWY = screenToWorldY(e.clientY);
    S.stackDragBaseWX = S.stackDragWX;   // 以按下那一刻已积累的位移为基准，多次拖动不会互相吞掉
    S.stackDragBaseWY = S.stackDragWY;
    dom.setPointerCapture(e.pointerId);  // 指针拖到框外也继续收到 move，框不会跟丢
    dom.classList.add("dragging");
    e.preventDefault();                  // 顺带拦掉浏览器默认的文字选取
  });
  dom.addEventListener("pointermove", function (e) {
    if (!S.stackDragging || e.pointerId !== S.stackDragPointerId) return;
    S.stackDragWX = S.stackDragBaseWX + (screenToWorldX(e.clientX) - S.stackDragStartWX);
    S.stackDragWY = S.stackDragBaseWY + (screenToWorldY(e.clientY) - S.stackDragStartWY);
    updateStackPanelTransform();
  });
  // 松手与指针被系统打断都走这里：清掉拖动状态并释放捕获
  const endDrag = function (e) {
    if (!S.stackDragging || e.pointerId !== S.stackDragPointerId) return;
    S.stackDragging = false;
    S.stackDragPointerId = -1;
    dom.classList.remove("dragging");
    if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
  };
  dom.addEventListener("pointerup", endDrag);
  dom.addEventListener("pointercancel", endDrag);
}

// 把一个步进键接到某一项数值上：点一下按 delta 加减，夹到合法区间后再写回输入框
function bindStackStep(id, field, delta) {
  document.getElementById(id).addEventListener("click", function () {
    if (field === "count") S.stackCount = clampStackValue(S.stackCount + delta, 1, CONFIG.stackMaxLayers);
    else if (field === "dx") S.stackDX = clampStackValue(S.stackDX + delta, -999, 999);
    else S.stackDY = clampStackValue(S.stackDY + delta, -999, 999);
    syncStackPanelControls();
    refreshStackPreview();
  });
}

// 数值夹取：不是有限数就退回下限，避免输入框里打出「-」「e」这种半截内容时把状态写成 NaN
function clampStackValue(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

// 从三个输入框读回状态：留空或还打着半截符号时先不动，等打成一个合法数再算
// 输入框只限制层数上限；偏移允许填任意整数，落成时再按空位筛
function readStackInputs() {
  const count = Number(S.stackCountInputDom.value);
  if (Number.isFinite(count) && S.stackCountInputDom.value !== "") {
    S.stackCount = clampStackValue(count, 1, CONFIG.stackMaxLayers);
  }
  const dx = Number(S.stackDXInputDom.value);
  if (Number.isFinite(dx) && S.stackDXInputDom.value !== "") {
    S.stackDX = clampStackValue(dx, -999, 999);
  }
  const dy = Number(S.stackDYInputDom.value);
  if (Number.isFinite(dy) && S.stackDYInputDom.value !== "") {
    S.stackDY = clampStackValue(dy, -999, 999);
  }
  refreshStackPreview();
}

// 把状态写回三个输入框与那个开关：开启面板与点步进键之后都走它，画面与控件不会各说各的
function syncStackPanelControls() {
  S.stackCountInputDom.value = String(S.stackCount);
  S.stackDXInputDom.value = String(S.stackDX);
  S.stackDYInputDom.value = String(S.stackDY);
  S.stackMirrorDom.classList.toggle("on", S.stackMirrorOn);
  S.stackReplaceDom.classList.toggle("on", S.stackReplaceOn);
}

// 开或关设置框：右侧工具栏那格是开关，开着再点一下等于取消
function toggleStackPanel() {
  if (S.stackPanelOpen) closeStackPanel();
  else openStackPanel();
}

// 打开设置框：没选中元件就只报一句，不弹框
// 打开时把框锚在视野正中对应的世界点上，之后平移缩放都跟着地图走，而不是钉在屏幕上
function openStackPanel() {
  if (stackSelectedElements().length === 0) {
    showToast("未选中任何元件");
    return;
  }
  if (S.orbitActive) finishOrbit();  // 整批旋转还在飞就先落位，堆叠要按定下来的格号算
  const vp = getViewport();
  S.stackAnchorWX = screenToWorldX(vp.x + vp.w / 2);
  S.stackAnchorWY = screenToWorldY(vp.y + vp.h / 2);
  S.stackDragWX = 0;  // 每次打开都从视野正中开始，不继承上一次拖到的位置
  S.stackDragWY = 0;
  S.stackPanelOpen = true;
  S.stackPanelDom.style.display = "block";
  S.stackPanelDom.style.opacity = "1";  // .popup 默认全透明，这里直接给足，不做淡入以免多一层节奏
  // 量一次未缩放的边框尺寸：后面按「缩放后的半边」摆框，框心才能稳稳压在锚点上
  S.stackPanelW = S.stackPanelDom.offsetWidth;
  S.stackPanelH = S.stackPanelDom.offsetHeight;
  syncStackPanelControls();
  updateStackPanelTransform();
  S.sceneDirty = true;  // 虚影要跟着出现，静止时也得重绘一帧
}

// 收起设置框：只是关掉，不改任何电路数据；画布上的预览随之消失
function closeStackPanel() {
  if (!S.stackPanelOpen) return;
  S.stackPanelOpen = false;
  // 收起时如果还按着拖，把捕获与拖动状态一并清掉，免得松手事件落到不存在的东西上
  if (S.stackDragging && S.stackDragPointerId >= 0 && S.stackPanelDom.hasPointerCapture(S.stackDragPointerId)) {
    S.stackPanelDom.releasePointerCapture(S.stackDragPointerId);
  }
  S.stackDragging = false;
  S.stackDragPointerId = -1;
  S.stackPanelDom.classList.remove("dragging");
  S.stackPanelDom.style.display = "none";
  S.sceneDirty = true;
}

// 按相机把框摆到锚点上：锚点加上拖动位移，都是世界坐标里的事，于是平移缩放时框都贴着同一块地图走
// 缩放取「当前缩放 ÷ 默认缩放」；摆位直接算缩放后的左上角，不依赖百分比位移与 transform-origin 的叠加顺序
// 同时把框裁到网格视口内：框跟着地图放大时可能越出画布，不裁的话会压在上方面板与底栏上
function updateStackPanelTransform() {
  if (!S.stackPanelOpen) return;
  const sx = worldToScreenX(S.stackAnchorWX + S.stackDragWX);
  const sy = worldToScreenY(S.stackAnchorWY + S.stackDragWY);
  const k = state.scale / CONFIG.defaultScale;
  const left = sx - S.stackPanelW * k / 2;   // 缩放后的左上角：由框心减去半边宽得到
  const top = sy - S.stackPanelH * k / 2;
  S.stackPanelDom.style.transform = "translate(" + left + "px, " + top + "px) scale(" + k + ")";
  // 裁剪区在框自身的坐标里算（缩放之前）：把视口矩形换算进框的本地坐标，四边各取到框边界的距离
  // 四个值都不小于 0：视口若从框内部开始，那一边不从框外收，只从框边收
  const vp = getViewport();
  const insetL = Math.max(0, (vp.x - left) / k);
  const insetT = Math.max(0, (vp.y - top) / k);
  const insetR = Math.max(0, S.stackPanelW - (vp.x + vp.w - left) / k);
  const insetB = Math.max(0, S.stackPanelH - (vp.y + vp.h - top) / k);
  S.stackPanelDom.style.clipPath =
    "inset(" + insetT + "px " + insetR + "px " + insetB + "px " + insetL + "px)";
}

// 改动设置后请一帧重画：预览虚影与框中读数都要立刻反映
function refreshStackPreview() {
  S.sceneDirty = true;
}

/* ========== 选中的那一批 ========== */

// 取当前选中的元件：删除动画中的不算，正在公转的已在打开面板时落位
function stackSelectedElements() {
  const list = [];
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (el.selected && !el.deleting) list.push(el);
  }
  return list;
}

/* ========== 堆叠方案 ========== */

// 按当前设置算出「多出来的那几层」会落在哪些格子上：只返回真正能放下的位置
// 第一层就是原来那一批，所以从第 2 层算起；每层整体平移「层序 × 偏移」，奇数层再整体左右翻一次
// 一格最多一个元件：本层目标格上是原来那批、或已经被前面几层占了，就跳过这一格
// 开着「替换重叠的元件」时，目标格上原有的其他元件不再跳过，而是记下来，落成时直接摘掉换成副本
function stackPlan() {
  const base = stackSelectedElements();
  if (base.length === 0) return [];
  // 原来那一批的格号范围：镜像按它的中线翻，形状才不会被越翻越偏
  let uMin = Infinity, uMax = -Infinity;
  for (let i = 0; i < base.length; i++) {
    const u = Math.round(base[i].wx - 0.5);
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
  }
  const mirrorLine = uMin + uMax;  // 翻折时 u 换成「mirrorLine - u」，整数格号仍落在整数格号上
  const used = new Set();          // 本次已经排进去的格子：同一层里两件东西不会叠到一格
  // 原来那批悬空时的格子先占住：偏移为零时副本会盖在原件上，落成时原件落地会把它们顶掉，等于白发一份
  for (let i = 0; i < base.length; i++) {
    used.add(Math.round(base[i].wx - 0.5) + "," + Math.round(base[i].wy - 0.5));
  }
  const plan = [];                 // Array<Object>：{wx, wy, dir, typeId, src}，落成时照它建元件
  const layers = Math.max(1, Math.min(CONFIG.stackMaxLayers, S.stackCount));
  for (let layer = 1; layer < layers; layer++) {
    const mirror = S.stackMirrorOn && (layer % 2 === 1);
    for (let i = 0; i < base.length; i++) {
      const el = base[i];
      let u = Math.round(el.wx - 0.5) + layer * S.stackDX;
      let v = Math.round(el.wy - 0.5) + layer * S.stackDY;
      let dir = el.dir;
      if (mirror) {
        u = mirrorLine - u + layer * S.stackDX * 2;  // 先按中线翻，再补回被一起翻掉的那段层偏移
        dir = MIRROR_DIR_H[dir];
      }
      const wx = u + 0.5;
      const wy = v + 0.5;
      const key = u + "," + v;
      if (used.has(key)) continue;                      // 原来那批的格子、或本次前面几层已占的格子：副本放不进去
      const occupied = topElementAtCell(wx, wy);        // 这一格上现有的元件；替换模式下它会被副本顶掉
      if (occupied !== null && !S.stackReplaceOn) continue;  // 没开替换时，有东西就跳过这一格
      used.add(key);
      plan.push({ wx: wx, wy: wy, dir: dir, typeId: el.typeId, src: el, replace: occupied });
    }
  }
  return plan;
}

/* ========== 实时虚影 ========== */

// 画堆叠虚影：半透明填充加虚线描边，与选中态提亮的实心轮廓明显不同
// 只画真正会落成的那几格，所以框里读数一改，画面上立刻能看出哪些位置放得下、哪些被占了
function drawStackPreview() {
  if (!S.stackPanelOpen) return;
  const plan = stackPlan();
  if (plan.length === 0) return;
  const vp = getViewport();
  S.ctx.save();
  // 与元件一样裁到视口内：网格外的预览不该压到上方面板或底部栏上
  S.ctx.beginPath();
  S.ctx.rect(vp.x, vp.y, vp.w, vp.h);
  S.ctx.clip();
  S.ctx.globalAlpha = CONFIG.stackPreviewAlpha;
  S.ctx.fillStyle = hslCss(elementHSL.fill);
  S.ctx.strokeStyle = COLOR.selectBorder;
  S.ctx.lineWidth = CONFIG.elementStroke;
  S.ctx.lineJoin = "round";
  S.ctx.setLineDash([CONFIG.stackPreviewDashOn, CONFIG.stackPreviewDashOff]);
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    S.ctx.save();
    S.ctx.translate(worldToScreenX(p.wx), worldToScreenY(p.wy));
    S.ctx.scale(state.scale, state.scale);        // 路径按世界单位建，这里统一放大到屏幕
    S.ctx.rotate(p.dir * 90 * Math.PI / 180);
    const path = elementPathObject(p.typeId);
    S.ctx.stroke(path);                            // 先描边后填充，与原元件同一套画法
    S.ctx.fill(path);
    S.ctx.restore();
  }
  S.ctx.restore();
}

/* ========== 落成 ========== */

// 把一格上原有的元件直接摘掉：替换是该格立刻换人，不留删除动画
// 先退出格子索引再摘出元件表，否则按格查元件还会查到已经不存在的它
function removeElementInstant(el) {
  unindexElement(el);
  const i = S.elements.indexOf(el);
  if (i >= 0) S.elements.splice(i, 1);
  S.rayGraph.dirty = true;  // 下标前移，阻挡图必须重建
}

// 点「确认」：把预览里的那几层真正建成元件，再让原来那批落地，整件事合成一步撤销
// 原件落地走选区总入口：它会按当时的新集合重算激光、作废缓存位图，并只记一次历史
function confirmStack() {
  const plan = stackPlan();
  const baseCount = stackSelectedElements().length;  // 原件个数要在落地前数，落地之后选区就空了
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    if (p.replace !== null) removeElementInstant(p.replace);  // 目标格上原有的元件先让位，副本才放得进去
    const el = placeElement(p.wx, p.wy, p.dir, p.typeId);
    // 标签与光源开关是元件自身的属性，复制过去的还是同一个元件的样子
    el.labelText = p.src.labelText;
    el.labelAngle = p.src.labelAngle;
    el.labelGap = p.src.labelGap;
    el.on = p.src.on;
  }
  closeStackPanel();
  if (plan.length === 0) {
    // 开了替换就不会因为「有东西占着」而放不下，剩下的空方案只有层数为一、或偏移为零与原位置完全重合
    showToast(S.stackReplaceOn ? "没有新增元件" : "没有可放置的空位");
    return;
  }
  applySelection(function () { return false; }, false);  // 原来那批就地落下，元件就此全部真实存在
  showToast("已堆叠 " + (plan.length + baseCount) + " 个元件");
}
