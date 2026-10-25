// circuit.js：电路结算：阻挡图重建、微帧推进、发射、接收掩码、激光场。
"use strict";

/* ========== 结算层的稀疏索引 ==========
   为什么要这几张小表：一帧里往往要结算好几个微帧，若每个微帧都扫一遍十万个元件，光空转就把帧时间吃光了。
   元件表里绝大多数元件既不发射也不接收，扫它们纯属白干。于是把「谁在发射」单独记一份，
   每个微帧只沿着这份小表走：发射者的行与列、这些行列上的元件、以及真正收到光的那些元件。
   这几张表与元件表同生共死：它们全都在阻挡图重建那一趟里重算，中途不会对不上。
   声明在这里而不是 state.js：首页的演示也加载这份引擎，它自带一套元件表与阻挡图，
   把结算状态跟着引擎走，两个页面就都能用上，不必各维护一份。 */

let emit = new Uint8Array(0);   // Uint8Array：本微帧每个元件的发射掩码，按元件在元件表里的下标存
let lightEls = [];   // Array<Element>：所有光源；每微帧按开关与朝向现算发射，不进发射表
let gateEls = [];    // Array<Element>：所有门（除光源与灯以外的全部类型）；整表重排输出时走它
let lampEls = [];    // Array<Element>：所有灯；整表重排时按掩码刷新「有没有被照到」
let gateOuts = [];   // Array<Element>：当前 out 非零的门，即「正在发射的门」；每微帧只走这一批
let recvEls = [];    // Array<Element>：本微帧接收掩码非零的元件
let recvPrev = [];   // Array<Element>：上一微帧接收掩码非零的元件；排输出时要照顾其中刚失去输入的那批
const emitRowKeys = new Set();  // Set<number>：本微帧有发射者的行号（整数格号，不是浮点坐标）
const emitColKeys = new Set();  // Set<number>：本微帧有发射者的列号（整数格号，不是浮点坐标）
let simEmitDiff = true;   // boolean：发射表与上一微帧有没有差异；初值 true 表示「还没推演过」
let simFullPass = true;   // boolean：要不要对全部门整表重排一次输出；阻挡图重建后置 true

// 结算缓冲按需扩容：元件表变长时把发射表与接收表一起撑大，旧内容照抄，不清零
// 为什么用定型数组：每微帧新建一个十万长的普通数组会让垃圾回收跟着帧率一起抖
function ensureSimBuffers() {
  const n = elements.length;
  if (emit.length < n) { const next = new Uint8Array(n); next.set(emit); emit = next; }
  if (recvMask.length < n) { const next = new Uint8Array(n); next.set(recvMask); recvMask = next; }
}

// 把结算层按下标存的东西整体作废：元件下标一变（压实、读档、清空），这些内容必须清零重来
// 分类表（光源/门/灯）不在这里重建，它们由阻挡图重建那一趟顺手重算，那里本来就扫全表
function resetSimBuffers() {
  emit.fill(0);
  recvMask.fill(0);
  gateOuts.length = 0;
  recvEls.length = 0;
  recvPrev.length = 0;
  simEmitDiff = true;   // 发射表清零了，下一微帧必须重算激光场与掩码
  simFullPass = true;   // 门的输出要按新的下标整表重排一遍
}

/* ========== 阻挡图 ========== */

// 取元件在全局某轴上的阻挡属性：元件朝左/朝右时自身转了 90°，局部水平与垂直互换
// 参数 horizontal 为 true 表示问「挡不挡全局水平激光」，false 表示问全局垂直
function blocksGlobal(el, horizontal) {
  const t = ELEMENT_TYPES[el.typeId];
  // 类型不认识时按「实体」处理：宁可挡住激光，也不让一张坏数据把整张阻挡图的重建打断
  if (t === undefined) return true;
  const same = horizontal ? t.blocksH : t.blocksV;
  const swapped = horizontal ? t.blocksV : t.blocksH;
  return el.dir % 2 === 0 ? same : swapped;
}

// 元件所在格号：位置恒在格心，减去半格再四舍五入就是整数格号
// 行、列的键一律用这个整数，而不是浮点坐标：坐标只要带一丝误差，浮点键就和同一行的其它元件对不上，
// 那个元件会从阻挡图里整个消失（激光看上去直接穿过去）；整数键没有这个风险
function gxOf(el) { return Math.round(el.wx - 0.5); }
function gyOf(el) { return Math.round(el.wy - 0.5); }

// 重建阻挡图：按格号分出行、列，各自排序后扫一遍，给每个元件记下四方向第一个阻挡者
// 结算时只需读表，不必每微帧拿坐标比大小，所以只在元件增删或朝向改变后调用一次
// 分类表与元件下标也在这里一并刷新：这里本来就扫全表，顺手记下来，结算层之后就不必再扫第二遍
function rebuildRayGraph() {
  ensureSimBuffers();
  const rows = new Map();
  const cols = new Map();
  lightEls.length = 0;
  gateEls.length = 0;
  lampEls.length = 0;
  // 正在删除的、以及悬空的元件都不参与模拟：前者算「已被删掉」，后者算「还没放进世界」
  // 悬空即被选中；选中等于离地，要等落位（取消选中）那一刻才回到电路里
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    el.idx = i;   // 元件在元件表里的下标：发射表与接收表都按它存，增删之后必须重新对齐
    // 位置统一吸附回格心：几何的唯一真相是整数格号，坐标只是它的显示形态
    // 每次重建都校正一次，历史数据或异常操作留下的偏差到这里就被抹平，不会再出现某个元件从阻挡图里漏掉
    const gx = gxOf(el), gy = gyOf(el);
    const cx = gx + 0.5, cy = gy + 0.5;
    if (el.wx !== cx || el.wy !== cy) {
      if (Math.abs(el.wx - cx) > 1e-6 || Math.abs(el.wy - cy) > 1e-6) {
        console.warn("[阻挡图] 元件坐标不在格心，已吸附：", el.typeId, el.wx, el.wy);
      }
      const owx = el.wx, owy = el.wy;
      el.wx = cx;
      el.wy = cy;
      // 编辑器里还有一套按格查元件的索引，坐标动了要跟着挪；首页的演示电路没有这套索引，先判存在
      if (typeof reindexElement === "function") reindexElement(el, owx, owy);
    }
    // 分类只看类型，不看状态：悬空与正在消失的元件照样记在表里，重新回到电路时才不必重建这几张表
    if (el.typeId === "light") lightEls.push(el);
    else if (el.typeId === "lamp") lampEls.push(el);
    else gateEls.push(el);
    if (el.deleting || el.selected) continue;
    if (!rows.has(gy)) rows.set(gy, []);
    rows.get(gy).push(i);
    if (!cols.has(gx)) cols.set(gx, []);
    cols.get(gx).push(i);
  }
  // 排序之后「第一个阻挡者」就退化成数组上的一次邻项扫描，不用再比坐标
  rows.forEach(function (arr) {
    arr.sort(function (a, b) { return gxOf(elements[a]) - gxOf(elements[b]); });
  });
  cols.forEach(function (arr) {
    arr.sort(function (a, b) { return gyOf(elements[a]) - gyOf(elements[b]); });
  });

  const n = elements.length;
  const endR = new Array(n).fill(-1);
  const endL = new Array(n).fill(-1);
  const endD = new Array(n).fill(-1);
  const endU = new Array(n).fill(-1);

  // 行内向右：从右往左扫，扫到 p 时手上拿的就是 p 右边最近的阻挡者位置
  // 没人挡时终点记行数组长度 k，这样 [p, endR] 正好是激光覆盖的下标闭区间，结算时不用再分支
  rows.forEach(function (arr) {
    const k = arr.length;
    let next = k;
    for (let p = k - 1; p >= 0; p--) {
      const i = arr[p];
      endR[i] = next;
      if (blocksGlobal(elements[i], true)) next = p;
    }
    // 行内向左：从左往右扫，没人挡记 -1
    let prev = -1;
    for (let p = 0; p < k; p++) {
      const i = arr[p];
      endL[i] = prev;
      if (blocksGlobal(elements[i], true)) prev = p;
    }
  });

  // 列：列数组按 wy 升序，而 wy 越大在屏幕上越靠上，所以下标增大方向是「上」
  cols.forEach(function (arr) {
    const k = arr.length;
    let next = k;
    for (let p = k - 1; p >= 0; p--) {
      const i = arr[p];
      endU[i] = next;   // 下标更大 = wy 更大 = 视觉更靠上，所以这是「向上」的阻挡者
      if (blocksGlobal(elements[i], false)) next = p;
    }
    let prev = -1;
    for (let p = 0; p < k; p++) {
      const i = arr[p];
      endD[i] = prev;   // 下标更小 = wy 更小 = 视觉更靠下
      if (blocksGlobal(elements[i], false)) prev = p;
    }
  });

  rayGraph.rows = rows;
  rayGraph.cols = cols;
  rayGraph.endR = endR;
  rayGraph.endL = endL;
  rayGraph.endD = endD;
  rayGraph.endU = endU;
  rayGraph.dirty = false;

  // 几何全变了，按下标存的发射表与接收表一律清零，再按各门自己记着的 out 重新登记「正在发射的门」
  // out 是推演状态，不随几何变化：它跟着元件走，所以这里读出来接着用，不重置
  emit.fill(0);
  recvMask.fill(0);
  gateOuts.length = 0;
  recvEls.length = 0;
  recvPrev.length = 0;
  for (let j = 0; j < gateEls.length; j++) {
    const el = gateEls[j];
    if (el.out !== 0) { el.inOut = true; gateOuts.push(el); }
    else el.inOut = false;
  }
  simEmitDiff = true;   // 发射表整体重来，下一微帧必须重算激光场与掩码
  simFullPass = true;   // 门的输出要按新几何整表重排一遍
}

/* ========== 结算 ========== */

// 单微帧结算：重建阻挡图（若脏）→ 收集发射 → 算接收掩码与激光场
// 元件规则已接入 elementEmit，后续新增元件类型只需在 elementEmit 里补一条分支
// 返回「本微帧开头的发射表与上一微帧有没有差异」，零延迟模式靠它判断链是否已经停住
function stepMicroframe() {
  // 元件增删或朝向定下来之后才重建阻挡图；重建会让上一微帧的发射表作废，必须重算
  if (rayGraph.dirty) rebuildRayGraph();
  const diff = buildEmitMask();
  // 发射表与上一微帧完全一致时，激光场与接收掩码必然不变，跳过重算
  // 既省掉空转时的重复计算，也让下面那几张小表只在真有变化时才动
  if (simEmitDiff) {
    recomputeMasks();
    laserSegments = computeLaserSegments();
    scheduleOutputs();   // 按本微帧的接收排下一微帧的输出，微时序的 1 帧延迟就落在这一步
    updateLampInputs();  // 顺手把接收结果落到灯身上，决定它这一微帧亮不亮
    simEmitDiff = false;
    simFullPass = false;
    sceneDirty = true;   // 激光场变了，强制重绘一次，否则静止判定会把这次变化吞掉
    // 探针读数：本微帧真正参与运算的规模。这几个数直接说明稀疏化有没有生效——它们应当远小于元件总数
    pval("发射行列", emitRowKeys.size + emitColKeys.size);
    pval("接收元件", recvEls.length);
    pval("激光段", laserSegments.length);
  }
  microframe++;  // 时钟自增：本微帧的结算已完成，进入下一微帧
  return diff;
}

// 只把激光场按当前状态重算一遍，不推进微帧时钟，也不排下一微帧的输出
// 用在「参与模拟的集合刚变了、时钟还没走到下一微帧」的场合：选中与落位改的是集合本身，
// 谁挡谁、光照到谁这些几何结论应当立刻生效，不该等到下一个微帧才更新
// 而元件之间那 1 微帧的延迟属于逻辑推演，仍旧交给 stepMicroframe 按微帧时钟走，两条路互不干扰
// 特意不清 simEmitDiff 与 simFullPass：它们记的是「还没按新几何重推过」，
// 清掉的话下一微帧会跳过结算，整条链就卡住了
function refreshLightField() {
  // 暂停时连几何重算也一并冻结：删元件、挪元件、选中离地都不该让激光当场变化
  // 否则暂停只冻住了时间推进，画面上的光却仍跟着编辑走，看起来就像「暂停了还在算」
  // 这里只把阻挡图标脏，等恢复时按那一刻的电路统一重算一次，光和元件才对得上
  if (!rightToolRunning) {
    rayGraph.dirty = true;
    return;
  }
  if (rayGraph.dirty) rebuildRayGraph();
  buildEmitMask();
  recomputeMasks();
  laserSegments = computeLaserSegments();
  updateLampInputs();   // 顺手把「现在照到谁」落到灯身上，免得灯要等下一个微帧才亮
  sceneDirty = true;
}

// 清掉激光：不碰元件位置、朝向与光源开关，只把「光」这一层全部作废
// 关键是元件自己记着「这一微帧往哪射」的那份记录要一起清，否则下一次重算会拿旧记录把光原样画回来
// 清完之后有光源的电路会从下一微帧重新点火、逐微帧往下传，光不会再一瞬间整张复原
function resetLaserField() {
  for (let i = 0; i < elements.length; i++) {
    elements[i].out = 0;      // 门记着的输出方向清零，等于忘掉自己正在发光
    elements[i].inOut = false;  // 同时退出「正在发射的门」那张小表
  }
  emit.fill(0);               // 发射表清零，下一微帧收集时会按光源开关重新填
  recvMask.fill(0);           // 接收掩码清零，灯与门的输入从「没收到」重新算起
  gateOuts.length = 0;        // 待排输出的门清空，链条从源头重来
  recvEls.length = 0;
  recvPrev.length = 0;
  laserSegments = [];         // 画面上的激光线段整份清空
  for (let i = 0; i < lampEls.length; i++) lampEls[i].litIn = false;  // 灯回到不亮
  simEmitDiff = true;         // 明确要求下一微帧重算，不靠旧发射表跳过
  simFullPass = true;         // 灯按整表重排一遍，免得稀疏表里漏掉刚清掉的灯
  microAcc = 0;               // 丢掉半截微帧，从干净的边界重新计
  sceneDirty = true;          // 强制重画一次，否则静止判定会把这次清除吞掉
}

// 按当前微帧时长推进时钟：把本帧真实时长换算成微帧数逐个结算
// 用累加余数而不是直接取整，避免帧率与微帧时长不成整数倍时把零头丢掉、时钟越走越慢
// 单帧步数设上限，超出的积压时间直接丢弃，否则一帧要补算的量会越滚越大
function stepSimulation(dt) {
  // 运行开关停在「暂停」：这一帧不做任何结算，微帧时钟也不走，整条逻辑链冻在原地
  // 累加余数一并清零：不攒时间，恢复时就不会把暂停期间的时间一次性补算成几十个微帧
  // 编辑动作自己会调 refreshLightField 按新几何重算一次，所以暂停期间挪元件、放元件，画面照样跟手
  if (!rightToolRunning) {
    microAcc = 0;
    pcount("微帧", 0);
    return;
  }
  // 速度滑块拉到最左端：不设延迟，本帧内直接把整条链结算到底，不等真实时间
  if (microDt <= 0) {
    runToQuiescence();
    return;
  }
  microAcc += dt;
  let steps = 0;
  while (microAcc >= microDt && steps < CONFIG.maxStepsPerFrame) {
    microAcc -= microDt;
    stepMicroframe();
    steps++;
  }
  if (microAcc >= microDt) microAcc = 0;
  pcount("微帧", steps);   // 探针读数：本帧实际结算了几个微帧
}

// 不设延迟时把整条链在一帧内跑完：反复结算，直到某一微帧开头的发射表与上一微帧完全相同
// 发射表没变说明没有任何元件再产生新输出，链已停住；上限只用来防止逻辑成环时死循环
// 元件之间那 1 微帧的延迟仍然保留，只是不再等真实时间，逻辑语义与慢速时完全一致
// 每一微帧只沿着几张发射/接收的小表走，所以这条循环的长度不再与元件总数挂钩
function runToQuiescence() {
  microAcc = 0;  // 零延迟下不攒余数，否则切回慢速时会突然补算一帧
  let steps = 0;   // 探针读数：这一帧为了跑到底结算了几个微帧
  for (let i = 0; i < CONFIG.maxQuiescentSteps; i++) {
    steps++;
    if (!stepMicroframe()) { pcount("微帧", steps); return; }
  }
  pcount("微帧", steps);   // 撞上安全上限时也把步数记上，这种情形值得在读数里看见
}

// 收集本微帧所有元件要发射的方向，写进发射表，返回「与上一微帧有没有差异」
// 只走两张小表：所有光源（开关与朝向现算）与正在发射的门（out 由上一微帧排好）
// 正在删除的与悬空的元件一律算作不发射，既不发射也不接收
// 顺手把「发射者所在的行与列」记下来：接收掩码与激光场只需扫这些行列，没发射者的行列扫了也是白扫
function buildEmitMask() {
  let changed = false;
  emitRowKeys.clear();
  emitColKeys.clear();
  for (let j = 0; j < lightEls.length; j++) {
    const el = lightEls[j];
    const v = (el.deleting || el.selected) ? 0 : elementEmit(el);
    if (emit[el.idx] !== v) { emit[el.idx] = v; changed = true; }
    if (v !== 0) { emitRowKeys.add(gyOf(el)); emitColKeys.add(gxOf(el)); }
  }
  // 门：已经不在发射的（inOut 被清掉）顺手从表里摘掉，它的发射值在这里清成 0，差异自然被认出来
  let w = 0;
  for (let j = 0; j < gateOuts.length; j++) {
    const el = gateOuts[j];
    if (!el.inOut) { if (emit[el.idx] !== 0) { emit[el.idx] = 0; changed = true; } continue; }
    gateOuts[w++] = el;
    const v = (el.deleting || el.selected) ? 0 : el.out;
    if (emit[el.idx] !== v) { emit[el.idx] = v; changed = true; }
    if (v !== 0) { emitRowKeys.add(gyOf(el)); emitColKeys.add(gxOf(el)); }
  }
  gateOuts.length = w;
  simEmitDiff = simEmitDiff || changed;   // 重建过阻挡图时它本来就是 true，这里只把新的差异并进去
  return changed;
}

// 单个元件的输出规则：返回它本微帧要发射的方向位掩码，0 表示不发射
// 光源：开启时朝箭头方向发射；它不接收任何输入，所以只看自身开关
// 灯：只作指示，收到光也不发射，永远返回 0
// 偏转器与透射器：输出规则相同（收到有效输入就朝箭头方向发），具体值由上一微帧排好的 el.out 给出
function elementEmit(el) {
  if (el.typeId === "light") return el.on ? (1 << el.dir) : 0;
  if (el.typeId === "lamp") return 0;
  return el.out;
}

// 把本微帧的接收结果落到灯身上：只要有任何一侧的激光射到它，就算被照亮
// 灯是实体，来光到它中心即终止，所以「被照到」正好等于接收掩码非零，不需要再区分方向
// 只在掩码重算的分支里调用：掩码不变时灯的亮灭自然沿用上一微帧，不会无故闪断
// 整表重排时按全部灯走一遍；平常只走两张接收小表，没在表里的灯掩码一动没动
function updateLampInputs() {
  if (simFullPass) {
    for (let j = 0; j < lampEls.length; j++) {
      const el = lampEls[j];
      el.litIn = recvMask[el.idx] !== 0;
    }
    return;
  }
  for (let j = 0; j < recvPrev.length; j++) {
    const el = recvPrev[j];
    if (el.typeId === "lamp") el.litIn = recvMask[el.idx] !== 0;
  }
  for (let j = 0; j < recvEls.length; j++) {
    const el = recvEls[j];
    if (el.typeId === "lamp") el.litIn = recvMask[el.idx] !== 0;
  }
}

// 按本微帧的接收结果安排各元件下一微帧的输出，实现文档 §8.2 的「t 微帧接收、t+1 微帧输出」
// 光源不参与：它的输出完全由开关决定，elementEmit 里已经直接算好
// 灯也不参与：它只作指示，收到光只用来点亮自己，不会往下游发
// 整表重排时走全部门；平常只走两张接收小表，加上「上一微帧收到、本微帧没收到」的那批
// 后者不能漏：掩码归零之后非门要重新吐光，漏了它这盏灯（非门）就永远不再亮
function scheduleOutputs() {
  if (simFullPass) {
    for (let j = 0; j < gateEls.length; j++) {
      const el = gateEls[j];
      applyGateOutput(el, recvMask[el.idx]);
    }
    return;
  }
  for (let j = 0; j < recvPrev.length; j++) {
    const el = recvPrev[j];
    if (recvMask[el.idx] === 0) applyGateOutput(el, 0);
  }
  for (let j = 0; j < recvEls.length; j++) {
    const el = recvEls[j];
    applyGateOutput(el, recvMask[el.idx]);
  }
}

// 按一个门本微帧收到的光重排它的输出：出口规则是「只朝箭头方向输出」，
// 所以来自箭头侧的输入一律无效，只有其他侧来光才算有效输入
// 反相器是非门：有有效输入就不发射、没有输入才发射，正好与偏转器、透射器相反
// 结果与旧值相同就直接返回：省掉一次表操作，也让「有没有新输出」的判定不被无谓地打扰
function applyGateOutput(el, recv) {
  if (el.deleting || el.selected) return;   // 悬空与正在消失的元件不参与推演，输出原样留着
  const valid = recv & ~(1 << el.dir);      // 抹掉出口侧那一位，剩下的位里只要有一位就是有效输入
  const v = el.typeId === "inverter" ? (valid ? 0 : (1 << el.dir)) : (valid ? (1 << el.dir) : 0);
  if (v === el.out) return;
  el.out = v;
  if (v !== 0) {
    if (!el.inOut) { el.inOut = true; gateOuts.push(el); }   // 开始发射：登记进发射表，下一微帧才真正射出
  } else {
    el.inOut = false;   // 停止发射：不在这里动发射表，下一微帧开头重建发射表时会认出来并清掉
  }
}

// 算出每个元件的接收掩码：某一位为 1，表示「有一个位于我这一侧的发射者，它的激光覆盖到了我」
// 注意不是「我这一侧有没有激光」：从对面射来又穿过去的光两侧都有，但它只从对面来，出口规则要靠这个区别
// 每行每列各扫两遍：前缀最大管「左边来的光最远射到哪」，后缀最小管「右边来的光最远射到哪」
// 只扫有发射者的行列：没有发射者的行列既射不出光，也没有人能收到光，扫它纯属白干
function recomputeMasks() {
  // 上一微帧收到光的那些元件，掩码先全部归零：本微帧的光照重新扫一遍，没被照到的自然留在零上
  for (let j = 0; j < recvEls.length; j++) recvMask[recvEls[j].idx] = 0;
  // 两张表交换：recvPrev 收下「上一微帧谁在接收」，排输出时要照顾其中刚失去输入的那批
  const spare = recvPrev;
  recvPrev = recvEls;
  recvEls = spare;
  recvEls.length = 0;

  // 行：从左往右，reach 是「左边所有朝右发射的激光里，能覆盖到的最右位置」
  // 键是整数格号，与阻挡图的行键同源，因此不会因为坐标精度而查不到这一行
  emitRowKeys.forEach(function (gy) {
    const arr = rayGraph.rows.get(gy);
    if (arr === undefined) return;   // 这一行现在没有存活元件了
    const k = arr.length;
    let reach = -1;
    for (let p = 0; p < k; p++) {
      const i = arr[p];
      // 先判后记，严格不等式把元件自己排除在外：自己发的光不该算成自己的输入
      if (reach >= p) markRecv(i, SIDE_LEFT);
      if (emit[i] & SIDE_RIGHT) reach = Math.max(reach, rayGraph.endR[i]);
    }
    // 行：从右往左，reach2 是「右边所有朝左发射的激光里，能覆盖到的最左位置」
    let reach2 = k;
    for (let p = k - 1; p >= 0; p--) {
      const i = arr[p];
      if (reach2 <= p) markRecv(i, SIDE_RIGHT);
      if (emit[i] & SIDE_LEFT) reach2 = Math.min(reach2, rayGraph.endL[i]);
    }
  });

  // 列：列数组按 wy 升序，下标增大方向是「上」，两趟扫描的逻辑与行完全一致
  emitColKeys.forEach(function (gx) {
    const arr = rayGraph.cols.get(gx);
    if (arr === undefined) return;
    const k = arr.length;
    let reach = -1;
    for (let p = 0; p < k; p++) {
      const i = arr[p];
      if (reach >= p) markRecv(i, SIDE_DOWN);   // 来自更小下标 = wy 更小 = 视觉下方
      if (emit[i] & SIDE_UP) reach = Math.max(reach, rayGraph.endU[i]);
    }
    let reach2 = k;
    for (let p = k - 1; p >= 0; p--) {
      const i = arr[p];
      if (reach2 <= p) markRecv(i, SIDE_UP);    // 来自更大下标 = wy 更大 = 视觉上方
      if (emit[i] & SIDE_DOWN) reach2 = Math.min(reach2, rayGraph.endD[i]);
    }
  });
}

// 给某个元件记下「这一侧有光射到」：掩码从零变非零时把它收进本微帧的接收表，供排输出那一步使用
function markRecv(i, side) {
  if (recvMask[i] === 0) recvEls.push(elements[i]);
  recvMask[i] |= side;
}

// 合并同一行（或同一列）上的区间：按起点排序后一遍扫过，与上一段相接或重叠就并进去
// 相接也算并，因为激光场是个点集，首尾相接的两段对模型来说就是连续的一段
// 区间用的是阻挡图里的位置坐标，无人阻挡的两端记 -1 和数组长度，都是有限整数，排序不会碰到 Infinity
function mergeSpans(spans) {
  spans.sort(function (s, t) { return (s[0] - t[0]) || (s[1] - t[1]); });
  const merged = [];
  for (let j = 0; j < spans.length; j++) {
    const s = spans[j];
    const last = merged[merged.length - 1];
    if (last !== undefined && s[0] <= last[1]) {
      if (s[1] > last[1]) last[1] = s[1];
    } else {
      merged.push([s[0], s[1]]);
    }
  }
  return merged;
}

// 位置坐标换成世界坐标：位置 -1 表示左边没人挡、位置等于数组长度表示右边没人挡，都换成 ±Infinity
// 有限位置直接取该位置元件对应的坐标分量，key 传 "wx" 或 "wy"
function spanToWorld(arr, key, p) {
  if (p === -1) return -Infinity;
  if (p === arr.length) return Infinity;
  return elements[arr[p]][key];
}

// 单微帧的激光场：先按阻挡图给每条射线定出两端，再按行、按列各自取并集
// 取并集是模型要求：同一条线上重叠或相接的激光，作为点集本来就是一段，不能当成多条
// 返回 [{horizontal, key, a, b}]：horizontal 为 true 是行上的线段，key 是该行 wy，a/b 是两端的 wx；反之是列
// 同样只扫有发射者的行列：没有发射者的行列上不会有激光
function computeLaserSegments() {
  const out = [];

  // 行：固定坐标是格号 gy，变化坐标是 wx；输出时把格号换回格心世界坐标，绘制端不必知道这套键
  emitRowKeys.forEach(function (gy) {
    const arr = rayGraph.rows.get(gy);
    if (arr === undefined) return;
    const k = arr.length;
    const spans = [];
    for (let p = 0; p < k; p++) {
      const i = arr[p];
      if (emit[i] & SIDE_RIGHT) spans.push([p, rayGraph.endR[i]]);  // 向右：起点是自己，终点是右边最近的阻挡者
      if (emit[i] & SIDE_LEFT) spans.push([rayGraph.endL[i], p]);   // 向左：起点是左边最近的阻挡者，终点是自己
    }
    const merged = mergeSpans(spans);
    for (let j = 0; j < merged.length; j++) {
      out.push({
        horizontal: true, key: gy + 0.5,
        a: spanToWorld(arr, "wx", merged[j][0]),
        b: spanToWorld(arr, "wx", merged[j][1])
      });
    }
  });

  // 列：固定坐标是格号 gx，变化坐标是 wy
  emitColKeys.forEach(function (gx) {
    const arr = rayGraph.cols.get(gx);
    if (arr === undefined) return;
    const k = arr.length;
    const spans = [];
    for (let p = 0; p < k; p++) {
      const i = arr[p];
      if (emit[i] & SIDE_UP) spans.push([p, rayGraph.endU[i]]);    // 向上：起点是自己，终点是上方最近的阻挡者
      if (emit[i] & SIDE_DOWN) spans.push([rayGraph.endD[i], p]);  // 向下：起点是下方最近的阻挡者，终点是自己
    }
    const merged = mergeSpans(spans);
    for (let j = 0; j < merged.length; j++) {
      out.push({
        horizontal: false, key: gx + 0.5,
        a: spanToWorld(arr, "wy", merged[j][0]),
        b: spanToWorld(arr, "wy", merged[j][1])
      });
    }
  });

  return out;
}
