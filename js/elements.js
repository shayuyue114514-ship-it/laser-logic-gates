// elements.js：网格上的元件：放置、查找、绘制到画布、删除动画。
// 已放置的元件不再挂 SVG 节点，一律由 renderElements 直接画到画布上；元件层这个 SVG 只剩虚影在用
"use strict";

/* ========== 元件（画布层） ========== */

// 同步元件层的尺寸与裁剪矩形：这一层现在只装虚影，但虚影同样只该出现在视口内，裁剪规则与元件一致
function resizeElementLayer() {
  const vp = getViewport();
  S.elemLayer.setAttribute("width", state.cssW);
  S.elemLayer.setAttribute("height", state.cssH);
  S.elemLayer.style.width = state.cssW + "px";
  S.elemLayer.style.height = state.cssH + "px";
  S.clipRect.setAttribute("x", vp.x);
  S.clipRect.setAttribute("y", vp.y);
  S.clipRect.setAttribute("width", vp.w);
  S.clipRect.setAttribute("height", vp.h);
}

// 给一个形状节点套上元件通用外观：填充、描边、圆角连接、先描边后填充、整体透明度
// 单独抽出来是为了虚影也能复用同一套外观：虚影固定是一个路径，不走带文字的组
function styleElementShape(node, opacity) {
  node.setAttribute("fill", hslCss(elementHSL.fill));
  node.setAttribute("stroke", hslCss(elementHSL.stroke));
  // 描边宽度用世界单位，随缩放一起放大，元件轮廓才始终跟着元件走
  node.setAttribute("stroke-width", CONFIG.elementStroke);
  // 圆角靠描边的圆角连接实现：拐角外侧按描边宽度的一半倒圆，不用改路径数据
  node.setAttribute("stroke-linejoin", "round");
  // 先描边后填充：描边内侧那半被填充盖住，只留外面一圈，外框和填充不再重叠
  node.setAttribute("paint-order", "stroke");
  // 用整节点透明度而不是 fill-opacity：后者会让填充透光、盖不住描边内侧，虚影的圈会粗一倍
  node.setAttribute("opacity", opacity);
}

// 建一个元件节点：已放置的元件一律直接画到画布上，不再建节点，所以这里现在只服务虚影
function createElementNode(typeId, opacity) {
  const node = document.createElementNS(SVG_NS, "path");
  node.setAttribute("d", elementPathD(typeId));
  styleElementShape(node, opacity);
  return node;
}

// 查找占据指定格心的元件；格心坐标是 floor 结果加 0.5，都是精确可表示的半整数，可以直接比较
// 同一格出现多个元件只是操作途中的临时状态（把选中的元件挪到了别人身上），
// 而「一格最多一个元件」是模型硬约束，所以这里必须给出唯一答案，交给下面的层级判定
function findElementAt(wx, wy) {
  return topElementAtCell(wx, wy);
}

// 某一格最上层的元件：正在手上（选中）的压在其他元件之上，正在消失的排在最下
// 这个顺序和绘制顺序完全一致（选中的会被挪到元件层末尾），所以「看到谁在最上面就命中谁」，
// 命中结果不会和画面矛盾；同层取数组里靠后的，也和绘制顺序对齐
function topElementAtCell(wx, wy) {
  const arr = S.cellIndex.get(cellKeyOf(Math.floor(wx), Math.floor(wy)));
  if (arr === undefined) return null;
  let best = null;
  let bestRank = -1;
  // 这一格上通常只有一项；选区悬空期间可能暂时叠着两三项，所以仍按层级挑一次
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    if (el.wx !== wx || el.wy !== wy) continue;   // 索引没跟上时先按坐标筛一遍，查不到才是错的，查到错的更糟
    // 正在消失的排 0，普通元件排 1，选中元件排 2；这样正在消失的元件永远不会挡住真实元件
    const rank = el.deleting ? 0 : (el.selected ? 2 : 1);
    if (rank >= bestRank) { best = el; bestRank = rank; }  // 同层取靠后的，和绘制顺序一致
  }
  return best;
}

// 在指定格心点放置一个指定类型、朝 dir 方向的元件
// 元件不再建 SVG 节点：形状由渲染那一步直接画到画布上，这里只备好数据与几项绘制缓存
function placeElement(wx, wy, dir, typeId) {
  const el = {
    id: S.nextElementId++,  // 内部编号：只用来在历史差分里认人，不写进存档；换文档时随新元件重新发号
    wx: wx, wy: wy, dir: dir, typeId: typeId,
    angle: dir * 90, angleTarget: dir * 90,  // 初始角度就是放置时的朝向，动画从静止开始
    deleting: false, deleteP: 0,
    on: false,  // 光源的开关状态：由外部点击切换，默认关；只有光源类型会读它
    offPending: false,  // boolean：光源被别的光照到之后的记号，下一微帧开头会据此把开关归零
    // 下面三项是配色缓存：填充色、描边色、描边宽度。只在选中进度或亮起进度变过时重算一次，
    // 大电路里绝大多数元件每一帧都命中缓存，不必每帧拼一遍颜色字符串
    fillCss: "", strokeCss: "", strokeW: 0,
    selected: false, // 是否被选中：选中即离地，该元件退出电路模拟（不挡光也不发光），落位取消选中时才回到电路里
    litK: -1,        // number：上一次算配色时的选中进度（0 常态、1 全选中）；初值取 -1，逼第一帧先算一次
    litK2: -1,       // number：上一次算配色时的亮起进度；与 litK 一起当缓存键，灯以外的元件恒为 0
    litK3: -1,       // number：上一次算配色时的查找染色程度；不在查找结果里恒为 0，闪光时每帧都在变
    litIn: false,    // boolean：本微帧有没有被激光照到；只由结算层写，灯以外的元件不读
    litP: newEased(0), // Object：灯的亮起缓动进度标量，0 不亮、1 全亮；只有灯会推进它
    selP: newEased(0), // Object：选中缓动进度标量，0 常态、1 全选中，在固定时长内走缓出曲线
    selBase: false,  // 拉框按下那一刻的选中快照：按住 Shift 框选时以它为基准做翻转，框动来动去也不会反复横跳
    // number：元件最后一次被画进缓存位图的那一代图；-1 表示还没进过任何一张
    // 「它在不在当前这张位图里」只看这一项，不再拿动画状态去猜，两个判据合并成一个，画面不会出现「两边都没画」
    cacheGen: -1,
    // 拉框途中「现在松手会不会被选中」的预览：true 会选上、false 会取消、null 表示没在预览
    // 它只影响画面高亮，绝不改 selected，所以没松手时元件看着像是选中了，实则仍在电路里照常挡光发光
    selPreview: null,
    orbitU0: null,   // number | null：公转起点格号 u；null 表示这个元件没在公转
    orbitV0: null,   // number | null：公转起点格号 v
    orbitAngle0: 0,  // number：公转开始时的角度，公转期间画的角度从它往上加
    orbitShiftU: 0,  // number：落位吸附量 u：动画途中按进度补上，收尾时正好落在格心上
    orbitShiftV: 0,  // number：落位吸附量 v
    mvOffU: 0,       // number：拖动缓动的视觉偏移 u（世界单位）：拖动时先让画面留在原地，再缓出追上目标格
    mvOffV: 0,       // number：拖动缓动的视觉偏移 v
    gone: false,     // boolean：删除动画已走完、等着被摘出元件表的标记；压实数组时按它筛
    idx: 0,          // number：在元件表里的下标；由阻挡图重建时刷新，结算层按它存发射与接收掩码
    inOut: false,    // boolean：是否登记在「正在发射的门」那张小表里；由结算层维护
    out: 0,     // 本微帧要发射的掩码：偏转器与透射器由 scheduleOutputs 按上一微帧的接收结果写入
    // 下面三项是元件标签：文字为空串表示没有标签，此时方位角与距离都不参与绘制也不参与命中
    // 标签是元件的一个属性而不是独立物件，所以元件被搬到哪、转到哪，标签都跟着走，不存在「放丢」这回事
    // 方位角与距离都是相对量（相对元件格心的方向与距离），所以整批平移、整批旋转之后原样照搬仍然是对的
    labelText: "",                          // string：标签文字，单行
    labelSize: null,                        // object|null：上一次量出来的标签尺寸缓存，键是文字与字号
    labelAngle: CONFIG.labelAngleDefault,   // number：标签方位角（度），0 上、90 右、180 下、270 左，与元件朝向同一套
    labelGap: CONFIG.labelGapDefault        // number：文字外框离元件格心最近的那一点到格心的距离（世界单位）
  };
  S.elements.push(el);
  indexElement(el);       // 同时挂进格子索引：按格查元件从此一步直达，不必扫全表
  S.rayGraph.dirty = true;  // 元件增删会打乱 elements 下标，阻挡图必须重建
  S.sceneDirty = true;      // 新元件要画出来，强制重绘一次
  return el;              // 交给调用方接着改字段（读档要还原光源开关），省得再回头查一遍
}

// 在屏幕位置处放置元件：吸附到所在格心，视口外不放置，同一格已有元件则忽略
function placeElementAtScreen(screenX, screenY) {
  if (!isInViewport(screenX, screenY)) return;
  const wx = cellCenterX(screenToWorldX(screenX));
  const wy = cellCenterY(screenToWorldY(screenY));
  // 一个格子最多一个元件，这是基本逻辑里的硬约束
  if (findElementAt(wx, wy) !== null) return;
  // 朝向取虚影当前的目标角度：目标角度永远是 90 的整数倍，取模得到 0 上 1 右 2 下 3 左
  const dir = ((Math.round(S.ghostAngleTarget / 90) % 4) + 4) % 4;
  // 类型取当前选中的槽：放下去的就是手上那个虚影，形状与预览完全一致
  // 手上拿的是选中工具时没有元件可放，回车直接不响应
  const typeId = selectedTypeId();
  if (typeId === null) return;
  placeElement(wx, wy, dir, typeId);
  commitHistory();  // 放置是直接改电路的动作，放下去这一刻就记一步
}

// 虚影的屏幕变换串：先把世界坐标换算成屏幕位置，再拼出「平移到屏幕位置 → 按角度旋转 → 按屏幕缩放放大」
// 等比缩放下旋转与缩放可交换，顺序不影响结果
// 参数直接收角度（度），因为虚影旋转动画中途会传入非 90 整数倍的值
// 缩放由调用方传进来：普通元件的虚影跟着相机缩放走，虚影本身不再自己算
// 已放置的元件不再用变换串，它们在 renderElements 里直接摆坐标系，所以这里只服务虚影
function elementTransform(wx, wy, angleDeg, scale) {
  return "translate(" + worldToScreenX(wx) + " " + worldToScreenY(wy) + ")" +
    " rotate(" + angleDeg + ")" +
    " scale(" + scale + ")";
}

// 每帧把所有元件直接画到画布上；删除中的元件同时被收缩和淡出
// 为什么不再用 SVG 节点承载：视野一动，屏上每个元件的坐标都要重算，而 SVG 每改一次坐标都要为那个节点
// 重算布局再重新描一遍，两千个元件叠起来就是几十毫秒；画到画布上只是描一次路径加填一次色，
// 开销同样与元件个数成正比，但每个元件的常数小得多，而且没有任何布局与样式计算
// 这里做两件省算的事，目的是让开销随「屏上元件数」走，而不是随「元件总数」走：
//   一、视口外的元件直接跳过：它们这一帧本来就不会出现在画面上，跳过之后连路径都不用建
//       画布不像 SVG 节点那样会留下上一次的坐标，所以跳过永远是安全的，不存在重影
//   二、配色只在选中进度或亮起进度真的变过时才重算，静止元件每帧都命中缓存，不拼颜色字符串
/* ========== 格子索引与活跃表 ========== */

// 两个整数格号拼成一个精确整数当键：数字键比字符串键省掉每次哈希；格号上下各留 ±419 万格的余量，
// 乘积不超过 2^53，仍然落在双精度整数能精确表示的范围内
const CELL_KEY_BIAS = 4194304;
function cellKeyOf(gx, gy) {
  return (gx + CELL_KEY_BIAS) * 8388608 + (gy + CELL_KEY_BIAS);
}

// 把一个元件挂进它所在的格
function indexElement(el) {
  const key = cellKeyOf(Math.floor(el.wx), Math.floor(el.wy));
  const arr = S.cellIndex.get(key);
  if (arr === undefined) S.cellIndex.set(key, [el]);
  else arr.push(el);
}

// 把元件从它所在的格里摘掉
function unindexElement(el) {
  const key = cellKeyOf(Math.floor(el.wx), Math.floor(el.wy));
  const arr = S.cellIndex.get(key);
  if (arr === undefined) return;
  const i = arr.indexOf(el);
  if (i >= 0) arr.splice(i, 1);
  if (arr.length === 0) S.cellIndex.delete(key);   // 空格子连键一起删掉，索引里不留一堆空数组
}

// 元件挪了格：按旧格号摘、按新格号挂。调用方要在改 wx/wy 之前先把旧值记下来传进来
function reindexElement(el, oldWx, oldWy) {
  const oldKey = cellKeyOf(Math.floor(oldWx), Math.floor(oldWy));
  const newKey = cellKeyOf(Math.floor(el.wx), Math.floor(el.wy));
  if (oldKey === newKey) return;   // 还在同一格里，索引不必动
  const oldArr = S.cellIndex.get(oldKey);
  if (oldArr !== undefined) {
    const i = oldArr.indexOf(el);
    if (i >= 0) oldArr.splice(i, 1);
    if (oldArr.length === 0) S.cellIndex.delete(oldKey);
  }
  const newArr = S.cellIndex.get(newKey);
  if (newArr === undefined) S.cellIndex.set(newKey, [el]);
  else newArr.push(el);
}

// 整张索引推倒重建：清空电路、批量读档这类「一次动很多」的场合用它，比逐条摘挂更省事
function rebuildCellIndex() {
  S.cellIndex.clear();
  for (let i = 0; i < S.elements.length; i++) indexElement(S.elements[i]);
}

// 一个元件此刻还要不要每帧照顾：动画没走完、或它属于要单独画在最上层的那几种（选中、删除中、亮着、有标签）
// 这是「冷淡」的唯一定义处：位图收谁、叠加层画谁、每帧推进哪些，全都由它说了算，三处不会各自漂移
function elementNeedsFrame(el) {
  if (el.deleting || el.selected || el.selPreview !== null) return true;   // 删除中、选中、框选预览都要单独画
  if (el.angle !== el.angleTarget) return true;                            // 朝向还在转
  // 缓动目标按「当前状态应该是什么」现算：目标与缓动里记着的不一致，说明它刚被改过、还没开始走
  // 少判这一条就会漏掉「刚被选中」「刚被取消选中」「灯刚被照亮」的那一帧，动画要等下一帧才起步
  const selTo = (el.selPreview !== null ? el.selPreview : el.selected) ? 1 : 0;
  if (el.selP.t < 1 || el.selP.to !== selTo) return true;
  const litTo = (el.litIn && !el.deleting) ? 1 : 0;
  if (el.litP.t < 1 || el.litP.to !== litTo) return true;
  if (el.litP.cur > 0) return true;                                        // 灯还亮着，光晕每帧都要贴
  if (el.mvOffU !== 0 || el.mvOffV !== 0) return true;                     // 拖动缓动没归零
  if (el.orbitU0 !== null) return true;                                    // 公转中
  if (el.labelText !== "") return true;                                    // 有标签：文字每帧都要画
  // 落在查找结果里的元件：本体要染成橘黄，闪光期间染色深浅每帧都在变，也必须单独画
  if (searchTintFor(el) > 0) return true;
  return false;
}

// 每帧重建活跃表：一趟全表扫描，判据只有几个布尔比较
// 不做增量维护：动画状态被十来处改写，逐处标记漏一处就会留下不动的残影，宁可每帧重算一次
function rebuildActiveEls() {
  // 先看一眼有没有元件「这一帧起不再需要单独画」：动画刚落定的元件要从叠加层交回缓存位图
  // 这一刻不再整张重建位图，而是把落下这一个元件直接补画进现有位图：补画只是一次贴图，
  // 整张重建在元件多时要几百毫秒，那一下就是「取消选中卡一下、还短暂空一帧」的来源
  // 补不上（相机或缩放已经对不上位图）时才退回整张作废，兜住所有情况
  for (let i = 0; i < S.activeEls.length; i++) {
    const el = S.activeEls[i];
    if (elementNeedsFrame(el)) continue;   // 还要单独画的元件与这件事无关
    if (S.elemCacheDirty) break;             // 位图本来就要整张重建，补画没有意义
    if (el.cacheGen === S.elemCacheGen) continue;   // 已经在位图里了，不必再补
    if (!patchBaseElementIntoCache(el)) { invalidateElementCache(); break; }
  }
  S.activeEls.length = 0;
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (elementNeedsFrame(el)) S.activeEls.push(el);
  }
}

/* ========== 元件缓存层 ========== */

// 按当前两个进度（选中、亮起）算出这一个元件的填充、描边与描边宽度，结果留在元件上
// 两个进度都没变就直接复用上一次的结果，省掉每帧反复的颜色换算与字符串拼接
function refreshElementColors(el) {
  const kSel = el.selP.cur;
  const kLit = el.litP.cur;
  const kSearch = searchTintFor(el);   // 查找染色程度：0 表示不在结果里，取值由 search.js 按组与闪光进度算
  if (el.litK === kSel && el.litK2 === kLit && el.litK3 === kSearch && el.fillCss !== "") return;
  el.litK = kSel;
  el.litK2 = kLit;
  el.litK3 = kSearch;
  if (el.typeId === "lamp") {
    // 灯另走一套：亮起时在 RGB 里把常态色逐通道混向淡红，等价于盖一层淡红遮罩淡入，中间不会绕色环
    let fill = mixRgb(mixRgb(RGB.elementFill, RGB.lampFill, kLit), RGB.selectFill, kSel);
    let stroke = mixRgb(mixRgb(RGB.elementStroke, RGB.lampStroke, kLit), RGB.selectStroke, kSel);
    // 进了查找结果就直接换成橘黄一族：不再从灯的淡红里往回混，免得两种暖色叠成一团脏色
    if (kSearch > 0) {
      fill = searchTintFill(kSearch);
      stroke = searchTintStroke(kSearch);
    }
    el.fillCss = rgbCss(fill);
    el.strokeCss = rgbCss(stroke);
  } else {
    // 没进查找结果时照旧走 HSL 三段混合：常态、选中两档在色相上是近邻，直接插值不会串色
    if (kSearch > 0) {
      // 进了结果：整个元件换成橘黄一族，不从蓝底上混过去，所以不会出现经绿、经灰的中间色
      el.fillCss = rgbCss(searchTintFill(kSearch));
      el.strokeCss = rgbCss(searchTintStroke(kSearch));
    } else {
      el.fillCss = hslCss(mixHslTriple(elementHSL.fill, selectLitHSL.fill, kSel));
      el.strokeCss = hslCss(mixHslTriple(elementHSL.stroke, selectLitHSL.stroke, kSel));
    }
  }
  // 描边宽度跟着选中进度一起从常态加粗到选中值，取消选中时原样退回
  el.strokeW = CONFIG.elementStroke + (CONFIG.elementStrokeSelected - CONFIG.elementStroke) * kSel;
}

// 这个元件现在是不是「冷淡状态」：不亮、不选、不在删除、没有视觉偏移、没有标签、动画都已停稳
// 只有冷淡元件进缓存位图，其余每帧单独画在最上面，所以元素点亮不会让整张缓存作废
// 判据本身放在 elementNeedsFrame 里，位图、叠加层、每帧推进三处共用同一个定义，不会各自漂移
function isBaseElement(el) {
  return !elementNeedsFrame(el);
}

// 缓存作废：结构变了（放置、删除、旋转、撤销、读档）或选中集变了都调它
// 点亮与熄灭不在其列：冷淡元件在缓存里的样子没变，亮起来的那几个由叠加层盖住
// 同时要求重绘一帧：主循环在场景静止时会整帧跳过渲染，只置脏标志的话位图要等到下一次有动静才重画，
// 那段时间里元件既不在位图里、也不在叠加层上，看上去就是「消失一会儿又自己出现」
function invalidateElementCache() {
  S.elemCacheDirty = true;
  S.sceneDirty = true;
}

// 开始一批：清空上一批留下的桶，桶里存着大路径，清掉让 GC 回收
function paintBatchBegin() {
  S.paintBatchMap.clear();
}

// 往当前这批里加一个元件：sx、sy 是屏幕位置（相对当前绘制原点），kScale 与 alpha 由调用方给定
// 角度归一到 [0,360)：90 的整数倍仍精确相等（同朝向能合进同一桶），动画途中的非整数角度原样保留（不会跳格）
function paintBatchAdd(el, sx, sy, angleDeg, kScale, alpha) {
  const deg = ((angleDeg % 360) + 360) % 360;
  const key = el.typeId + "|" + deg + "|" + el.fillCss + "|" + el.strokeCss + "|" +
    el.strokeW.toFixed(3) + "|" + kScale.toFixed(4) + "|" + alpha.toFixed(3);
  let b = S.paintBatchMap.get(key);
  if (b === undefined) {
    // 新桶：a、b、c、d 四个矩阵系数由「朝向 + 缩放」定死，同桶内每个元件都一样，只差平移的 e、f
    const rad = deg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const m = new DOMMatrix();
    m.a = kScale * cos; m.b = kScale * sin; m.c = -kScale * sin; m.d = kScale * cos; m.e = 0; m.f = 0;
    // 描边宽度要跟着缩放一起放大：路径已被 matrix 变换成屏幕像素，若还按世界单位给线宽，
    // 放大到几十倍时描边只有零点几像素，看上去就像完全没有描边
    b = { path: new Path2D(), matrix: m, fill: el.fillCss, stroke: el.strokeCss, lineWidth: el.strokeW * kScale, alpha: alpha };
    S.paintBatchMap.set(key, b);
  }
  // 只改平移两项，再把这一类型的轮廓（按本桶朝向与缩放变换好）追加进桶路径
  b.matrix.e = sx;
  b.matrix.f = sy;
  b.path.addPath(elementPathObject(el.typeId), b.matrix);
}

// 给一种「类型 + 朝向 + 配色」的冷淡元件预渲染一张小贴图，之后整批元件就靠贴它
// 为什么从「合并路径」再退到「贴图」：同类型同朝向的元件长得一模一样，合并成一条大路径虽然
// 把调用次数降下来了，但那条路径里有四万多个子路径，描边时仍要把每个子路径的拐角几何全算一遍，
// 实测只快了约两倍半（重建仍要一百五十到四百毫秒）。贴图则把这趟几何计算整个省掉：
// 每种形状只描一次边、填一次色，四万多个元件只剩四万多次小图拷贝，且贴图按物理像素对齐，画面与原矢量画法逐像素一致
function elementSprite(typeId, deg, fillCss, strokeCss, strokeW) {
  const key = typeId + "|" + deg + "|" + fillCss + "|" + strokeCss + "|" + strokeW.toFixed(3);
  let sp = S.elemSpriteMap.get(key);
  if (sp !== undefined) return sp;
  const dpr = effectiveDpr();
  const scale = state.scale;
  // 半边长取「元件长度的一半乘 √2」再补上描边向外伸出的半宽，最后留 1 px 富余：
  // 任何形状（含反相器顶点上的气泡）任何朝向都装得下，多留一点只会让贴图大几个像素
  const half = (CONFIG.elementLen * Math.SQRT2 / 2) * scale + strokeW * scale / 2 + 1;
  // 位图边长取偶数个物理像素：中心正好落在整像素上，贴图时才不会带进半像素偏移
  let sideDev = Math.ceil(half * 2 * dpr);
  if (sideDev % 2 !== 0) sideDev++;
  const cv = document.createElement("canvas");
  cv.width = sideDev;
  cv.height = sideDev;
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);   // 贴图内部也按 CSS 像素作画，与主画布同一套
  g.lineJoin = "round";                    // 圆角靠描边的圆角连接实现，与原画法一致
  g.translate(sideDev / dpr / 2, sideDev / dpr / 2);   // 原点挪到贴图正中心，元件格心就落在这里
  g.rotate(deg * Math.PI / 180);
  g.scale(scale, scale);
  g.fillStyle = fillCss;
  g.strokeStyle = strokeCss;
  g.lineWidth = strokeW;
  const path = elementPathObject(typeId);
  g.stroke(path);   // 先描边后填充：描边内侧那半被填充盖住，只留外面一圈，与原画法完全一致
  g.fill(path);
  sp = { cv: cv, css: sideDev / dpr, halfDev: sideDev / 2 };
  S.elemSpriteMap.set(key, sp);
  return sp;
}

// 收尾当前这批：逐桶描边、填充。描边在前、填充在后，描边内侧那半被填充盖住，与原逐元件画法完全一致
// 每一档的活跃元件（选中的、亮着的、正在动的）都走这条路：它们配色与透明度各不相同，按桶合并仍然划算
function paintBatchFlush(c) {
  for (const b of S.paintBatchMap.values()) {
    c.globalAlpha = b.alpha;
    c.fillStyle = b.fill;
    c.strokeStyle = b.stroke;
    c.lineWidth = b.lineWidth;
    c.stroke(b.path);
    c.fill(b.path);
  }
  c.globalAlpha = 1;   // 复位：调用方之后可能还要按默认透明度画别的东西
  S.paintBatchMap.clear();
}

// 把冷淡元件整批画进缓存位图；位图比视口四周各大出 elemCachePadPx，平移没超出去就只贴图
// 位图按屏幕坐标作画，同时记下左上角对应的世界坐标，所以平移之后仍能算出它该贴在哪
function buildElementCache(vp) {
  const dpr = effectiveDpr();
  // 每重建一次换一代：元件上记的代号跟不上这一代，就说明它不在当前这张图里，叠加层要补画它
  const gen = ++S.elemCacheGen;
  const pad = CONFIG.elemCachePadPx;
  const w = Math.max(1, Math.ceil(vp.w + pad * 2));
  const h = Math.max(1, Math.ceil(vp.h + pad * 2));
  if (S.elemCacheCanvas === null) {
    S.elemCacheCanvas = document.createElement("canvas");
    S.elemCacheCtx = S.elemCacheCanvas.getContext("2d");
  }
  // 改位图尺寸会顺带清空上下文，所以只在尺寸真的变了时才写
  if (S.elemCacheCanvas.width !== Math.round(w * dpr) || S.elemCacheCanvas.height !== Math.round(h * dpr)) {
    S.elemCacheCanvas.width = Math.round(w * dpr);
    S.elemCacheCanvas.height = Math.round(h * dpr);
  }
  const c = S.elemCacheCtx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);   // 位图内部也用 CSS 像素坐标，与主画布同一套
  c.clearRect(0, 0, w, h);
  c.lineJoin = "round";
  S.elemCacheW = w;
  S.elemCacheH = h;
  S.elemCacheScale = state.scale;
  // 位图左上角对齐到物理像素：贴图时与屏幕一一对应，不触发逐像素重采样，既清晰又省掉插值开销
  // 原点挪半格以内不会让画面错位：元件在位图里按「相对原点」的坐标画，原点挪多少、贴图位置也挪多少，正好抵消
  const ox = Math.round((vp.x - pad) * dpr) / dpr;   // 位图左上角此刻的屏幕位置（对齐到物理像素）
  const oy = Math.round((vp.y - pad) * dpr) / dpr;
  S.elemCacheOX = ox;
  S.elemCacheOY = oy;
  S.elemCacheAnchorSX = state.anchorSX;   // 记下这一刻的相机，之后贴图就按它与当前相机算仿射变换
  S.elemCacheAnchorSY = state.anchorSY;
  S.elemCacheAnchorWX = state.anchorWX;
  S.elemCacheAnchorWY = state.anchorWY;
  S.elemCacheWX = screenToWorldX(ox);
  S.elemCacheWY = screenToWorldY(oy);
  const reach = CONFIG.elementLen * state.scale;   // 粗剔除余量：元件离格心最远不会超过一个格长
  let drawnN = 0;
  let culledN = 0;
  // 候选怎么取：按可见格去索引里捞，开销只跟「视野覆盖多少格」走，与元件总数无关；
  // 视野缩得很小、覆盖的格数反而超过元件总数时（整张图挤在屏上），直接扫元件表更省。两条路取便宜的那条
  const reachW = reach / state.scale;   // 换算成世界单位的余量，用来把可见范围向外扩一圈格
  const cand = S.elemCacheCand;
  cand.length = 0;
  const gx0 = Math.floor(S.elemCacheWX - reachW);
  const gx1 = Math.floor(screenToWorldX(ox + w) + reachW);
  const gy0 = Math.floor(screenToWorldY(oy + h) - reachW);   // 屏幕 Y 向下、世界 Y 向上，位图底边对应的世界 Y 更小
  const gy1 = Math.floor(S.elemCacheWY + reachW);
  if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) <= S.elements.length) {
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const arr = S.cellIndex.get(cellKeyOf(gx, gy));
        if (arr === undefined) continue;
        for (let a = 0; a < arr.length; a++) {
          if (isBaseElement(arr[a])) cand.push(arr[a]);
        }
      }
    }
  } else {
    for (let i = 0; i < S.elements.length; i++) {
      if (isBaseElement(S.elements[i])) cand.push(S.elements[i]);
    }
  }
  S.elemSpriteMap.clear();   // 贴图是按当前缩放画出来的，缩放一变就全部作废，这里连同旧缩放的一起清掉
  for (let i = 0; i < cand.length; i++) {
    const el = cand[i];
    const sx = worldToScreenX(el.wx) - ox;
    const sy = worldToScreenY(el.wy) - oy;
    if (sx < -reach || sx > w + reach || sy < -reach || sy > h + reach) { culledN++; continue; }
    drawnN++;
    el.cacheGen = gen;   // 记下它进了这一代图：叠加层从此不再重复画它
    refreshElementColors(el);
    // 任何缩放下都画完整轮廓，不按尺寸做简化：缩得再小，形状与朝向也是看得出来的信息
    const sp = elementSprite(el.typeId, ((el.angle % 360) + 360) % 360, el.fillCss, el.strokeCss, el.strokeW);
    // 贴图位置按物理像素取整：贴图与屏幕一一对应，既不触发重采样，也不额外花时间；位移误差不超过半个物理像素
    c.drawImage(sp.cv, (Math.round(sx * dpr) - sp.halfDev) / dpr, (Math.round(sy * dpr) - sp.halfDev) / dpr, sp.css, sp.css);
  }
  S.elemCacheDrawn = drawnN;
  S.elemCacheCulled = culledN;
  S.elemCacheDirty = false;
  // 探针读数：这一帧重画了缓存位图，以及候选、真正画进位图、被剔除的各是多少
  pval("缓存重画", 1);
  pval("候选", cand.length);
  pval("画出", drawnN);
  pval("剔除", culledN);
}

// 把一个刚冷淡下来的元件直接补画进现有缓存位图，省掉为它整张重建
// 前提是位图与当前相机、缩放完全对得上，否则坐标映射会错位，此时返回 false，让调用方整张作废重画
// 补画本身只是一次贴图，与元件总量无关，所以取消选中、灯熄灭这类收尾不会再卡一下
function patchBaseElementIntoCache(el) {
  if (S.elemCacheCanvas === null || S.elemCacheDirty) return false;      // 没有位图、或位图正等着重建，都不必补
  if (S.elemCacheScale !== state.scale) return false;                  // 缩放变了：贴图尺寸与位图基准都对不上
  if (state.anchorSX !== S.elemCacheAnchorSX || state.anchorSY !== S.elemCacheAnchorSY) return false;  // 相机在动
  if (state.anchorWX !== S.elemCacheAnchorWX || state.anchorWY !== S.elemCacheAnchorWY) return false;
  const dpr = effectiveDpr();
  const sx = worldToScreenX(el.wx) - S.elemCacheOX;   // 相对位图左上角的位置（CSS px）
  const sy = worldToScreenY(el.wy) - S.elemCacheOY;
  const reach = CONFIG.elementLen * state.scale;    // 位图外一圈的余量：落在余量里补画是安全的
  if (sx < -reach || sx > S.elemCacheW + reach || sy < -reach || sy > S.elemCacheH + reach) return false;
  refreshElementColors(el);                         // 常态配色：此刻它的选中、亮起缓动都已归零
  const sp = elementSprite(el.typeId, ((el.angle % 360) + 360) % 360, el.fillCss, el.strokeCss, el.strokeW);
  const c = S.elemCacheCtx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);             // 位图内部一律按 CSS 像素作画，与整张重建时同一套
  // 贴图位置与整张重建时同样按物理像素取整，补进去的那一个与重画出来的逐像素一致
  c.drawImage(sp.cv, (Math.round(sx * dpr) - sp.halfDev) / dpr, (Math.round(sy * dpr) - sp.halfDev) / dpr, sp.css, sp.css);
  el.cacheGen = S.elemCacheGen;   // 位图里现在有它了，叠加层不必再补画
  // 位图变了就得请一帧渲染：场景此时往往已经静止，不置脏的话这次补画要等到下次有动静才被贴出来，
  // 中间那段时间元件只在位图里、屏幕上还是空的，看上去就是「消失了一会儿」
  S.sceneDirty = true;
  return true;
}

function renderElements() {
  if (S.renderSkip.elements) return;   // 逐层开关：排查帧率时整层跳过，画面上只留网格、激光与光晕
  const vp = getViewport();
  // 剔除余量：形状的原点就在格心，离格心最远的一点是三角形底角或反相器顶点上那颗气泡
  // 统一按「元件长度的一半再乘 √2」估：任何形状都落在这个半径之内，比逐个类型算更省事也更保险
  // 描边只露外侧一半，这里按整宽加进去，再留 2px 富余：余量偏大只会多画几个视口外的元件，漏画才是错的
  const cullMargin = (CONFIG.elementLen * Math.SQRT2 / 2 + CONFIG.elementStroke) * state.scale + 2;
  const cullL = vp.x - cullMargin;
  const cullR = vp.x + vp.w + cullMargin;
  const cullT = vp.y - cullMargin;
  const cullB = vp.y + vp.h + cullMargin;
  // 计数从缓存那一次重建的结果起算，叠加层再往上加，读数仍然是「这一帧画面上有多少元件」
  let drawn = S.elemCacheDrawn;
  let culled = S.elemCacheCulled;

  S.ctx.save();
  // 裁剪到视口：元件和网格一样只出现在视口内，不会压到上方面板或底部栏上
  S.ctx.beginPath();
  S.ctx.rect(vp.x, vp.y, vp.w, vp.h);
  S.ctx.clip();
  S.ctx.lineJoin = "round";  // 圆角靠描边的圆角连接实现：拐角外侧按描边宽度的一半倒圆，不用改路径数据

  // 相机停稳：参考点与缩放都到了目标值，这时画面不会再动，正是重画一张清晰位图的好时机
  const camSettled = state.anchorSX === state.tAnchorSX && state.anchorSY === state.tAnchorSY && state.logScale === state.tLogScale;
  // 贴图变换：把位图按「建图那一刻的相机 → 现在的相机」摆过去，缩放与平移都由这一次仿射变换承担
  // 为什么不要求缩放完全相等：缩放途中每帧重画四万多个元件要两三百毫秒，画面只能到两三帧；
  // 拿旧位图按新缩放贴过去，元件的位置与相对大小完全正确，只是采样略糊，换来缩放全程跟手
  let ck = S.elemCacheScale > 0 ? state.scale / S.elemCacheScale : 1;   // 位图要乘上的缩放倍数
  let cx = state.anchorSX + (S.elemCacheAnchorWX - state.anchorWX) * state.scale + (S.elemCacheOX - S.elemCacheAnchorSX) * ck;
  let cy = state.anchorSY - (S.elemCacheAnchorWY - state.anchorWY) * state.scale - (S.elemCacheAnchorSY - S.elemCacheOY) * ck;
  // 位图被放大到超过阈值就当场重画，不再等相机停稳：缩小再放大时位图被拉得越大越糊，
  // 而等收敛要零点几秒，那一段就是用户看到的最糊的时候；阈值由设置里的「缩放刷新速度」给出
  // 只判放大方向：缩小时是拿高分辨率位图缩小采样，不会糊，重画反而白花时间
  const overDrift = ck > S.zoomRefreshLimit;
  // 贴出来的位图要盖住整个视口；盖不住就说明视野已经跑到旧位图外面，再贴就会缺内容
  const covered = S.elemCacheCanvas !== null &&
    cx <= vp.x + 0.5 && cy <= vp.y + 0.5 &&
    cx + S.elemCacheW * ck >= vp.x + vp.w - 0.5 && cy + S.elemCacheH * ck >= vp.y + vp.h - 0.5;
  pval("缓存重画", 0);   // 先按「这一帧只贴图、不重画」记一次，下面真重画时会被覆盖成 1
  // 五种情形才重画整张位图：结构变了、还没建过、贴出来盖不住视口、相机停稳且缩放已经对不上、放大超过一档
  // 「每帧都在变缩放」仍被排除在外，于是大多数帧只剩一次贴图
  if (S.elemCacheDirty || S.elemCacheCanvas === null || !covered || overDrift ||
      (camSettled && S.elemCacheScale !== state.scale)) {
    buildElementCache(vp);
    // 位图刚换过：相机、缩放、原点都成了当前值，贴图变换必须按新值重算，否则会用旧变换贴新图
    ck = S.elemCacheScale > 0 ? state.scale / S.elemCacheScale : 1;
    cx = state.anchorSX + (S.elemCacheAnchorWX - state.anchorWX) * state.scale + (S.elemCacheOX - S.elemCacheAnchorSX) * ck;
    cy = state.anchorSY - (S.elemCacheAnchorWY - state.anchorWY) * state.scale - (S.elemCacheAnchorSY - S.elemCacheOY) * ck;
  }
  // 只贴视口真正覆盖到的那一块：位图四周各留了一圈 elemCachePadPx 的余量，整张贴会把外圈一并栅格化，
  // 缩放放大时外圈还跟着一起放大，实测这一下就占掉元件层大半时间。按源矩形裁到视口后，
  // 无论缩放多少倍，每帧栅格化的像素都封顶在视口大小，与位图尺寸无关
  const bw = S.elemCacheW * ck, bh = S.elemCacheH * ck;   // 位图贴到屏幕上占的宽高（CSS px）
  const ix0 = cx > vp.x ? cx : vp.x;                  // 位图与视口的相交矩形（屏幕坐标）
  const iy0 = cy > vp.y ? cy : vp.y;
  const ix1 = cx + bw < vp.x + vp.w ? cx + bw : vp.x + vp.w;
  const iy1 = cy + bh < vp.y + vp.h ? cy + bh : vp.y + vp.h;
  if (ix1 > ix0 && iy1 > iy0) {
    const dpr = effectiveDpr();
    const bxD = cx * dpr, byD = cy * dpr;   // 位图左上角对应的物理像素坐标
    // 相交边界与位图自身范围都换算成物理像素再取整，并夹进位图像素内，避免源矩形越界取到脏边
    const x0 = Math.max(Math.round(ix0 * dpr), Math.ceil(bxD));
    const y0 = Math.max(Math.round(iy0 * dpr), Math.ceil(byD));
    const x1 = Math.min(Math.round(ix1 * dpr), Math.floor(bxD + S.elemCacheW * dpr * ck));
    const y1 = Math.min(Math.round(iy1 * dpr), Math.floor(byD + S.elemCacheH * dpr * ck));
    if (x1 > x0 && y1 > y0) {
      // 缩放为 1 且位图已对齐物理像素时，源矩形与目标矩形逐像素对齐，退化成纯拷贝，不触发重采样
      const inv = 1 / ck;   // 屏幕像素 → 位图内部像素：位图放大贴时源矩形相应变小
      S.ctx.drawImage(S.elemCacheCanvas,
        (x0 - bxD) * inv, (y0 - byD) * inv, (x1 - x0) * inv, (y1 - y0) * inv,
        x0 / dpr, y0 / dpr, (x1 - x0) / dpr, (y1 - y0) / dpr);
    }
  }

  // 分三档画：正在消失的排最下、普通元件居中、正在手上的压在最上
  // 这个顺序与按格查元件的层级判定完全一致，用户看到谁在最上面就能选到谁，画面与判定不会矛盾
  // 分三档而不是重排数组：数组下标被接收掩码引用着，动不得；三档只多两遍极廉价的布尔判断
  for (let rank = 0; rank <= 2; rank++) {
    // 每一档单独成一批：档与档之间的压盖顺序必须保住；档内元件互不重叠，所以可以合并成一条路径
    paintBatchBegin();
    // 只走活跃表：冷淡元件已经在缓存位图里，不必每帧再扫一遍全表去把它们认出来
    for (let i = 0; i < S.activeEls.length; i++) {
      const el = S.activeEls[i];
      // 只有当「当前这张位图里确实有它」且它此刻是冷淡状态时才不重复画；
      // 刚由热转冷的元件在位图里没有它（代入不同），这一帧仍由叠加层接着画，画面不会空一拍
      if (el.cacheGen === S.elemCacheGen && isBaseElement(el)) continue;
      if ((el.deleting ? 0 : (el.selected ? 2 : 1)) !== rank) continue;  // 不属于这一档，跳过
      // 删除动画的缓动值同时驱动缩放和透明度；没在删除时恒为 0，等于原样绘制
      const e = el.deleting ? easeOutCubic(el.deleteP) : 0;
      // 公转中的元件画的是弧线上的插值位置：数据要等落位才改，所以此刻画面和数据是有意分开的
      let wx = el.wx, wy = el.wy, angle = el.angle;
      if (S.orbitActive && el.orbitU0 !== null) {
        const t = easeOutCubic(S.orbitP);
        const total = S.orbitTurns * 90;
        const rad = total * t * Math.PI / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        const du = el.orbitU0 - S.orbitPivotU;
        const dv = el.orbitV0 - S.orbitPivotV;
        // 吸附量随进度线性补上：走到头时画面位置正好等于落位后的格心，不会在收尾时跳半格
        wx = S.orbitPivotU + du * c + dv * s + el.orbitShiftU * t + 0.5;
        wy = S.orbitPivotV - du * s + dv * c + el.orbitShiftV * t + 0.5;
        angle = el.orbitAngle0 + total * t;
      }
      // 拖动缓动的视觉偏移叠在数据位置之上：数据已经跳到目标格，画面还差一点点，缓出追上后偏移归零
      // 偏移只影响画面，不参与模拟与占位判定，所以拖动途中激光立刻按新格重算，手感是「跟手但不硬跳」
      wx += el.mvOffU;
      wy += el.mvOffV;
      // 屏幕位置先算出来：剔除判定和摆位都要用它，算一次供两处使用
      const sx = worldToScreenX(wx);
      const sy = worldToScreenY(wy);
      // 视口剔除：这一帧它根本不会出现在画面上，跳过之后连路径都不用建
      if (sx < cullL || sx > cullR || sy < cullT || sy > cullB) {
        culled++;
        continue;
      }
      drawn++;
      // 配色按两个进度现算（进度没变就直接取上一次的结果），再收进当前档的批次里
      refreshElementColors(el);
      paintBatchAdd(el, sx, sy, angle, state.scale * (1 - e), 1 - e);
    }
    paintBatchFlush(S.ctx);   // 这一档收尾：每桶一次描边、一次填充
  }
  S.ctx.restore();
  // 本帧两个计数写回全局：调试面板的读数直接读它们，不必再数一遍
  // 整帧被跳过时这两个值保持上一次渲染的结果，读数因此读的是「最近一次真实渲染的规模」
  S.drawnElementCount = drawn;
  S.culledElementCount = culled;
  pval("叠加层", drawn - S.elemCacheDrawn);   // 探针读数：这一帧单独画的「热」元件有几个
}

// 找出指针当前所指格子里的元件：视口外或格内没有元件都返回 null
function findElementAtPointer() {
  if (!isInViewport(S.pointerSX, S.pointerSY)) return null;
  return findElementAt(cellCenterX(screenToWorldX(S.pointerSX)), cellCenterY(screenToWorldY(S.pointerSY)));
}

// 切换指针所在格光源的开关：只在指针下是存活的光源时生效，空格、其他类型、删除动画中的都忽略
// 开关一变，发射掩码随之改变，结算层下一微帧就会重算激光场
function toggleLightAtPointer() {
  const el = findElementAtPointer();
  if (el === null || el.deleting || el.typeId !== "light") return;
  el.on = !el.on;
  commitHistory();  // 开关本身也是电路状态的一部分，跟着一起可撤销
}

// 一键清除激光：把画面上的光与元件里记着的发射记录一并作废，元件与光源开关都不动
// 具体清哪些由结算层负责，这里只做入口，免得两处各清一半
function clearLaserField() {
  resetLaserField();
}

// 删除屏幕位置所在格的元件：视口外、格内没有元件、或该元件已在删除动画中，都直接忽略
function deleteElementAtScreen(screenX, screenY) {
  if (!isInViewport(screenX, screenY)) return;
  const el = findElementAt(cellCenterX(screenToWorldX(screenX)), cellCenterY(screenToWorldY(screenY)));
  if (el === null || el.deleting) return;
  el.deleting = true;
  el.deleteP = 0;
  S.rayGraph.dirty = true;  // 删除动画一开始就把它从模拟里摘掉，不等动画放完
  // 摘掉之后立刻重算一次激光场：它已经不算电路里的人了，光就不该再照着它走
  // 不补这一下的话，要等微帧时钟走到下一格才会更新，看着就是「已经删了，光还挂在上面」
  refreshLightField();
  commitHistory();  // 标记成「正在消失」这一刻它就已经不算电路里的人了，所以在这里记步
}

// 删除整个选区：选中的元件一起进入消失动画，压在下面的其他元件不受影响
// 顺序有讲究：先把它们逐个标成「正在删除」，再走选区总入口清空选中
// 删除中的元件不会被算作「离开选区」，所以不会像正常落位那样把落点上的其他元件一并顶掉
// 返回 true 表示这次按键已由选区接手，调用方不必再去删指针所在格
function deleteSelection() {
  let any = false;
  // 只走活跃表：选中的元件必定在活跃表里，十万个元件里只挑出手上这一批，不必扫全表
  for (let i = 0; i < S.activeEls.length; i++) {
    const el = S.activeEls[i];
    if (!el.selected || el.deleting) continue;
    el.deleting = true;
    el.deleteP = 0;
    any = true;
  }
  // 选区里的浮动文本一并删掉：它不是电路的一部分，所以没有消失动画，直接摘掉
  // 摘除要排在下面那次提交之前，这样一次按键只占一步撤销
  const anyText = deleteSelectedTexts();
  if (!any && !anyText) return false;
  // 先清浮动文本再走元件那个总入口：那一处的提交会把两半改动一起记成一步
  applyTextSelection(function () { return false; }, false);
  applySelection(function () { return false; }, false);
  return true;
}

// 每帧推进所有删除中的元件动画；动画走完只挂一个标记，等这一帧末尾统一压实一次
// 只走活跃表：正在删除的元件必定在活跃表里，不必为它们扫一遍全表
function updateDeletions(dt) {
  for (let i = 0; i < S.activeEls.length; i++) {
    const el = S.activeEls[i];
    if (!el.deleting) continue;
    el.deleteP = Math.min(1, el.deleteP + dt / CONFIG.elementDeleteDuration);
    if (el.deleteP >= 1) {
      // 动画期间这一格仍算被占用，虚影不会提前淡入；走到这里才挂标记，压实之后才真正腾出格子
      el.gone = true;
      S.pendingCompact = true;
    }
  }
}

// 压实元件表：把这一帧里「消失动画已走完」的元件真正摘掉，一次搬移解决
// 为什么不在动画走完的那一刻直接 splice：splice 一次就要把后面所有元件往前挪一格，
// 十万个元件里删一个就要搬十万次；攒到帧末一次压实，搬移量只跟这一帧真的消失了几个有关
// 自查通过：只按 gone 标记筛，删除动画还没走完的元件不动；摘掉的元件同时从格子索引里退掉，
// 下标全变之后阻挡图与结算缓冲一并作废重建，不会留下按下标串位的残留
function compactElements() {
  S.pendingCompact = false;
  let w = 0;
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (el.gone) { unindexElement(el); continue; }   // 从格子索引里退掉：这一格到这一刻才真正腾出来
    if (w !== i) { S.elements[w] = el; el.idx = w; }   // 下标前移了才需要改；没动过的下标本来就是对的
    w++;
  }
  S.elements.length = w;
  S.rayGraph.dirty = true;    // 下标全变，阻挡图必须按新下标重建
  resetSimBuffers();        // 发射表与接收表按下标存，一起作废
  invalidateElementCache(); // 结构变了，缓存位图整张作废
}

