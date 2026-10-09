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
  return rec;
}

// 序列化：把当前电路与视野转成纯数据对象，不碰画面也不碰文件，因此可以单独验证
// 只导出电路与视野两类；界面设置与配色属于工作环境偏好，不进存档
function serializeScene() {
  const list = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.deleting) continue;  // 正在播放消失动画的元件不算数，存下来会凭空多出一个
    list.push(elementToRecord(el));
  }
  return {
    format: "laser-gate",   // 格式标记：读档时用来挡住误把别的 JSON 当存档读的情况
    version: 1,             // 结构版本：以后改结构时递增，读档按它决定怎么解释
    view: {
      worldX: state.anchorWX,   // 参考点的世界坐标
      worldY: state.anchorWY,
      screenX: state.anchorSX,  // 同一个参考点落在屏幕上的位置，与缩放一起唯一确定当前视野
      screenY: state.anchorSY,
      scale: state.scale
    },
    elements: list
  };
}

// 当前程序认识的元件类型标识：校验存档时用它判断某条元件还能不能认出来
// 直接从元件类型表取键，以后加元件类型不必改这里
const KNOWN_ELEMENT_TYPES = Object.keys(ELEMENT_TYPES);

// 判断一个值是不是可用的有限数字：存档来自外部文件，字符串和 NaN 都不能放行
function isFiniteNumber(v) {
  return typeof v === "number" && isFinite(v);
}

// 反序列化：校验一份存档数据，逐条筛出能用的元件，并先判断整份文件能不能用
// 只做判断与换算，不碰画面也不读文件；返回 { ok, reason, view, elements, skipped }
//   ok       整份文件能不能用，false 时 reason 说明原因，此时元件列表为空
//   view     视野，缺失或取值不合法时为 null，交给后面应用的那一步退回默认视野
//   elements 校验通过的元件，字段已换算成程序内部用的形式
//   skipped  被跳过的条目与原因，用来告诉用户一共跳了几条
function parseScene(raw) {
  // 整份文件不可用的几种情况统一从这里返回，免得每个分支各写一遍
  const reject = function (reason) {
    return { ok: false, reason: reason, view: null, elements: [], skipped: [] };
  };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return reject("不是本程序的存档");
  if (raw.format !== "laser-gate") return reject("不是本程序的存档");
  if (raw.version !== 1) return reject("版本不认识");
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
    list.push({
      typeId: e.type,
      wx: e.gx + 0.5,     // 格索引换算回格心世界坐标，与序列化那一步互为逆运算
      wy: e.gy + 0.5,
      dir: e.dir,
      on: e.on === true  // 缺省当关：这个字段只有光源用得上，缺失不该让整条元件作废
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
  return { ok: true, reason: "", view: view, elements: list, skipped: skipped };
}

// 清空画布上所有元件并复位模拟状态：读档前必须走一遍，否则旧电路会和读进来的叠在一起
// 只清电路与推演状态，不动指针、槽位、弹窗这些界面状态——那些属于交互，不属于这一局
function clearScene() {
  elements.length = 0;    // 元件直接画在画布上，清掉数据就等于清掉画面，没有节点要拆
  recvMask = [];          // 接收掩码是按元件下标存的，元件没了它必须跟着清空，否则下标会串到新元件上
  laserSegments = [];     // 上一帧的激光场一并清掉，不然读档那一瞬间会闪出一片属于旧电路的激光
  lastEmit = null;        // 发射记录作废，让下一微帧从头重新推演
  microframe = 0;         // 微帧计数归零，新电路从第 0 帧重新开始
  microAcc = 0;           // 累加余数清零，免得带着旧电路攒下的零头多算一个微帧
  rayGraph.dirty = true;  // 阻挡图整体作废：放在最后做，避免在元件数组半替换的中途被触发重建
}

// 把校验过的存档应用到画面：先清空旧电路，再按存档重建元件，最后把视野设过去
// 传进来的是校验层的输出，数据已确认可用，这里不再重复判断
function applyScene(parsed) {
  clearScene();
  for (let i = 0; i < parsed.elements.length; i++) {
    const e = parsed.elements[i];
    const el = placeElement(e.wx, e.wy, e.dir, e.typeId);
    el.on = e.on;   // 放置时一律按关建立，这里还原存档里记下的光源开关
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
  sceneDirty = true;
}

