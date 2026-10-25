// scene.js：存档：电路与视野的序列化、反序列化、清空与应用。
"use strict";

/* ========== 存档（序列化与反序列化） ========== */

// 把一个元件转成一条存档记录：坐标由格心换算回整数格，朝向由目标角度换算
// 序列化整份存档与序列化剪贴板共用它，两处的换算规则不会各写一份、慢慢跑偏
function elementToRecord(el) {
  const rec = {
    type: el.typeId,
    gx: Math.round(el.wx - 0.5),  // 元件恒在格心，世界坐标必是半整数，换算成整数格索引无损且无浮点误差
    gy: Math.round(el.wy - 0.5),
    // 朝向取目标角度换算出来的离散值：旋转动画途中朝向索引还没同步，直接读它会存到转过之前的旧方向
    dir: ((Math.round(el.angleTarget / 90) % 4) + 4) % 4,
    on: el.on
  };
  // 标签只在真有文字时才写进去：绝大多数元件没有标签，空着能省下每一条几十字节
  // 方位角与距离都写：两者都是用户拖过的结果，漏掉任何一个，读回来标签都会跳到别处
  if (el.labelText !== "") {
    rec.label = el.labelText;
    rec.labelAngle = el.labelAngle;
    rec.labelGap = el.labelGap;
  }
  return rec;
}

// 存档的格式标记与结构版本：写出存档、校验存档、以及「新建文件」写的那份空存档都用这两个值
// 三处合成一处，改结构时只动这里，不会出现写出去的与认得的对不上
const SCENE_FORMAT = "laser-gate";   // string：格式标记，用来挡住误把别的 JSON 当存档读的情况
const SCENE_VERSION = 3;             // number：结构版本，以后改结构时递增，读档按它决定怎么解释
// 还认得哪些旧版本：读档时把它们当成「新字段全缺，取默认值」的同一份结构，不必各写一条转换分支
// 版本 2 给元件加了可选的标签字段；版本 3 给元件加了可选的发射掩码 out
// 缺了这张表的话，版本号一升，用户手上所有旧存档都会被「版本不认识」一句挡在门外
const SCENE_READABLE_VERSIONS = [1, 2, 3];  // Array<number>：本程序还能读的结构版本

// 序列化：把当前电路、浮动文本与视野转成纯数据对象，不碰画面也不碰文件，因此可以单独验证
// 只导出电路、文字与视野三类；界面设置与配色属于工作环境偏好，不进存档
function serializeScene() {
  const list = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.deleting) continue;  // 正在播放消失动画的元件不算数，存下来会凭空多出一个
    const rec = elementToRecord(el);
    // 发射掩码必须一起存：它是推演状态，不是布局的函数
    // 闭合成环的电路（比如一圈偏转器）有多于一个稳态——环里全灭，或者一段激光在环里绕着走——
    // 从同一份布局冷启动时，引擎会先进后者：反相器按「没有输入就发射」先吐出一口光，
    // 这口光一旦进了闭合的环就再也没有去处，于是每次打开存档都能看到一段激光在环里转
    // 记下这一刻的发射掩码，读档时接着往下推，第一眼就与存盘时看到的一模一样
    // 只写进存档，不写进 elementToRecord：历史记录比的是用户的编辑意图，而这个字段每微帧都会变，
    // 混进去会让每一次微帧都像一次改动，撤销栈会被撑爆
    rec.out = el.out;
    list.push(rec);
  }
  const textList = [];
  // 内容还是空的就跳过：原地输入时那块文字会短暂地存在但没有内容，写进存档会凭空多出一条空记录
  for (let i = 0; i < texts.length; i++) {
    if (texts[i].text.trim() === "") continue;
    textList.push(textToRecord(texts[i]));
  }
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    view: {
      worldX: state.anchorWX,   // 参考点的世界坐标
      worldY: state.anchorWY,
      screenX: state.anchorSX,  // 同一个参考点落在屏幕上的位置，与缩放一起唯一确定当前视野
      screenY: state.anchorSY,
      scale: state.scale
    },
    elements: list,
    // 浮动文本：与元件并列的另一类画布内容，一起写进文件，读档时一起还原
    texts: textList
  };
}

// 一份空存档的文本：一个元件都没有，只有格式标记与版本号
// 新建出来的存档文件先写上它，双击打开就是一张空画布；留一个零字节文件的话，
// 打开时会因为「内容不是合法的 JSON」被拒，用户看到的是报错而不是一张白纸
// 不带 view：缺了它，读档那一步会退回默认视野，正是新建该有的样子
function emptySceneText() {
  return JSON.stringify({ format: SCENE_FORMAT, version: SCENE_VERSION, elements: [] });
}

// 当前程序认识的元件类型标识：校验存档时用它判断某条元件还能不能认出来
// 直接从元件类型表取键，以后加元件类型不必改这里
const KNOWN_ELEMENT_TYPES = Object.keys(ELEMENT_TYPES);

// 判断一个值是不是可用的有限数字：存档来自外部文件，字符串和 NaN 都不能放行
function isFiniteNumber(v) {
  return typeof v === "number" && isFinite(v);
}

// 反序列化：校验一份存档数据，逐条筛出能用的元件与浮动文本，并先判断整份文件能不能用
// 只做判断与换算，不碰画面也不读文件；返回 { ok, reason, view, elements, texts, skipped }
//   ok       整份文件能不能用，false 时 reason 说明原因，此时元件与文字列表都为空
//   view     视野，缺失或取值不合法时为 null，交给后面应用的那一步退回默认视野
//   elements 校验通过的元件，字段已换算成程序内部用的形式
//   texts    校验通过的浮动文本，坐标是世界坐标，不换算
//   skipped  被跳过的条目与原因，用来告诉用户一共跳了几条
function parseScene(raw) {
  // 整份文件不可用的几种情况统一从这里返回，免得每个分支各写一遍
  const reject = function (reason) {
    return { ok: false, reason: reason, view: null, elements: [], texts: [], skipped: [] };
  };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return reject("不是本程序的存档");
  if (raw.format !== SCENE_FORMAT) return reject("不是本程序的存档");
  if (SCENE_READABLE_VERSIONS.indexOf(raw.version) < 0) return reject("版本不认识");
  if (!Array.isArray(raw.elements)) return reject("不是本程序的存档");

  const list = [];
  const skipped = [];
  for (let i = 0; i < raw.elements.length; i++) {
    const e = raw.elements[i];
    if (e === null || typeof e !== "object" || Array.isArray(e)) { skipped.push({ reason: "条目不是对象", raw: e }); continue; }
    if (KNOWN_ELEMENT_TYPES.indexOf(e.type) < 0) { skipped.push({ reason: "元件类型不认识", raw: e }); continue; }
    // 坐标必须是整数：元件恒在格心，非整数说明这份数据不是本程序写的，放进去会落在格子中间
    if (!Number.isInteger(e.gx) || !Number.isInteger(e.gy)) { skipped.push({ reason: "坐标不是整数", raw: e }); continue; }
    // 朝向必须是 0~3：超范围的朝向会让发射方向掩码算出一个不存在的边，模拟会整个错乱
    if (!Number.isInteger(e.dir) || e.dir < 0 || e.dir > 3) { skipped.push({ reason: "朝向不合法", raw: e }); continue; }
    // 标签是可选的：没有 label 或它不是字符串，就当这个元件没有标签，元件本身照常收下
    // 方位角与距离都宽松：缺了或不合法就取默认值（正下方、离一格的四分之三），不让一个坏掉的标签把整条元件作废
    // 距离还要夹回区间内：旧存档没有这个字段，手改过的存档也可能写出一个荒唐的值
    const hasLabel = typeof e.label === "string" && e.label !== "";
    list.push({
      typeId: e.type,
      wx: e.gx + 0.5,     // 格索引换算回格心世界坐标，与序列化那一步互为逆运算
      wy: e.gy + 0.5,
      dir: e.dir,
      on: e.on === true,  // 缺省当关：这个字段只有光源用得上，缺失不该让整条元件作废
      // 发射掩码：只接受「不发射」与「朝本元件箭头方向发射」两种合法值
      // 缺字段（版本 1、2 的旧档）或其它任何值都当 0，由引擎从全灭开始推演
      // 手改出来的越界位不能放行：它会让激光在一个微帧里指向一条不存在的边，
      // 那道光顺着阻挡图留在闭合的环里，正好又复现出「打开存档凭空多出一段光」
      out: e.out === (1 << e.dir) ? e.out : 0,
      labelText: hasLabel ? e.label : "",
      // 方位角归一化到 0~360：负数或超过一圈的值会让锚点算到别处，直接取模摆回正区间
      labelAngle: hasLabel && isFiniteNumber(e.labelAngle)
        ? ((e.labelAngle % 360) + 360) % 360 : CONFIG.labelAngleDefault,
      labelGap: hasLabel && isFiniteNumber(e.labelGap)
        ? Math.min(CONFIG.labelGapMax, Math.max(CONFIG.labelGapMin, e.labelGap)) : CONFIG.labelGapDefault
    });
  }

  // 视野五项必须都是有限数，缩放还必须是正数：有一项不对就整体退回默认视野，不让坏数据把画面推到看不见的地方
  let view = null;
  const v = raw.view;
  if (v !== null && typeof v === "object" && !Array.isArray(v) &&
      isFiniteNumber(v.worldX) && isFiniteNumber(v.worldY) &&
      isFiniteNumber(v.screenX) && isFiniteNumber(v.screenY) &&
      isFiniteNumber(v.scale) && v.scale > 0) {
    view = { worldX: v.worldX, worldY: v.worldY, screenX: v.screenX, screenY: v.screenY, scale: v.scale };
  }
  // 浮动文本：整份文件里没有这一项就当一块都没有，所以老存档读进来照样能用
  // 逐条宽严分明：坐标必须是有限数字、文字必须是非空字符串，坏掉的单条跳过并计入 skipped，不牵连整份文件
  // 文字为空的那一条也跳过：它在画布上什么都看不见，却会占着一个可以点中的空盒子，属于看不见的麻烦
  const textList = [];
  const rawTexts = Array.isArray(raw.texts) ? raw.texts : [];
  for (let i = 0; i < rawTexts.length; i++) {
    const t = rawTexts[i];
    if (t === null || typeof t !== "object" || Array.isArray(t)) { skipped.push({ reason: "文字条目不是对象", raw: t }); continue; }
    if (!isFiniteNumber(t.x) || !isFiniteNumber(t.y)) { skipped.push({ reason: "文字坐标不合法", raw: t }); continue; }
    if (typeof t.text !== "string" || t.text.trim() === "") { skipped.push({ reason: "文字内容为空", raw: t }); continue; }
    textList.push({ wx: t.x, wy: t.y, text: t.text });
  }
  return { ok: true, reason: "", view: view, elements: list, texts: textList, skipped: skipped };
}

// 清空画布上所有元件并复位模拟状态：读档前必须走一遍，否则旧电路会和读进来的叠在一起
// 只清电路与推演状态，不动指针、槽位、弹窗这些界面状态——那些属于交互，不属于这一局
function clearScene() {
  // 正在原地编辑的浮动文本先收掉：它马上就要被下面那行清空，不收的话输入框会留在屏幕上指向一块已消失的文字
  // 按「放弃」收：这一刻本来就是要把画面整个换掉，没必要把一次半截的输入当成改动记进历史
  if (textEditing) endTextEditing(false);
  elements.length = 0;    // 元件直接画在画布上，清掉数据就等于清掉画面，没有节点要拆
  texts.length = 0;       // 浮动文本同样直接画在画布上，一起清掉；它与元件是两类东西，各清各的
  rebuildCellIndex();     // 格子索引整张清空：元件都没了，索引里不能留下指向旧元件的条目
  resetSimBuffers();      // 发射表与接收表按元件下标存，元件没了必须跟着清零，否则下标会串到新元件上
  laserSegments = [];     // 上一帧的激光场一并清掉，不然读档那一瞬间会闪出一片属于旧电路的激光
  microframe = 0;         // 微帧计数归零，新电路从第 0 帧重新开始
  microAcc = 0;           // 累加余数清零，免得带着旧电路攒下的零头多算一个微帧
  rayGraph.dirty = true;  // 阻挡图整体作废：放在最后做，避免在元件数组半替换的中途被触发重建
}

// 把校验过的存档应用到画面：先清空旧电路，再按存档重建元件，最后把视野设过去
// 传进来的是校验层的输出，数据已确认可用，这里不再重复判断
function applyScene(parsed) {
  clearScene();
  invalidateElementCache();   // 旧场景的元件缓存整张作废，新场景第一帧重画
  for (let i = 0; i < parsed.elements.length; i++) {
    const e = parsed.elements[i];
    const el = placeElement(e.wx, e.wy, e.dir, e.typeId);
    el.on = e.on;   // 放置时一律按关建立，这里还原存档里记下的光源开关
    // 发射掩码接着存档里那一刻写回：它是推演状态，让引擎自己重推的话，闭合环会有另一条稳态
    // 必须在下面的 runToQuiescence 之前写回，那一步才只是在已经对齐的状态上补齐接收与激光场
    el.out = e.out;
    // 标签同样还原：放置时是空标签、正下方，这里把存档里记下的文字、方位与距离写回去
    el.labelText = e.labelText;
    el.labelAngle = e.labelAngle;
    el.labelGap = e.labelGap;
  }
  // 浮动文本按存档里的世界坐标放回去，位置不吸附网格，所以原样照搬就是对的
  for (let i = 0; i < parsed.texts.length; i++) {
    const t = parsed.texts[i];
    placeText(t.wx, t.wy, t.text);
  }
  // 视野：当前值和目标值一起设。只设目标值的话，相机会从旧位置慢慢飘过去，而不是立刻到位
  if (parsed.view !== null) {
    state.anchorWX = parsed.view.worldX;
    state.anchorWY = parsed.view.worldY;
    state.anchorSX = parsed.view.screenX;
    state.anchorSY = parsed.view.screenY;
    state.tAnchorSX = parsed.view.screenX;
    state.tAnchorSY = parsed.view.screenY;
    state.scale = parsed.view.scale;
    state.logScale = Math.log(parsed.view.scale);   // 缩放按对数插值，两个表示必须同时设，否则相机会自己动一下
    state.tLogScale = state.logScale;
  }
  resetHistory();  // 换文档不是编辑动作：上一条电路的历史留着只会撤出莫名其妙的画面，直接清空
  docDirty = false;  // 画面刚被这份存档铺出来，这一刻它与磁盘上那份完全一致，未保存的标记要灭掉
  // 把电路一次推到稳定态再交出去，第一帧看到的就是定下来的光，而不是一层层爬进来的过程
  // 引擎每微帧只往下推一层，按默认速度一层要等 0.12 秒，读一份深一点的电路就能眼看着光从光源一格格爬过去，
  // 中途反相器还要翻几下，像是激光乱了套；这里走的是与「极速」同一条路：逻辑语义完全一样，只是不再等真实时间
  // 各元件的发射掩码在上面已经按存档写回，所以这一步不是在「点火」，只是把接收掩码与激光场补齐
  // 若反过来让它从全灭的状态自己推：反相器会按「没有输入就发射」先吐光，那道光进了闭合的环就再也出不来
  runToQuiescence();
  sceneDirty = true;
}

