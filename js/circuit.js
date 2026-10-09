// circuit.js：电路结算：阻挡图重建、微帧推进、发射、接收掩码、激光场。
"use strict";

/* ========== 阻挡图 ========== */

// 取元件在全局某轴上的阻挡属性：元件朝左/朝右时自身转了 90°，局部水平与垂直互换
// 参数 horizontal 为 true 表示问「挡不挡全局水平激光」，false 表示问全局垂直
function blocksGlobal(el, horizontal) {
  const t = ELEMENT_TYPES[el.typeId];
  const same = horizontal ? t.blocksH : t.blocksV;
  const swapped = horizontal ? t.blocksV : t.blocksH;
  return el.dir % 2 === 0 ? same : swapped;
}

// 重建阻挡图：按 wy 分出行、按 wx 分出列，各自排序后扫一遍，给每个元件记下四方向第一个阻挡者
// 结算时只需读表，不必每微帧拿坐标比大小，所以只在元件增删或朝向改变后调用一次
function rebuildRayGraph() {
  const rows = new Map();
  const cols = new Map();
  // 正在删除的、以及悬空的元件都不参与模拟：前者算「已被删掉」，后者算「还没放进世界」
  // 悬空即被选中；选中等于离地，要等落位（取消选中）那一刻才回到电路里
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.deleting || el.selected) continue;
    if (!rows.has(el.wy)) rows.set(el.wy, []);
    rows.get(el.wy).push(i);
    if (!cols.has(el.wx)) cols.set(el.wx, []);
    cols.get(el.wx).push(i);
  }
  // 排序之后「第一个阻挡者」就退化成数组上的一次邻项扫描，不用再比坐标
  rows.forEach(function (arr) {
    arr.sort(function (a, b) { return elements[a].wx - elements[b].wx; });
  });
  cols.forEach(function (arr) {
    arr.sort(function (a, b) { return elements[a].wy - elements[b].wy; });
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
}

/* ========== 结算 ========== */

// 单微帧结算：重建阻挡图（若脏）→ 收集发射 → 算接收掩码与激光场
// 元件规则已接入 elementEmit，后续新增元件类型只需在 elementEmit 里补一条分支
function stepMicroframe() {
  // 元件增删或朝向定下来之后才重建阻挡图；重建会让上一微帧的发射掩码作废，必须重算
  if (rayGraph.dirty) {
    rebuildRayGraph();
    lastEmit = null;
  }
  const emit = buildEmitMask();
  // 发射掩码与上一微帧完全一致时，激光场与接收掩码必然不变，跳过重算
  // 既省掉空转时的重复计算，也让下面的临时打印只在真有变化时输出
  if (!emitEquals(emit, lastEmit)) {
    recvMask = computeRecvMask(emit);
    laserSegments = computeLaserSegments(emit);
    scheduleOutputs(recvMask);  // 按本微帧的接收排下一微帧的输出，微时序的 1 帧延迟就落在这一步
    updateLampInputs(recvMask); // 顺手把接收结果落到灯身上，决定它这一微帧亮不亮
    lastEmit = emit.slice();    // 存一份副本而不是直接引用；否则 runToQuiescence 里比较前后两个状态时永远相等
    sceneDirty = true;  // 激光场变了，强制重绘一次，否则静止判定会把这次变化吞掉
  }
  microframe++;  // 时钟自增：本微帧的结算已完成，进入下一微帧
}

// 按当前微帧时长推进时钟：把本帧真实时长换算成微帧数逐个结算
// 用累加余数而不是直接取整，避免帧率与微帧时长不成整数倍时把零头丢掉、时钟越走越慢
// 单帧步数设上限，超出的积压时间直接丢弃，否则一帧要补算的量会越滚越大
function stepSimulation(dt) {
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
}

// 不设延迟时把整条链在一帧内跑完：反复结算，直到某一微帧的发射掩码与上一微帧完全相同
// 掩码没变说明没有任何元件再产生新输出，链已停住；上限只用来防止逻辑成环时死循环
// 元件之间那 1 微帧的延迟仍然保留，只是不再等真实时间，逻辑语义与慢速时完全一致
function runToQuiescence() {
  microAcc = 0;  // 零延迟下不攒余数，否则切回慢速时会突然补算一帧
  for (let i = 0; i < CONFIG.maxQuiescentSteps; i++) {
    const before = lastEmit;
    stepMicroframe();
    // 用值比较而不是引用比较：lastEmit 是 slice 出来的副本，引用每轮都变，不能用 === 判断
    // before 为 null 时说明还没初始化过，不能算"停了"
    if (before !== null && emitEquals(lastEmit, before)) return;
  }
}

// 收集本微帧所有元件要发射的方向，返回以 elements 下标为索引的位掩码
// 正在删除的与悬空的元件都已从模拟里摘掉，既不发射也不接收，所以直接跳过
function buildEmitMask() {
  const emit = new Array(elements.length).fill(0);
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].deleting || elements[i].selected) continue;
    emit[i] = elementEmit(elements[i]);
  }
  return emit;
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
function updateLampInputs(recv) {
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].typeId !== "lamp") continue;
    elements[i].litIn = recv[i] !== 0;
  }
}

// 按本微帧的接收结果安排各元件下一微帧的输出，实现文档 §8.2 的「t 微帧接收、t+1 微帧输出」
// 出口规则：元件只朝箭头方向输出，所以来自箭头侧的输入一律无效，只有其他侧来光才算有效输入
// 光源不参与：它的输出完全由开关决定，elementEmit 里已经直接算好
// 灯也不参与：它只作指示，收到光只用来点亮自己，不会往下游发
function scheduleOutputs(recv) {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.deleting || el.selected || el.typeId === "light" || el.typeId === "lamp") continue;
    const valid = recv[i] & ~(1 << el.dir);  // 抹掉出口侧那一位，剩下的位里只要有一位就是有效输入
    // 反相器是非门：有有效输入就不发射、没有输入才发射，正好与偏转器、透射器相反
    if (el.typeId === "inverter") {
      el.out = valid ? 0 : (1 << el.dir);
    } else {
      el.out = valid ? (1 << el.dir) : 0;
    }
  }
}

// 判断两个发射掩码是否完全一致：长度不同或任一位不同都算不一致
// 掩码一致且阻挡图未重建时，激光场与接收掩码必然一模一样，本微帧可以直接跳过重算
function emitEquals(a, b) {
  if (b === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// 算出每个元件的接收掩码：某一位为 1，表示「有一个位于我这一侧的发射者，它的激光覆盖到了我」
// 注意不是「我这一侧有没有激光」：从对面射来又穿过去的光两侧都有，但它只从对面来，出口规则要靠这个区别
// 每行每列各扫两遍：前缀最大管「左边来的光最远射到哪」，后缀最小管「右边来的光最远射到哪」
// 这样整行一趟 O(行长) 就能得到该行所有人的掩码，不必让每条激光各自去标记自己覆盖了谁
function computeRecvMask(emit) {
  const mask = new Array(elements.length).fill(0);

  // 行：从左往右，reach 是「左边所有朝右发射的激光里，能覆盖到的最右位置」
  rayGraph.rows.forEach(function (arr) {
    const k = arr.length;
    let reach = -1;
    for (let p = 0; p < k; p++) {
      const i = arr[p];
      // 先判后记，严格不等式把元件自己排除在外：自己发的光不该算成自己的输入
      if (reach >= p) mask[i] |= SIDE_LEFT;
      if (emit[i] & SIDE_RIGHT) reach = Math.max(reach, rayGraph.endR[i]);
    }
    // 行：从右往左，reach2 是「右边所有朝左发射的激光里，能覆盖到的最左位置」
    let reach2 = k;
    for (let p = k - 1; p >= 0; p--) {
      const i = arr[p];
      if (reach2 <= p) mask[i] |= SIDE_RIGHT;
      if (emit[i] & SIDE_LEFT) reach2 = Math.min(reach2, rayGraph.endL[i]);
    }
  });

  // 列：列数组按 wy 升序，下标增大方向是「上」，两趟扫描的逻辑与行完全一致
  rayGraph.cols.forEach(function (arr) {
    const k = arr.length;
    let reach = -1;
    for (let p = 0; p < k; p++) {
      const i = arr[p];
      if (reach >= p) mask[i] |= SIDE_DOWN;   // 来自更小下标 = wy 更小 = 视觉下方
      if (emit[i] & SIDE_UP) reach = Math.max(reach, rayGraph.endU[i]);
    }
    let reach2 = k;
    for (let p = k - 1; p >= 0; p--) {
      const i = arr[p];
      if (reach2 <= p) mask[i] |= SIDE_UP;    // 来自更大下标 = wy 更大 = 视觉上方
      if (emit[i] & SIDE_DOWN) reach2 = Math.min(reach2, rayGraph.endD[i]);
    }
  });

  return mask;
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
function computeLaserSegments(emit) {
  const out = [];

  // 行：固定坐标是 wy，变化坐标是 wx
  rayGraph.rows.forEach(function (arr, wy) {
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
        horizontal: true, key: wy,
        a: spanToWorld(arr, "wx", merged[j][0]),
        b: spanToWorld(arr, "wx", merged[j][1])
      });
    }
  });

  // 列：固定坐标是 wx，变化坐标是 wy
  rayGraph.cols.forEach(function (arr, wx) {
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
        horizontal: false, key: wx,
        a: spanToWorld(arr, "wy", merged[j][0]),
        b: spanToWorld(arr, "wy", merged[j][1])
      });
    }
  });

  return out;
}

