// texts.js：浮动文本：摆在画布上的自由说明文字，含它的排版、Markdown 轻量着色、命中、拖动与增删。
// 它与元件、与激光都没有关系，也不吸附网格：位置是连续的世界坐标，可以拖到任意地方。
// Markdown 只做「染色加略微缩放」，一个字符都不删：标题前面的井号照样留着，所以改完样式随时能改回内容。
"use strict";

/* ========== 数据 ========== */

// 在指定世界坐标放一块浮动文本：坐标是这块文字的左上角（屏幕意义上的左上角）
// mCache 是排版结果的缓存，null 表示还没算过；它只跟着缩放与文字变，所以键就用这两样
function placeText(wx, wy, text) {
  const tx = {
    id: nextTextId++, wx: wx, wy: wy, text: text, mCache: null,
    // 下面这几项是选中用的：浮动文本也进选区，跟着元件一起被拖动、删除
    // 它不占格子，所以没有「离地 / 落位」这回事：选中对它只意味着「接下来这一批操作要带上它」
    selected: false,   // boolean：是否在选区里
    selBase: false,    // boolean：拉框按下那一刻的选中快照，按住 Shift 框选时以它为基准翻转
    selPreview: null,  // boolean | null：拉框途中的预览，true 会选上、false 会取消、null 表示没在预览
    selP: newEased(0), // Object：选中高亮的缓动进度标量，与元件同一档时长，选中与落选都不会硬跳
    mvOffU: 0,         // number：跟着选区拖动时的视觉偏移 u（世界单位），与元件的拖动缓动同一套
    mvOffV: 0          // number：同上，v
  };
  texts.push(tx);
  sceneDirty = true;
  return tx;
}

// 转成一条存档记录：坐标按世界坐标原样存，文字原样存
// 不取整也不吸附：这块文字本来就不在网格上，四舍五入反而会让读档后的位置和存下去时不一样
function textToRecord(tx) {
  return { x: tx.wx, y: tx.wy, text: tx.text };
}

// 两条文本记录是否描述同一状态：位置与文字全一样才算没变
function textRecordEquals(a, b) {
  return a.x === b.x && a.y === b.y && a.text === b.text;
}

// 把记录写回文本：撤销与重做都走它，两个方向写的是同一套字段
function writeTextRecord(tx, rec) {
  tx.wx = rec.x;
  tx.wy = rec.y;
  tx.text = rec.text;
}

// 把文本挂回画面：已经在列表里的只补状态，不重复插入
// 文本直接画在画布上，没有节点要挂
function attachText(tx) {
  if (texts.indexOf(tx) < 0) texts.push(tx);
}

// 把文本从画面摘掉：对象还被历史里的差分引用着，撤销时原样挂回去
function detachText(tx) {
  const i = texts.indexOf(tx);
  if (i >= 0) texts.splice(i, 1);
}

// 删除屏幕位置所在的那块浮动文本：视口外、或这里没有文本，都直接忽略
// 返回 true 表示这一次右键已经由浮动文本接手，调用方不必再去删指针所在格的元件
// 不进删除动画：文字是一块静态说明，直接消失比淡出更干净，也省掉一套只有它用的动画状态
function deleteTextAtScreen(screenX, screenY) {
  if (!isInViewport(screenX, screenY)) return false;
  const tx = textAtPointer(screenX, screenY);
  if (tx === null) return false;
  detachText(tx);
  sceneDirty = true;
  commitHistory();  // 摘掉这一刻它就已经不在画面上了，所以在这里记步
  return true;
}

// 删除选区里的全部浮动文本：文字不进删除动画，直接摘掉，与右键单独删一块的观感一致
// 倒序遍历：摘除用的是 splice，倒着走不会漏掉还没处理的项
// 返回是否真的删掉了东西，供 deleteSelection 汇总「这次按键有没有被选区接手」
function deleteSelectedTexts() {
  let any = false;
  for (let i = texts.length - 1; i >= 0; i--) {
    if (!texts[i].selected) continue;
    detachText(texts[i]);
    any = true;
  }
  if (any) sceneDirty = true;
  return any;
}

/* ========== Markdown 轻量着色 ========== */

// 行内标记：粗体、行内代码、斜体
// 用「成对匹配」而不是「见到就翻转」：这样单个星号（比如 2*3）不会被当成斜体标记，缺一半的标记也不会跑偏
// 匹配到的整段连两端的标记一起着色：标记本身就是文字的一部分，一个字符都不能删
// 斜体只认星号，不认下划线：下划线在标识符里到处都是（比如 snake_case），认它会把这半截词染成斜体
const MD_INLINE = /\*\*([\s\S]+?)\*\*|`([^`]+)`|\*([^*\n]+?)\*/;

// 把一行文字切成若干段，每段带自己的样式；不认识的写法一律当普通文字
// 只认三种行内标记，其余一概不实现：表格、单独一行的 --- 或 ***、三个反引号的代码围栏都不做，
// 因为那几种会把文字变成另一种东西（分栏、横线、方块），而这个功能的前提是只改样式、不改变性质
function mdLineSpans(line) {
  const spans = [];
  let rest = line;
  while (rest !== "") {
    const m = MD_INLINE.exec(rest);
    if (m === null) { spans.push({ text: rest, bold: false, italic: false, code: false }); break; }
    if (m.index > 0) spans.push({ text: rest.slice(0, m.index), bold: false, italic: false, code: false });
    spans.push({
      text: m[0],
      bold: m[1] !== undefined,      // **粗体**
      code: m[2] !== undefined,      // `行内代码`
      italic: m[3] !== undefined     // *斜体*
    });
    rest = rest.slice(m.index + m[0].length);
  }
  return spans;
}

// 整行的样式：井号开头的算标题，按井号个数决定行字号；尖括号开头的算引用，整行换浅一档的颜色
// 井号后面必须跟一个空白（或整行只有井号）才算标题：否则 #FF0000 这种颜色值会被误当成标题
// 标记本身一个字都不删：井号与尖括号原样留在行首，它们只是被一起染了色、一起缩放了而已
function mdLineStyle(line) {
  const h = /^(#{1,6})(?=\s|$)/.exec(line);
  if (h !== null) return { head: h[1].length, quote: false };
  if (line.charAt(0) === ">") return { head: 0, quote: true };
  return { head: 0, quote: false };
}

// 一段文字该用什么颜色：标题取深蓝、引用取浅一档的深灰蓝、行内代码取中深蓝，其余取正文那个近黑
// 四个色都不另配：一律回读 COLOR 里已有的那一套，画布上的文字与面板文字因此天然同色系
function mdSpanColor(span, st) {
  if (st.head > 0) return COLOR.tipName;
  if (st.quote) return COLOR.tipDesc;
  if (span.code) return COLOR.selectBorder;
  return COLOR.labelText;
}

// 一段文字的字体制式：倾斜与加粗各自决定要不要写进字体简写
// 字体仍只用 MiSans 那两档字重（400/700），加粗取 700；项目里没有单独的斜体字面，斜体由浏览器合成倾斜
function mdFontCss(span) {
  return (span.italic ? "italic " : "") + (span.bold ? "700 " : "") + span.fontPx + "px " + UI_FONT;
}

/* ========== 排版 ========== */

// 一块浮动文本的排版结果（与它摆在哪无关的那一半）：每行拆成若干段，各段带自己的字号、颜色、宽度与横向起点
// 结果缓存在元件对象上，键是「缩放 + 文字」：这两样不变就不必重量一遍
// 为什么要缓存：命中与提示每帧都要问一次「指针下有没有文字」，不缓存的话每帧会把所有文字的宽度量两遍，
// 而量宽度（measureText）是这条链上最贵的一步，几十块文字乘十几段就会明显拖慢每一帧
// 缓存字段不进存档也不进历史：转记录时只取位置与文字，这个字段是纯派生的中间结果
function textBlockMetrics(tx) {
  const key = state.scale + "\u0000" + tx.text;
  if (tx.mCache !== null && tx.mCache.key === key) return tx.mCache.value;
  const basePx = CONFIG.textFontSize * state.scale;   // 正文字号：随缩放一起变，不做任何基于缩放的隐藏
  const rawLines = tx.text.split("\n");
  const lines = [];
  let w = 0;
  let h = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const st = mdLineStyle(rawLines[i]);
    const fontPx = basePx * CONFIG.textHeadScale[st.head];
    const lineH = fontPx * CONFIG.textLineHeight;
    const raw = mdLineSpans(rawLines[i]);
    const spans = [];
    let x = 0;
    for (let k = 0; k < raw.length; k++) {
      const s = raw[k];
      ctx.save();
      // 量宽度前必须先设字体，否则量到的是上一次留在上下文里的那一档
      ctx.font = mdFontCss({ italic: s.italic, bold: s.bold, fontPx: fontPx });
      const sw = ctx.measureText(s.text).width;
      ctx.restore();
      spans.push({
        text: s.text, x: x, w: sw, fontPx: fontPx, color: mdSpanColor(s, st), bold: s.bold, italic: s.italic
      });
      x += sw;
    }
    if (x > w) w = x;
    lines.push({ spans: spans, w: x, h: lineH, fontPx: fontPx });
    h += lineH;
  }
  // 字形的实际高度：行高比字号大，多出来的那部分排在行底，所以整块的字形高度要把最后一行的这部分减掉
  // 原地编辑时垫在文字下面的那块底色、以及输入法那条下划线，都靠这个值与逐行的 fontPx 定位
  const lastLine = lines[lines.length - 1];
  const inkH = h - (lastLine.h - lastLine.fontPx);
  const value = { w: w, h: h, inkH: inkH, lines: lines };
  tx.mCache = { key: key, value: value };
  return value;
}

// 一块浮动文本在屏幕上的完整外框与排版：在缓存好的那一半上补上左上角锚点的屏幕位置
// 绘制、命中、拖动三处共用它，三边算出来的范围必然一致，不会出现「看得见却点不中」
// 锚点是左上角：整块文字从这一点往右、往下排；行高逐行各算，标题行更高
function textBlockLayout(tx) {
  const m = textBlockMetrics(tx);
  return {
    x: worldToScreenX(tx.wx + tx.mvOffU), y: worldToScreenY(tx.wy + tx.mvOffV),
    w: m.w, h: m.h, lines: m.lines
  };
}

/* ========== 绘制 ========== */

// 画所有浮动文本：跟在元件与元件标签之后画，压在它们之上，所以一块盖在电路上的说明不会被元件盖住
// 不做任何基于缩放的隐藏：缩多小就画多小，唯一的跳过是视口剔除与空内容
// 也不做「字太小就改画一块灰」：字号连续变小时，字形本来就按覆盖面积算像素亮度，那份亮度差别就是「这里有字」的信息
function drawFloatingTexts(vp) {
  if (texts.length === 0) return;  // 一块都没有就整段跳过，连保存与裁剪都不做
  const pad = CONFIG.textHitPad;
  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.x, vp.y, vp.w, vp.h);  // 裁剪到视口：文字不会画到上方面板与底栏上
  ctx.clip();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";          // 按行顶对齐：多行排版只需逐行累加行高，不必去算基线
  for (let i = 0; i < texts.length; i++) {
    const tx = texts[i];
    const lay = textBlockLayout(tx);
    // 视口剔除：整块文字都在视口外就跳过，连绘制都不提交
    if (lay.x + lay.w + pad < vp.x || lay.x - pad > vp.x + vp.w ||
        lay.y + lay.h + pad < vp.y || lay.y - pad > vp.y + vp.h) continue;
    // 在选区里（或拉框途中即将进选区）时，在字下面垫一层淡蓝、外面罩一圈实线
    // 元件被选中是自身提亮，文字没有「自身」可提亮，所以用一层底色加一圈外框来表明它也在选区里
    // 底色与外框都画在字形之前，所以任何一个字都不会被它盖住
    const selOn = tx.selPreview !== null ? tx.selPreview : tx.selected;
    if (selOn && tx.selP.cur > 0.001) {
      ctx.save();
      ctx.globalAlpha = tx.selP.cur;
      ctx.fillStyle = COLOR.selectFill;
      ctx.fillRect(lay.x - pad, lay.y - pad, lay.w + pad * 2, lay.h + pad * 2);
      ctx.lineWidth = CONFIG.marqueeWidth;
      ctx.strokeStyle = COLOR.selectBorder;
      ctx.strokeRect(lay.x - pad, lay.y - pad, lay.w + pad * 2, lay.h + pad * 2);
      ctx.restore();
    }
    let y = lay.y;
    for (let k = 0; k < lay.lines.length; k++) {
      const line = lay.lines[k];
      for (let j = 0; j < line.spans.length; j++) {
        const s = line.spans[j];
        if (s.text === "") continue;
        ctx.font = mdFontCss(s);
        ctx.fillStyle = s.color;
        ctx.fillText(s.text, lay.x + s.x, y);
      }
      y += line.h;
    }
  }
  ctx.restore();
}

/* ========== 命中 ========== */

// 指针下的浮动文本：整块外框再加一点外扩；重叠时取后画的那一块（画在最上面的那块）
// 与「看到谁在最上面就抓到谁」一致，画面与判定不会矛盾
function textAtPointer(sx, sy) {
  const pad = CONFIG.textHitPad;
  let hit = null;
  for (let i = 0; i < texts.length; i++) {
    const lay = textBlockLayout(texts[i]);
    if (sx >= lay.x - pad && sx <= lay.x + lay.w + pad &&
        sy >= lay.y - pad && sy <= lay.y + lay.h + pad) hit = texts[i];
  }
  return hit;
}

/* ========== 浮动文本的选中 ========== */

// 一块浮动文本这一轮算不算被框命中：它自己的外框与框相交就算
// 判据不用元件那套「整格与框相交」：文字不占格子，拿格子去判会让大段文字只有一角伸进框就被选上
// 也没有元件那条「一格只认最上层」：两块文字叠在一起会一起被框到，这是对的，它们本就是两样东西
function textHitsMarquee(tx, box) {
  const lay = textBlockLayout(tx);
  return lay.x + lay.w >= box.left && lay.x <= box.right &&
    lay.y + lay.h >= box.top && lay.y <= box.bottom;
}

// 浮动文本的选中总入口：与元件共用同一套「单击 / 拉框 / Shift 翻转」规则
// 但它不占格子，所以没有落位这一步，也不参与激光；选区里多带上它不会动到电路
// 这里刻意不记历史：调用方紧接着都会走一次 applySelection，那一次提交会把两半改动一起记成一步
// 若这里也记一次，一次单击就会占掉两步撤销
function applyTextSelection(isHit, toggle) {
  for (let i = 0; i < texts.length; i++) {
    const tx = texts[i];
    const hit = isHit(tx);
    tx.selected = toggle ? (hit ? !tx.selBase : tx.selBase) : hit;
  }
  sceneDirty = true;
}

/* ========== 拖动 ========== */

// 按下浮动文本：进入「按住了」状态，记下起点，并记下它原来在哪，供拖动被打断时摆回原处
// 此刻先不挪：双击这块文字是要改内容，若按下就跟着指针跑，双击的第一下会把它抖歪
function beginTextDrag(e, tx) {
  textDragging = true;
  textDragActive = false;
  textPointerId = e.pointerId;
  textDragEl = tx;
  textDragStartSX = e.clientX;
  textDragStartSY = e.clientY;
  textDragStartWX = screenToWorldX(e.clientX);
  textDragStartWY = screenToWorldY(e.clientY);
  textDragFromWX = tx.wx;
  textDragFromWY = tx.wy;
  canvas.setPointerCapture(e.pointerId);
}

// 拖动浮动文本：位移取「指针此刻的世界坐标减去按下那一刻的世界坐标」
// 用世界坐标之差而不是屏幕像素之差：拖动期间若用中键平移了视野，画面位移会多算一份，这里从根上避开
// 指针要移过与拉框同一个阈值才真的开始挪：不设这一关，手一抖就会把文字挪偏一两个像素
function moveTextDrag(e) {
  if (!textDragging || e.pointerId !== textPointerId || textDragEl === null) return;
  if (!textDragActive) {
    const mdx = e.clientX - textDragStartSX;
    const mdy = e.clientY - textDragStartSY;
    if (mdx * mdx + mdy * mdy < CONFIG.marqueeThreshold * CONFIG.marqueeThreshold) return;
    textDragActive = true;  // 移过阈值，从这一刻起才算真的在拖
  }
  textDragEl.wx = textDragFromWX + (screenToWorldX(e.clientX) - textDragStartWX);
  textDragEl.wy = textDragFromWY + (screenToWorldY(e.clientY) - textDragStartWY);
  sceneDirty = true;  // 位置变了，静止时也得重绘一帧才看得到
}

// 松开浮动文本：收状态并记一步；位置变了，撤销要能把它摆回原处
function endTextDrag(e) {
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  const moved = textDragEl;
  textDragging = false;
  textDragActive = false;
  textPointerId = -1;
  textDragEl = null;
  sceneDirty = true;
  // 记一步由 commitHistory 自己比对：按下没动就松开时它什么都不记，不会白占一步
  if (moved !== null) commitHistory();
}

// 拖动被系统打断（如触控中断）：把文本摆回原处再收状态，与拖动元件被打断时的处理一致
function cancelTextDrag(e) {
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (textDragEl !== null) {
    textDragEl.wx = textDragFromWX;
    textDragEl.wy = textDragFromWY;
  }
  textDragging = false;
  textDragActive = false;
  textPointerId = -1;
  textDragEl = null;
  sceneDirty = true;
}

/* ========== 文本工具 ========== */

// 文本工具下点击画布：点在已有文本上就原地改那一块，点在空白处就原地新建一块
// 落点取指针所在的世界坐标，不吸附格心：这块文字本来就不属于网格
function onTextToolClick(screenX, screenY) {
  if (!isInViewport(screenX, screenY)) return;
  const tx = textAtPointer(screenX, screenY);
  if (tx !== null) { beginTextEditing(tx, false); return; }
  beginTextEditing(placeText(screenToWorldX(screenX), screenToWorldY(screenY), ""), true);
}

/* ========== 原地输入 ========== */

// 光标在一行里的横向位置：逐段累加宽度，跨到哪一段就按那一段的字体量剩下的那截
// 必须按段的字体量：一行里不同段的字号可能不同（比如标题行里嵌了一段行内代码），统一字体量出来会偏
function measureLinePrefix(line, n) {
  let x = 0;
  let used = 0;
  for (let i = 0; i < line.spans.length; i++) {
    const s = line.spans[i];
    const take = n - used;
    if (take <= 0) break;
    if (take >= s.text.length) { x += s.w; used += s.text.length; continue; }
    ctx.save();
    ctx.font = mdFontCss(s);
    x += ctx.measureText(s.text.slice(0, take)).width;
    ctx.restore();
    break;
  }
  return x;
}

// 从字符下标算出它落在画布上的哪一点：先定它在第几行，再量这一行从行首到它有多宽
// 返回行顶（top）、量出来的横坐标（x）、以及这一行的字号（fontPx）
// 光标高度与输入法下划线的位置都要按 fontPx 算，不能按行高：行高是字号的一点四五倍，
// 按行高算会把光标画得比字高出一大截、把下划线画到下一行去
// 换行符自己占一个下标却不占宽度，所以每往下一行都要多减一个
// 下标比整段还长时停在最后一行末尾：输入框给的 selectionStart 正常不会越界，这里只是兜住不崩
function caretPointFromIndex(text, m, index) {
  const lines = text.split("\n");
  let idx = index;
  let top = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = m.lines[i];
    const len = lines[i].length;
    if (idx <= len) return { x: measureLinePrefix(line, idx), top: top, fontPx: line.fontPx };
    idx -= len + 1;
    top += line.h;
  }
  const last = m.lines.length - 1;
  return { x: m.lines[last].w, top: top - m.lines[last].h, fontPx: m.lines[last].fontPx };
}

// 开始原地编辑：把输入框铺到这块文字所在的位置，内容填进去，光标放到末尾
// 新建一块时先真的把它放进 texts：画布就是从 texts 里取字形来画的，不放进去就没有实时染色可看
// 代价只是「可能是空的」这一种中间状态，由 textEditIsNew 与收尾那一步负责收拾干净
function beginTextEditing(tx, isNew) {
  if (textEditing) endTextEditing(true);  // 上一块还没收尾（正常不会遇到）：先把它收干净，避免两块互相串状态
  textEditEl = tx;
  textEditIsNew = isNew;
  textEditFromText = isNew ? "" : tx.text;
  textEditImeLen = 0;
  textEditing = true;
  textFieldDom.value = isNew ? "" : tx.text;
  textFieldDom.style.display = "block";
  syncTextEditField();
  // 光标放到末尾：改一块已有的文字时，多半是接着往下补，而不是从头重打
  const n = textFieldDom.value.length;
  textFieldDom.setSelectionRange(n, n);
  // 焦点留到下一帧再抢，这里千万不能立刻就抢
  // 画布带 tabindex，这一下点击的默认行为还没走完，浏览器随后会把焦点给回画布；
  // 抢早了的焦点马上被它覆盖，输入框随即失焦，而失焦那一步会把这次输入当成「收下」——
  // 一块刚建、还空着的文字会被当场摘掉，画面上什么都不剩，看上去就是「点了没反应」
  // 放到下一帧，就在那次默认行为之后，焦点才真的落在输入框上
  requestAnimationFrame(function () {
    if (!textEditing || textEditEl !== tx) return;  // 期间用户可能已经点到别处、把这次输入收掉了
    textFieldDom.setSelectionRange(n, n);           // 再设一次：这一帧之间光标没动过，位置仍是末尾
    textFieldDom.focus();
  });
  sceneDirty = true;
}

// 收尾：commit 为真表示把框里的内容写回去，为假表示放弃
// 放弃时分两种：这一轮新建的直接摘掉，本来就在的把内容退回原样，两种都不记历史
// 写回时内容为空也摘掉：与元件标签那条「清空即删除」一致，免得画布上留一块看不见却点得中的空盒子
function endTextEditing(commit) {
  if (!textEditing) return;  // 已经收过了（例如画布那一处与输入框失焦两处同时收）：直接走开，不要重复写一遍
  const tx = textEditEl;
  const isNew = textEditIsNew;
  const from = textEditFromText;
  const text = textFieldDom.value;
  textEditing = false;
  textEditEl = null;
  textEditIsNew = false;
  textEditFromText = "";
  textEditImeLen = 0;
  textFieldDom.style.display = "none";
  if (tx === null) return;
  if (!commit) {
    if (isNew) detachText(tx);
    else tx.text = from;
    sceneDirty = true;
    return;
  }
  if (text.trim() === "") {
    detachText(tx);
    if (!isNew) commitHistory();  // 本来有内容、现在被清空，这是一次真实的删除，要能撤销
    sceneDirty = true;
    return;
  }
  tx.text = text;
  tx.mCache = null;  // 内容变了，排版缓存作废；不靠键比对去发现，主动清掉更省一次字符串拼接
  commitHistory();   // commitHistory 自己比对：内容与原来一样时它什么都不记，不会白占一步
  sceneDirty = true;
}

// 把输入框同步到那块文字的屏幕位置上：位置、尺寸、字号、行高全部按画布的排版结果给
// 每帧都同步一次，所以编辑期间相机平移或缩放时，框与字形会一起走，不会各走各的
// 框里的字是透明的、看不见，字号只用来决定输入法候选框停在哪，以及选中底色的行高
function syncTextEditField() {
  const tx = textEditEl;
  if (!textEditing || tx === null) return;
  const lay = textBlockLayout(tx);
  const fontPx = CONFIG.textFontSize * state.scale;
  const lineH = fontPx * CONFIG.textLineHeight;
  const f = textFieldDom;
  f.style.left = lay.x + "px";
  f.style.top = lay.y + "px";
  f.style.width = Math.max(lay.w, CONFIG.textFieldMinW) + "px";
  // 空文字时整块宽度与高度都是零，框就没了；宽度与高度各留一行的量，光标才有地方站
  f.style.height = Math.max(lay.h, lineH) + "px";
  f.style.fontSize = fontPx + "px";
  f.style.lineHeight = lineH + "px";
}

// 画原地编辑的范围底色：与字形同宽同高的一块淡蓝，位置与高度都取自排版结果，所以它一定贴着字
// 画在字形之下（由绘制顺序保证），所以它只是垫底，不会盖住任何一个字
// 不画边框：边框的四条边在这个尺度上会被读成压在字上、或字与字之间的一条横线，很难看；
// 一块底色已经足够说明「正在这里编辑」，而且它的边界是颜色渐变的，不会被看成一笔线条
function drawTextEditBox() {
  if (!textEditing || textEditEl === null) return;
  const m = textBlockMetrics(textEditEl);
  const lay = textBlockLayout(textEditEl);
  const basePx = CONFIG.textFontSize * state.scale;
  // 字号那一档当作最小宽度：内容还空着时也要有一小块看得见的范围，否则只看到一个孤零零的光标
  const w = Math.max(lay.w, basePx);
  const padX = basePx * CONFIG.textEditFillPadX;
  const padY = basePx * CONFIG.textEditFillPadY;
  ctx.save();
  ctx.globalAlpha = CONFIG.textEditFillAlpha;
  ctx.fillStyle = COLOR.tipFill;
  ctx.fillRect(lay.x - padX, lay.y - padY, w + padX * 2, m.inkH + padY * 2);
  ctx.restore();
}

// 画原地输入的光标，以及输入法正在拼的那一段下面的下划线
// 光标位置由输入框自己的 selectionStart 给出，再由排版换算成画布坐标：
// 这样即使某一行是标题、字号与别行不同，光标也照样落在那个字的左边，也不会跑到行的上下沿去
// 闪烁用真实时钟而不是帧计数：帧率有起伏时，闪烁的节奏不会跟着忽快忽慢
function drawTextEditCaret() {
  if (!textEditing || textEditEl === null) return;
  const tx = textEditEl;
  const m = textBlockMetrics(tx);
  const lay = textBlockLayout(tx);
  const n = textFieldDom.selectionStart;  // 输入框里的字符下标，与 text 的字符下标一一对应
  const p = caretPointFromIndex(tx.text, m, n);
  const x = lay.x + p.x;
  const top = lay.y + p.top;
  ctx.save();
  // 输入法正在拼的那一段：在它下面画一条下划线，让人看得出这一截还没上屏
  // 纵向位置按这一行的字号算，落在这行字的下沿；长度由 compositionupdate 记下，从光标往回数那么多个字符
  if (textEditImeLen > 0) {
    const a = caretPointFromIndex(tx.text, m, Math.max(0, n - textEditImeLen));
    const uy = top + p.fontPx * 1.06;
    ctx.strokeStyle = COLOR.selectBorder;
    ctx.lineWidth = Math.max(1, p.fontPx * CONFIG.textImeUnderlineRatio);
    ctx.beginPath();
    ctx.moveTo(lay.x + a.x, uy);
    ctx.lineTo(x, uy);
    ctx.stroke();
  }
  // 光标：一竖条，高取这一行的字号：字号才是字面的高度，拿行高来画会高出一大截，看着像一根杆子
  // 用真实时钟取模得到一个方波：前一段亮、后一段灭，周期与亮段都在 CONFIG 里
  if ((performance.now() % CONFIG.textCaretBlinkMs) < CONFIG.textCaretOnMs) {
    ctx.fillStyle = COLOR.labelText;
    ctx.fillRect(x, top + p.fontPx * 0.08, CONFIG.textCaretW, p.fontPx * 0.86);
  }
  ctx.restore();
}

// 绑定原地输入框的事件，只做一次
// 这里只接「会改内容」与「要收尾」的几件：输入法三段、内容变化、两个按键、失焦
// 普通按键不在这里处理：它们由浏览器按 textarea 的原生行为处理，这正是用真输入框而不是自造编辑器的原因
function initTextField() {
  // 内容变了：立刻写进那块文字并重绘，所以染色、标题放大在打字过程中就是实时可见的
  textFieldDom.addEventListener("input", function (e) {
    if (!textEditing || textEditEl === null) return;
    textEditEl.text = e.target.value;
    syncTextEditField();  // 行数与最长行都变了，框要跟着长
    sceneDirty = true;
  });
  // 输入法开始拼字：这一段还没上屏，先登记长度为 0，等 compositionupdate 给实际内容
  textFieldDom.addEventListener("compositionstart", function () { textEditImeLen = 0; });
  // 拼字中途：记下这一段有几个字符，供光标那一处画下划线
  // 顺手也写一次内容：个别浏览器在拼字期间的 input 时机不一致，这里补一道，保证画面跟得上
  textFieldDom.addEventListener("compositionupdate", function (e) {
    textEditImeLen = e.data === null || e.data === undefined ? 0 : e.data.length;
    if (!textEditing || textEditEl === null) return;
    textEditEl.text = e.target.value;
    syncTextEditField();
    sceneDirty = true;
  });
  // 拼字结束（上屏或取消）：下划线撤掉
  textFieldDom.addEventListener("compositionend", function (e) {
    textEditImeLen = 0;
    if (!textEditing || textEditEl === null) return;
    textEditEl.text = e.target.value;
    syncTextEditField();
    sceneDirty = true;
  });
  // 两个按键：Esc 放弃、Cmd / Ctrl + 回车收下
  // 不拦普通回车：多行文字里回车就是换行这个本意，要留给输入框自己处理
  textFieldDom.addEventListener("keydown", function (e) {
    if (e.code === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      endTextEditing(false);
      return;
    }
    if ((e.code === "Enter" || e.code === "NumpadEnter") && cmdKeyHeld(e)) {
      e.preventDefault();
      e.stopPropagation();
      endTextEditing(true);
    }
  });
  // 抬起拦下：全局键盘那条通道里也有 keyup，不让它跟着处理一次
  textFieldDom.addEventListener("keyup", function (e) { e.stopPropagation(); });
  // 失去焦点：把这次输入当作收下
  // 有了这一条，点到侧边栏、点到按钮、切走标签页这些路径都不必各自记得去收尾，只有一处
  textFieldDom.addEventListener("blur", function () { endTextEditing(true); });
}
