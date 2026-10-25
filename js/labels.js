// labels.js：元件标签：含它的绘制、命中、绕元件拖动，以及改文字的那个小输入框。
// 标签是元件的一个属性，不是独立物件：它没有自己的坐标，位置由「绕元件中心的方位角」算出来，
// 所以元件被拖动、旋转、删除时标签都跟着走，不存在「标签放偏了、再也找不到」这回事。
// 另一类画布文字是浮动文本，见 texts.js：那是自由摆放的独立物件，它的输入是铺在画布上的原地编辑。
"use strict";

/* ========== 元件标签的几何 ========== */

// 标签文字按换行符切成若干行：元件标签恒为一行，这里切一次是为了让排版那几处共用同一套逻辑
function splitLabelLines(text) {
  return text.split("\n");
}

// 标签文字的实测尺寸：字号跟着缩放一起变，所以按「文字 + 字号」缓存，两者都没变就直接复用
// 绘制、命中、拖动三处共用它，三边算出来的范围必然一致，不会出现「看得见却点不中」
// 逐帧对每个带标签的元件量一遍文字在元件多时是纯浪费：量一次的结果存回元件身上，缩放不动就一直是同一个数
function elementLabelSize(el) {
  const fontPx = CONFIG.labelFontSize * state.scale;
  const hit = el.labelSize;
  if (hit !== null && hit.text === el.labelText && hit.fontPx === fontPx) return hit.size;
  const lineH = fontPx * CONFIG.labelLineHeight;
  const lines = splitLabelLines(el.labelText);
  ctx.save();
  ctx.font = fontPx + "px " + UI_FONT;   // 量宽度前必须先设字体，否则量到的是上一次留在上下文里的字体
  let w = 0;
  for (let i = 0; i < lines.length; i++) {
    const lw = ctx.measureText(lines[i]).width;
    if (lw > w) w = lw;
  }
  ctx.restore();
  const size = { w: w, h: lineH * lines.length, fontPx: fontPx, lineH: lineH, lines: lines };
  el.labelSize = { text: el.labelText, fontPx: fontPx, size: size };
  return size;
}

// 文字外框在它那个方位上的支撑长度：从格心沿这个方位往外量，量到外框边界时的那一段长度
// 这个长度正好就是「文字中心到格心的距离」比「文字最近点到格心的距离」多出来的那一截
// 矩形在某个方向上的支撑长度等于 |ux|*半宽 + |uy|*半高，这是矩形自身的性质，不必真去求最近点
// 屏幕 Y 向下，这个方位对应的单位向量是 (sin, -cos)，所以取 |sin|*半宽 + |cos|*半高
// 结果再除以缩放换成世界单位：外框的像素宽高与字号都随缩放一起变，两者相除恰好把这个缩放消掉，
// 于是这个值在任何缩放下都一样，标签与元件之间那道空隙的观感不会随缩放而变
function elementLabelSupport(el, size) {
  const rad = el.labelAngle * Math.PI / 180;
  return (Math.abs(Math.sin(rad)) * size.w + Math.abs(Math.cos(rad)) * size.h) / 2 / state.scale;
}

// 标签中心的屏幕位置：以元件格心为圆心，方位角定方向，半径是「最近点距离 + 支撑长度」
// 元件里存的是最近点到格心的距离（见 CONFIG.labelGapDefault 那段），所以字长字短都一样贴，
// 不会出现「字越长看着离元件越远」；这一步加上支撑长度，只是把那个距离换算成中心该在的位置
// 方位角与元件朝向是同一套（0 上、90 右、180 下、270 左），所以「默认在正下方」就是 180
// 屏幕 Y 向下、世界 Y 向上，所以纵向取负余弦：方位角为 0 时锚点落在元件的正上方
// 位置取的是画面的视觉位置（数据位置加上拖动缓动偏移），所以标签跟着元件一起滑，不会和数据先跑
function elementLabelAnchor(el, size) {
  const rad = el.labelAngle * Math.PI / 180;
  const rPx = (el.labelGap + elementLabelSupport(el, size)) * state.scale;
  return {
    x: worldToScreenX(el.wx + el.mvOffU) + Math.sin(rad) * rPx,
    y: worldToScreenY(el.wy + el.mvOffV) - Math.cos(rad) * rPx
  };
}

// 标签在屏幕上的外框：整块文字以锚点为中心，这样绕元件转的时候文字是绕着锚点转的，不会越转越偏
function elementLabelBox(el) {
  const size = elementLabelSize(el);
  const a = elementLabelAnchor(el, size);
  return {
    x: a.x - size.w / 2, y: a.y - size.h / 2, w: size.w, h: size.h,
    fontPx: size.fontPx, lineH: size.lineH, lines: size.lines
  };
}

// 这个元件此刻有没有标签要画：正在消失的不画，文字为空的也不画
function elementHasLabel(el) {
  return !el.deleting && el.labelText !== "";
}

/* ========== 元件标签的绘制 ========== */

// 画所有元件标签：跟在元件之后画，压在元件之上，所以标签不会被元件图形盖住
// 不做任何基于缩放的隐藏：缩多小就画多大，唯一的跳过是视口剔除与空标签
// 也不做「字太小就改画一个灰块」：那样会在某个阈值上突然从深浅不匀的一片变成整齐的方块；
// 而字号连续变小时，字形本来就按覆盖面积算像素亮度，这份亮度差别正是「这里有字」的信息
function drawElementLabels(vp) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.x, vp.y, vp.w, vp.h);  // 裁剪到视口：标签不会画到上方面板与底栏上
  ctx.clip();
  ctx.fillStyle = COLOR.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // 所有标签共用一个字号，所以字体只在这里设一次：逐块重设字体是这一趟里最贵的动作
  ctx.font = (CONFIG.labelFontSize * state.scale) + "px " + UI_FONT;
  const pad = CONFIG.labelHitPad;
  // 只走活跃表：有标签的元件必定在表里（判据里就带着「标签文字非空」这一条），十万个元件里其余的不必每帧再筛一遍
  let labelN = 0;   // 探针读数：这一帧真正画出来的标签块数
  for (let i = 0; i < activeEls.length; i++) {
    const el = activeEls[i];
    if (!elementHasLabel(el)) continue;
    const b = elementLabelBox(el);
    // 视口剔除：整块文字都在视口外就跳过，连绘制都不提交
    if (b.x + b.w + pad < vp.x || b.x - pad > vp.x + vp.w ||
        b.y + b.h + pad < vp.y || b.y - pad > vp.y + vp.h) continue;
    // 删除动画：文字跟着元件一起淡出，不会留下半透明的字挂在原地
    ctx.globalAlpha = el.deleting ? 1 - easeOutCubic(el.deleteP) : 1;
    for (let k = 0; k < b.lines.length; k++) {
      if (b.lines[k] === "") continue;  // 空行不画字，但仍占一行高度：多行文字里的空行是有意义的
      ctx.fillText(b.lines[k], b.x + b.w / 2, b.y + b.lineH * (k + 0.5));
    }
    labelN++;
  }
  ctx.globalAlpha = 1;  // 透明度是上下文状态，用完必须还原，否则会漏给后面的绘制
  ctx.restore();
  pval("标签", labelN);   // 探针读数：画了多少块标签，对应上面这趟文字绘制的规模
}

/* ========== 元件标签的命中 ========== */

// 指针下的标签：返回挂着这块标签的那个元件，没有就返回 null
// 命中区比文字外框外扩几像素，字小的时候也点得中，不必先放大再去抓
// 多个标签重叠时取后画的那个（画在最上面的那一块），与「看到谁在最上面就命中谁」一致
function labelAtPointer(sx, sy) {
  const pad = CONFIG.labelHitPad;
  let hit = null;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!elementHasLabel(el)) continue;
    const b = elementLabelBox(el);
    if (sx >= b.x - pad && sx <= b.x + b.w + pad && sy >= b.y - pad && sy <= b.y + b.h + pad) hit = el;
  }
  return hit;
}

/* ========== 元件标签的拖动 ========== */

// 按下标签：进入「按住了」状态，并记下此刻的方位与距离，供拖动被系统打断时摆回原处
// 此刻先不挪标签：双击标签是要改文字，若按下就把标签摆到指下的方位，双击的第一下会把它抖歪
function beginLabelDrag(e, el) {
  labelDragging = true;
  labelDragActive = false;
  labelPointerId = e.pointerId;
  labelDragEl = el;
  labelDragStartSX = e.clientX;
  labelDragStartSY = e.clientY;
  labelDragFromAngle = el.labelAngle;
  labelDragFromGap = el.labelGap;
  canvas.setPointerCapture(e.pointerId);
}

// 拖动标签：方位角与距离一起跟着指针走，等于让标签在元件身旁那一圈浅环里挪动
// 方位角直接取「指针在元件格心的哪个方向」，所以标签落在指针所在的那个方位上，拖到哪就是哪
// 距离取「指针离格心多远，减去文字外框自己占掉的那一截」，剩下的正是文字最近点到格心的距离，
// 再夹到 CONFIG 给的那个区间里。减去支撑长度这一步是关键：不减的话，字越长标签就被推得越远
// 指针要移过与拉框同一个阈值才真的开始挪：不设这一关的话，手一抖就会把标签挪偏一两度
// 方位角按需吸附：按住 Shift 吸附到 45° 的整数倍，与大多数画图软件的习惯一致
// 默认不吸附：密集布局里固定那几个方向可能全被邻居占住，连续的角度反而总能找到空隙
function moveLabelDrag(e) {
  if (!labelDragging || e.pointerId !== labelPointerId || labelDragEl === null) return;
  if (!labelDragActive) {
    const mdx = e.clientX - labelDragStartSX;
    const mdy = e.clientY - labelDragStartSY;
    if (mdx * mdx + mdy * mdy < CONFIG.marqueeThreshold * CONFIG.marqueeThreshold) return;
    labelDragActive = true;  // 移过阈值，从这一刻起才算真的在拖
  }
  const el = labelDragEl;
  const dx = e.clientX - worldToScreenX(el.wx + el.mvOffU);   // 指针相对元件格心的横向屏幕差
  const dy = e.clientY - worldToScreenY(el.wy + el.mvOffV);   // 纵向屏幕差
  const distPx = Math.sqrt(dx * dx + dy * dy);
  if (distPx <= 0.001) return;  // 指针正好落在元件格心：方位角没有意义，保持原样
  // 方位角：0 上、90 右、180 下、270 左。屏幕 Y 向下，所以要拿负的 dy 才是「向上为 0」
  let a = Math.atan2(dx, -dy) * 180 / Math.PI;
  a = ((a % 360) + 360) % 360;  // 归一化到 0~360：负角与转满一圈都以正区间记，写进存档才是稳定的
  if (e.shiftKey) a = (Math.round(a / 45) * 45) % 360;
  el.labelAngle = a;
  // 距离：按新方位量出文字外框占掉的那一截，从指针半径里减掉，剩下的才是该留给空隙的那一段
  // 先写方位再量支撑长度，因为支撑长度本身是随方位变的（横着放和竖着放占掉的宽度不同）
  const size = elementLabelSize(el);
  const gap = distPx / state.scale - elementLabelSupport(el, size);
  el.labelGap = Math.min(CONFIG.labelGapMax, Math.max(CONFIG.labelGapMin, gap));
  sceneDirty = true;  // 标签位置变了，静止时也得重绘一帧才看得到
}

// 松开标签：收状态并记一步；方位或距离变了，撤销要能把标签摆回原处
function endLabelDrag(e) {
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  const moved = labelDragEl;
  labelDragging = false;
  labelDragActive = false;
  labelPointerId = -1;
  labelDragEl = null;
  sceneDirty = true;
  // 记一步由 commitHistory 自己比对：按下没动就松开时它什么都不记，不会白占一步
  if (moved !== null) commitHistory();
}

// 拖动被系统打断（如触控中断）：把标签摆回原处再收状态，与拖动元件被打断时的处理一致
function cancelLabelDrag(e) {
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (labelDragEl !== null) {
    labelDragEl.labelAngle = labelDragFromAngle;
    labelDragEl.labelGap = labelDragFromGap;
  }
  labelDragging = false;
  labelDragActive = false;
  labelPointerId = -1;
  labelDragEl = null;
  sceneDirty = true;
}

/* ========== 改标签文字的输入框 ========== */

// 把焦点交给输入框并全选：立刻抢一次，再在下一帧补抢一次
// 这一下点击还在处理中，浏览器随后可能把焦点还给画布；少了后面那一帧，
// 用户会看到框弹出来了却打不进字，必须先手动点一下框才行
function focusLabelEditorInput() {
  labelEditorInputDom.focus();
  labelEditorInputDom.select();
  requestAnimationFrame(function () {
    // 期间用户可能已经把框关掉了（例如按了 Esc），所以这一帧要再确认一次它还开着
    if (!labelEditorOpen) return;
    labelEditorInputDom.focus();
    labelEditorInputDom.select();
  });
}

// 打开输入框：把当前文字填进去并全选，焦点交给输入框
function openLabelEditor(el) {
  labelEditorEl = el;
  labelEditorInputDom.value = el.labelText;
  labelEditorOpen = true;
  focusLabelEditorInput();
}

// 关掉输入框并作答：ok 为真表示把框里的文字写回元件，为假表示放弃这次改动
// 文字清空即删掉标签：这是「怎么取消一个标签」最自然的做法，不必再单独做一个删除按钮
function closeLabelEditor(ok) {
  const el = labelEditorEl;
  labelEditorOpen = false;
  labelEditorEl = null;
  if (!ok || el === null) return;   // 放弃改动：元件上的文字一动没动，连一步历史都不必记
  const text = labelEditorInputDom.value.trim();  // 首尾空白去掉：误敲的空格不该变成一段「看不见的标签」
  if (text === el.labelText) return;              // 文字没变就不记步，免得空改一次也占掉一步撤销
  el.labelText = text;
  commitHistory();  // 改文字就是在改存档内容，改完就该能撤销
  sceneDirty = true;
}

// 输入框里的键盘：回车确定、Esc 放弃
// 两个键都在这里拦下并停止冒泡：否则它们会继续传到窗口，被画布那套快捷键当成一次别的操作
function onLabelEditorKeydown(e) {
  if (e.code === "Enter" || e.code === "NumpadEnter") {
    e.preventDefault();
    e.stopPropagation();
    closeLabelEditor(true);
  } else if (e.code === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeLabelEditor(false);
  }
}

// 每帧把输入框同步到画面：只动透明度，不动位置
// 特意不加位移：这个弹窗靠 CSS 的 translate(-50%, -50%) 居中，再写 transform 会把居中整个覆盖掉
function renderLabelEditor() {
  const p = labelEditorAnim.cur;
  if (!labelEditorOpen && p <= 0.001) {
    if (labelEditorDom.style.display !== "none") labelEditorDom.style.display = "none";
    return;
  }
  // 显示时必须写成 flex：这一层的内部布局要靠弹性布局纵向排开，样式表里的 .popup 是 display:none，
  // 若只把内联样式清空，读回来的还是 none，框会「开了却看不见」
  if (labelEditorDom.style.display !== "flex") labelEditorDom.style.display = "flex";
  labelEditorDom.style.opacity = p;
}

// 初始化输入框：外观从 CONFIG / COLOR 注入，与另外几个弹窗同一套，只做一次
// 键盘只接在这个输入框自己身上：Enter 确定、Esc 放弃，两条都不必再回到全局键盘那条通道里去判
function initLabelEditorDom() {
  labelEditorDom.style.width = CONFIG.confirmPanelW + "px";
  labelEditorDom.style.padding = CONFIG.settingsPanelPadY + "px " + CONFIG.settingsPanelPadX + "px";
  labelEditorDom.style.borderRadius = CONFIG.settingsPanelRadius + "px";
  labelEditorDom.style.background = COLOR.tipFill;     // 与另外四个弹窗同色：都是浮在网格上的浅蓝底板
  labelEditorDom.style.borderColor = COLOR.tipBorder;  // 与面板、视口边框同色，整页仍是同一套外框
  labelEditorDom.style.color = COLOR.tipDesc;
  labelEditorDom.style.fontSize = CONFIG.settingsPanelFontSize + "px";
  labelEditorInputDom.style.color = COLOR.labelText;   // 框里的字用画布上那个近黑，所见即所得
  labelEditorInputDom.addEventListener("keydown", onLabelEditorKeydown);
  // 抬起同样拦下：全局键盘那条通道里也有 keyup，不让它跟着处理一次
  labelEditorInputDom.addEventListener("keyup", function (e) { e.stopPropagation(); });
  btnLabelOkDom.addEventListener("click", function () { closeLabelEditor(true); });
  btnLabelCancelDom.addEventListener("click", function () { closeLabelEditor(false); });
  // 按下按钮时不让它抢走焦点：与另外四个弹窗同一套处理，否则输入框会失焦、光标位置也丢了
  labelEditorDom.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains("btn")) e.preventDefault();
  });
}

// 双击画布时该改谁的标签：点在标签上就改那块标签对应的元件，点在元件上就改这个元件，都没有就不响应
// 两条路都归到同一个输入框，用户不必分清自己点的是文字还是图形
function beginLabelEditingAtPointer() {
  const el = labelAtPointer(pointerSX, pointerSY);
  if (el !== null) { openLabelEditor(el); return true; }
  const hovered = findElementAtPointer();
  if (hovered !== null && !hovered.deleting) { openLabelEditor(hovered); return true; }
  return false;
}
