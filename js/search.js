// search.js：查找功能：点右侧工具栏第五格，在网格视口右上角浮出一个小设置框
// 按选区里的元件组合去整份电路里找同样的组合，找到的每一组都用橘黄框出来；
// 页码箭头只负责换到第几个结果，换的同时把相机对到那一组上并闪两下
"use strict";

/* ========== 初始化 ========== */

// 注入外观并绑定交互：外观一次性写好，之后只改显隐与页码文字
function initSearchDom() {
  const dom = S.searchPanelDom;
  if (dom === null) return;
  dom.style.width = CONFIG.searchPanelWidth + "px";
  dom.style.padding = CONFIG.searchPanelPad + "px";
  dom.style.borderRadius = CONFIG.searchPanelRadius + "px";
  dom.style.background = COLOR.tipFill;
  dom.style.borderColor = COLOR.tipBorder;
  dom.style.color = COLOR.tipName;
  dom.style.fontSize = CONFIG.searchPanelFontSize + "px";
  // 放大镜按钮里那枚图标与右栏第五格同源，两处看起来是同一个东西
  S.searchGoDom.appendChild(buildSearchIcon(COLOR.tipName));
  // 按下不让按钮抢走画布焦点：画布要靠焦点才能响应键盘
  dom.addEventListener("mousedown", function (e) { e.preventDefault(); });
  // 点选项切换准确 / 模糊，只改一个布尔量，文字跟着同步
  S.searchModeDom.addEventListener("click", function () {
    S.searchFuzzy = !S.searchFuzzy;
    syncSearchModeDom();
  });
  S.searchGoDom.addEventListener("click", function () { runSearch(); });
  S.searchPrevDom.addEventListener("click", function () { switchSearchResult(-1); });
  S.searchNextDom.addEventListener("click", function () { switchSearchResult(1); });
  // 搜索按钮变灰时，指针停上去才说明原因；进入与离开各管一头
  S.searchGoDom.addEventListener("mouseenter", function () {
    if (!S.searchEnabled) showSearchTip();
  });
  S.searchGoDom.addEventListener("mouseleave", hideSearchTip);
  syncSearchModeDom();
  updateSearchPager();
}

/* ========== 开与关 ========== */

// 点右栏第五格：开着就关，关着就开
function toggleSearchPanel() {
  if (S.searchPanelOpen) closeSearchPanel();
  else openSearchPanel();
}

// 打开设置框：贴在视口右上角，不跟随地图；打开时不清空上次的结果，留着还能继续翻
function openSearchPanel() {
  S.searchPanelOpen = true;
  S.searchPanelDom.style.display = "block";
  S.searchPanelDom.style.opacity = "1";  // .popup 默认全透明，这里直接给足
  const box = S.rightBarToolsDom.children[4];
  if (box) box.classList.add("on");      // 右栏那一格同时点亮，看得出框是它开出来的
  syncSearchPanel();
  S.sceneDirty = true;
}

// 关闭设置框：高亮、页码、闪光一并清掉，画面上不留上次搜过的框
function closeSearchPanel() {
  if (!S.searchPanelOpen) return;
  S.searchPanelOpen = false;
  S.searchPanelDom.style.display = "none";
  hideSearchTip();
  const box = S.rightBarToolsDom.children[4];
  if (box) box.classList.remove("on");
  S.searchResults = [];
  S.searchCellMap = null;
  S.searchIndex = 0;
  S.searchFlashOn = false;
  S.searchFlashT = 0;
  updateSearchPager();
  S.sceneDirty = true;
}

/* ========== 每帧同步 ========== */

// 把框摆到视口右上角：位置只跟视口走，缩放平移地图都不会带走它
// 顺带按选区有无切换放大镜的灰态，只在状态变化时改一次类名
function syncSearchPanel() {
  if (!S.searchPanelOpen) return;
  const vp = getViewport();
  S.searchPanelDom.style.left = (vp.x + vp.w - CONFIG.searchPanelWidth - CONFIG.searchPanelInset) + "px";
  S.searchPanelDom.style.top = (vp.y + CONFIG.searchPanelInset) + "px";
  const enabled = stackSelectedElements().length > 0;
  if (enabled !== S.searchEnabled) {
    S.searchEnabled = enabled;
    S.searchGoDom.classList.toggle("off", !enabled);
    if (enabled) hideSearchTip();   // 能点了，那句「未选中任何元件」就该退场
  }
}

// 选项文字跟着状态走：准确比对类型与朝向，模糊只比对类型
function syncSearchModeDom() {
  if (S.searchModeDom === null) return;
  S.searchModeDom.textContent = S.searchFuzzy ? "模糊" : "准确";
}

// 页码写成「当前/总数」：没结果时写 0/0；箭头在不足两个结果时一并变灰
function updateSearchPager() {
  if (S.searchPageDom === null) return;
  const n = S.searchResults.length;
  S.searchPageDom.textContent = n === 0 ? "0/0" : ((S.searchIndex + 1) + "/" + n);
  S.searchPrevDom.classList.toggle("off", n < 2);
  S.searchNextDom.classList.toggle("off", n < 2);
}

// 搜索按钮不可用时的解释：贴在按钮左下方，单行，不抢指针
function showSearchTip() {
  const dom = S.searchTipDom;
  if (dom === null) return;
  dom.textContent = "未选中任何元件";
  dom.style.display = "block";
  const r = S.searchGoDom.getBoundingClientRect();
  dom.style.left = r.left + "px";
  dom.style.top = (r.bottom + 6) + "px";
}

// 收起那句解释
function hideSearchTip() {
  if (S.searchTipDom !== null) S.searchTipDom.style.display = "none";
}

/* ========== 从选区取出组合 ========== */

// 把选区里的元件归一成一份「相对格号 + 类型 + 朝向」的样式表
// 用相对格号就能把整组在图上任意平移比对；同一格只留一件，避免悬空期间叠着两件时比重复
function buildSearchPattern(list) {
  const map = new Map();   // Map<string, Object>：格号 → {u, v, typeId, dir}
  let uMin = Infinity, vMin = Infinity, uMax = -Infinity, vMax = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    const u = Math.round(el.wx - 0.5);
    const v = Math.round(el.wy - 0.5);
    const dir = (((Math.round(el.angleTarget / 90) % 4) + 4) % 4);
    map.set(u + "," + v, { u: u, v: v, typeId: el.typeId, dir: dir });
    if (u < uMin) uMin = u;
    if (v < vMin) vMin = v;
    if (u > uMax) uMax = u;
    if (v > vMax) vMax = v;
  }
  const cells = [];
  map.forEach(function (c) {
    cells.push({ du: c.u - uMin, dv: c.v - vMin, typeId: c.typeId, dir: c.dir });
  });
  if (cells.length === 0) return null;
  return { cells: cells, w: uMax - uMin + 1, h: vMax - vMin + 1 };
}

/* ========== 在整份电路里找 ========== */

// 收集所有真正落在图上的元件：悬空（选中）与正在消失的都不算，查找只认已经摆好的那部分
// 同一格有多件时留数组里最靠后的那件，与绘制顺序一致
function collectSearchCells() {
  const map = new Map();   // Map<string, Object>：格号 → 元件
  for (let i = 0; i < S.elements.length; i++) {
    const el = S.elements[i];
    if (el.deleting || el.selected) continue;
    const u = Math.round(el.wx - 0.5);
    const v = Math.round(el.wy - 0.5);
    map.set(u + "," + v, { u: u, v: v, el: el });
  }
  return map;
}

// 按样式表全图扫一遍：拿样式表里真实存在的一件元件当锚，锚对上之后再逐格核对其余元件
// 准确模式要求类型与朝向都一致，模糊模式只看类型
function findSearchResults(pattern) {
  const cellsMap = collectSearchCells();
  const results = [];
  const limit = CONFIG.searchMaxResults;
  // 锚点取样式表里实际存在的第一件元件，而不是包围盒左上角那一格：
  // 选区可以有空缺，左上角很可能本来就是空的，拿空格当锚点会永远对不上
  const first = pattern.cells[0];
  cellsMap.forEach(function (cell) {
    if (results.length >= limit) return;
    // 由这一格反推整组的包围盒左上角：后面记坐标与聚焦都用这个角
    const au = cell.u - first.du;
    const av = cell.v - first.dv;
    let ok = true;
    // 逐格核对：任何一格对不上，这个锚点就不成立
    for (let i = 0; i < pattern.cells.length; i++) {
      const c = pattern.cells[i];
      const target = cellsMap.get((au + c.du) + "," + (av + c.dv));
      if (target === undefined) { ok = false; break; }
      if (target.el.typeId !== c.typeId) { ok = false; break; }
      if (!S.searchFuzzy) {
        const dir = (((Math.round(target.el.angleTarget / 90) % 4) + 4) % 4);
        if (dir !== c.dir) { ok = false; break; }
      }
    }
    if (!ok) return;
    // 记一份绝对格号：结果只存坐标，不存元件引用，之后元件被删也不会留下悬空引用
    const cells = [];
    for (let i = 0; i < pattern.cells.length; i++) {
      const c = pattern.cells[i];
      cells.push({ u: au + c.du, v: av + c.dv });
    }
    results.push({ u: au, v: av, w: pattern.w, h: pattern.h, cells: cells });
  });
  // 按阅读顺序排：先上后下、同一行先左后右，翻页时才不会在图上乱跳
  results.sort(function (a, b) { return (a.v - b.v) || (a.u - b.u); });
  return results;
}

// 把结果摊成「格号 → 第几组」的表：元件染色时按自己所在格反查它属于哪一组
// 结果为空时也给一张空表，染色函数就可以只看表不看结果数组
function buildSearchCellMap(results) {
  const map = new Map();
  for (let i = 0; i < results.length; i++) {
    const cells = results[i].cells;
    for (let j = 0; j < cells.length; j++) {
      map.set(cells[j].u + "," + cells[j].v, i);
    }
  }
  return map;
}

/* ========== 搜索、换页 ========== */

// 点框里的放大镜：先按选区取样式表，再全图找；找到不移动视角，只把页码摆出来
function runSearch() {
  const list = stackSelectedElements();
  if (list.length === 0) return;               // 按钮已经是灰的，这里兜一下，不做任何事
  if (S.orbitActive) finishOrbit();            // 整批旋转还在飞就先落位，按定下来的位置取组合
  const pattern = buildSearchPattern(list);
  if (pattern === null) return;
  S.searchResults = findSearchResults(pattern);
  S.searchCellMap = buildSearchCellMap(S.searchResults);
  S.searchIndex = 0;
  S.searchFlashOn = false;
  S.searchFlashT = 0;
  updateSearchPager();
  S.sceneDirty = true;
  if (S.searchResults.length === 0) showToast("没有找到相同的组合");
}

// 点上 / 下一个：环形翻页，换到哪一组就把相机对到哪一组并闪两下
function switchSearchResult(delta) {
  const n = S.searchResults.length;
  if (n === 0) return;
  S.searchIndex = (S.searchIndex + delta + n) % n;
  updateSearchPager();
  focusSearchResult(S.searchResults[S.searchIndex]);
  startSearchFlash();
}

// 把相机对到某一组结果上：让它居中，最长边占视口短边的一小截
// 缩放夹在最小与最大之间；只改目标值，实际的平移缩放仍由相机那套缓动推过去
function focusSearchResult(r) {
  const vp = getViewport();
  const sx = vp.x + vp.w / 2;
  const sy = vp.y + vp.h / 2;
  const span = Math.min(vp.w, vp.h) * CONFIG.searchFocusCover;
  let s = span / Math.max(1, Math.max(r.w, r.h));
  if (s < CONFIG.minScale) s = CONFIG.minScale;
  if (s > CONFIG.maxScale) s = CONFIG.maxScale;
  const cx = r.u + r.w / 2;
  const cy = r.v + r.h / 2;
  state.tLogScale = Math.log(s);
  state.tAnchorSX = sx - (cx - state.anchorWX) * s;
  state.tAnchorSY = sy + (cy - state.anchorWY) * s;
  S.sceneDirty = true;
}

/* ========== 闪光 ========== */

// 开始闪两下：计时从零起，元件染色函数按进度把当前这一组染得更深
function startSearchFlash() {
  S.searchFlashOn = true;
  S.searchFlashT = 0;
  S.sceneDirty = true;
}

// 推进闪光计时：到点就收掉，静止判定因此也不会一直卡在「还在动」
function updateSearchFlash(dt) {
  if (!S.searchFlashOn) return;
  S.searchFlashT += dt;
  if (S.searchFlashT >= CONFIG.searchFlashDuration) {
    S.searchFlashOn = false;
    S.searchFlashT = 0;
  }
  S.sceneDirty = true;
}

// 闪两下的亮度曲线：一个周期里出现两个鼓包，同时从头到尾缓慢减弱，看起来是「亮、暗、再亮一点、收住」
function searchFlashPulse() {
  const p = Math.min(1, S.searchFlashT / CONFIG.searchFlashDuration);
  return Math.abs(Math.sin(p * Math.PI * 2)) * (1 - p * 0.65);
}

/* ========== 元件染色 ========== */

// 算出某个元件该染多重的橘黄：不在任何结果里就是 0，在结果里按「其余 / 当前定位」两档给
// 定位后的闪光就叠在当前这一组上，按闪光曲线起伏，峰值也不会盖成一块纯橘
// 元件层每帧拿它当配色缓存键的一部分，所以闪光期间颜色会自己一帧帧跟上
function searchTintFor(el) {
  if (S.searchCellMap === null) return 0;
  // 悬空（选中）与正在消失的元件不染色：手里那批本来就不算图上的结果
  if (el.selected || el.deleting) return 0;
  const gi = S.searchCellMap.get(Math.round(el.wx - 0.5) + "," + Math.round(el.wy - 0.5));
  if (gi === undefined) return 0;
  let t = CONFIG.searchTintBase;
  if (gi === S.searchIndex) {
    t = CONFIG.searchTintActive;
    if (S.searchFlashOn) t += searchFlashPulse() * CONFIG.searchFlashExtra;
  }
  if (t > 1) t = 1;
  // 量化到二十分之一档：闪光每帧都在变，不量化的话每帧都会生成一张新的元件贴图，几秒就能堆出一大片缓存
  return Math.round(t * 20) / 20;
}

// 由染色程度算出实际填充色：只在橘黄这一族里走，绝不与蓝色底色混，混在 RGB 里才不会变成灰
// 两段过渡：先由淡橙走到更饱和的橙（区分定位组），闪光时再朝浅橙提亮
function searchTintFill(level) {
  const span = Math.max(0.01, CONFIG.searchTintActive - CONFIG.searchTintBase);
  let u = (level - CONFIG.searchTintBase) / span;
  if (u < 0) u = 0;
  if (u > 1) u = 1;
  // 闪光那一段的跨度就是「额外加的程度」本身：从定位档往上到峰值
  const flashSpan = Math.max(0.01, CONFIG.searchFlashExtra);
  let e = (level - CONFIG.searchTintActive) / flashSpan;
  if (e < 0) e = 0;
  if (e > 1) e = 1;
  return mixRgb(mixRgb(RGB.searchFill, RGB.searchActiveFill, u), RGB.searchFlashFill, e);
}

// 由染色程度算出实际描边色：与填充同一套两段过渡，只是端点更深，轮廓才立得住
function searchTintStroke(level) {
  const span = Math.max(0.01, CONFIG.searchTintActive - CONFIG.searchTintBase);
  let u = (level - CONFIG.searchTintBase) / span;
  if (u < 0) u = 0;
  if (u > 1) u = 1;
  // 描边与填充用同一个跨度，两者在闪光时是同步起伏的
  const flashSpan = Math.max(0.01, CONFIG.searchFlashExtra);
  let e = (level - CONFIG.searchTintActive) / flashSpan;
  if (e < 0) e = 0;
  if (e > 1) e = 1;
  return mixRgb(mixRgb(RGB.searchStroke, RGB.searchActiveStroke, u), RGB.searchFlashStroke, e);
}
