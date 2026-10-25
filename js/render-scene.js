// render-scene.js：场景绘制：视口尺寸、网格、激光、灯光晕、边框、上方面板框、底栏与提示文字。
"use strict";

/* ========== 尺寸与视口 ========== */

// 按当前像素比调整画布位图尺寸，并把绘制坐标系统一到 CSS 像素
// 像素比取「设备像素比」与用户在设置里定的上限两者的较小值：上限调低就少开像素，光栅化耗时按平方下降
function resizeCanvas() {
  const dpr = effectiveDpr();
  state.cssW = window.innerWidth;
  state.cssH = window.innerHeight;
  S.canvas.width = Math.round(state.cssW * dpr);
  S.canvas.height = Math.round(state.cssH * dpr);
  S.canvas.style.width = state.cssW + "px";
  S.canvas.style.height = state.cssH + "px";
  // setTransform 只在这里设置一次；后续所有绘制都用 CSS 像素坐标，避免高清屏模糊
  S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// 计算视口矩形：画布内缩固定边距，网格只在这个矩形内显示
// 左边额外让出 sidebarWidth 给工作区竖栏；上边额外让出 panelHeight 给元件选择面板
// 画布本身仍是全窗口且左上角在原点，所以指针坐标不用做任何偏移换算，视口之外（含竖栏那一条与上方空白）由 isInViewport 统一挡掉
function getViewport() {
  const m = CONFIG.viewportMargin;
  const left = m + CONFIG.sidebarWidth;   // 竖栏占掉的那一条：网格、上方面板、底栏的左边都从它右边起算
  const top = m + CONFIG.panelHeight;
  // 右侧同样要给工具栏腾出一条：右边距仍是 m（其中一半是栏与视口之间的间隙），再减去栏宽，左右两边因此对称
  const w = Math.max(0, state.cssW - left - m - CONFIG.rightbarWidth);
  // 底部要再给那条栏腾地方：栏高加上下各一个 panelGap，视口高度相应缩短，栏才不会压在网格上
  const bottom = CONFIG.panelGap * 2 + CONFIG.bottomBarHeight;
  const h = Math.max(0, state.cssH - top - bottom);
  return { x: left, y: top, w: w, h: h };
}

// 屏幕点是否落在视口内：视口外的网格不显示，虚影与放置遵循同一条边界
function isInViewport(sx, sy) {
  const vp = getViewport();
  return sx >= vp.x && sx <= vp.x + vp.w && sy >= vp.y && sy <= vp.y + vp.h;
}

/* ========== 网格绘制 ========== */

// 网格图案：把「一格」画成一张小位图，右、下两条边各描一根线，平铺出去就是一整片网格
// 之所以改成平铺：逐条描线时线数随视口格数增长，缩小后一屏能有五百多条；重复图形本来就该交给平铺
// 平铺的代价只是一张几十像素的小位图（只在缩放变化时重画）加一次整屏填充，与格数彻底脱钩
// 相机移动时不必再逐帧重建网格线，静止时也不再需要那张整屏离屏位图，两种状态都只剩一次填充
function getGridPattern(cellCss) {
  const dpr = effectiveDpr();
  // 瓷砖按物理像素开位图，边长取整；缩放连续变化时这个整数会跟着跳，所以它同时充当缓存指纹
  const t = Math.max(1, Math.round(cellCss * dpr));
  // 线宽 = 格宽 × gridLineRatio + gridLineBase，上限 1 CSS px（格宽超过约 26 px 时线不再变粗，与原观感一致）
  // 一根固定 1 px 的线，格子越小它占的比例越大：格宽 40 px 时占 2.5%，格宽 4 px 时就占到 25%，
  // 于是越缩网格越密、整片越压越重，元件与光束反而被盖住；让线跟着格宽一起缩，这个比例才压得住
  // 但不能纯按比例缩：比例项到格宽 1 px 时只剩 0.03 px，0.25 px 以下就看不见了，所以加一个固定加数兜底，
  // 线永远细不到 0.22 CSS px 以下，缩到底也仍是看得见的一根线
  // 这里没有「小到某个尺寸就不画」的分支：线细到不足一个像素时，canvas 会把描边按覆盖面积摊成淡色，
  // 那是它真的有这么细，不是被抹掉或单独调淡了
  // 注意 lineWidth 为 0 在 canvas 里是「发丝线」（整整一个物理像素、满不透明），比 1 还醒目，所以下面必须挡住
  const lw = Math.min(dpr, (cellCss * CONFIG.gridLineRatio + CONFIG.gridLineBase) * dpr);
  const key = t + "|" + dpr + "|" + lw.toFixed(4);   // 线宽也是这幅图的一部分，一并充当缓存指纹
  if (S.gridTileKey === key && S.gridPattern !== null) return S.gridPattern;
  if (S.gridTile === null) {
    S.gridTile = document.createElement("canvas");
    S.gridTileCtx = S.gridTile.getContext("2d");
  }
  // 改位图尺寸会顺带清空并复位上下文，所以底色、线宽、路径都在重建之后再设一遍
  S.gridTile.width = t;
  S.gridTile.height = t;
  S.gridTileCtx.setTransform(1, 0, 0, 1, 0, 0);  // 瓷砖一律按物理像素作画，自身不带缩放
  S.gridTileCtx.fillStyle = COLOR.background;
  S.gridTileCtx.fillRect(0, 0, t, t);
  if (lw > 0) {
    S.gridTileCtx.strokeStyle = COLOR.line;
    S.gridTileCtx.lineWidth = lw;
    S.gridTileCtx.beginPath();
    // 线画在瓷砖的右边界与下边界上：平铺之后每条格子边界上恰好有一根线
    // 线心往瓷砖里挪半个线宽，整数像素上正好落在整段像素里，既不糊也不会被边界切掉一半
    const half = lw / 2;
    S.gridTileCtx.moveTo(t - half, 0);
    S.gridTileCtx.lineTo(t - half, t);
    S.gridTileCtx.moveTo(0, t - half);
    S.gridTileCtx.lineTo(t, t - half);
    S.gridTileCtx.stroke();
  }
  S.gridPattern = S.ctx.createPattern(S.gridTile, "repeat");
  S.gridTileKey = key;
  return S.gridPattern;
}

// 画网格：把一格大小的图案铺满视口，一次填充到位
// 关掉网格渲染时只铺底色，省掉图案那一趟采样，视口范围照样看得出来
function drawGrid(vp) {
  S.ctx.save();
  // 裁剪到视口：这是「视口外不显示」的关键；裁剪在改坐标系之前设，边界才恰好落在视口上
  S.ctx.beginPath();
  S.ctx.rect(vp.x, vp.y, vp.w, vp.h);
  S.ctx.clip();
  if (!S.gridRenderOn) {
    S.ctx.fillStyle = COLOR.background;
    S.ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
    S.ctx.restore();
    return;
  }
  // 一格在屏幕上的边长：缩放定下了它就定下了图案周期，格子与元件因此永远对得上
  const cellCss = CONFIG.gridUnit * state.scale;
  const pattern = getGridPattern(cellCss);
  // 平铺原点锚在视野左上角之外最近的一条世界网格线上，图案随相机连续移动，线不会逐帧各跳各的
  // 横纵都取「不晚于视口边缘」的那条线，向左向上各多铺不到一格，视口必定被盖满
  const n0 = Math.floor(screenToWorldX(vp.x) / CONFIG.gridUnit);
  const m0 = Math.ceil(screenToWorldY(vp.y) / CONFIG.gridUnit);
  const ax = worldToScreenX(n0 * CONFIG.gridUnit);
  const ay = worldToScreenY(m0 * CONFIG.gridUnit);
  // 位图边长是取整过的，与一格的真实像素数差着不到一个像素；这里按真实周期把瓷砖缩回来
  // 少了这一步，误差会沿着一行一路累加，越往远处网格线与元件越对不上
  const k = cellCss / S.gridTile.width;
  S.ctx.translate(ax, ay);
  S.ctx.scale(k, k);
  S.ctx.fillStyle = pattern;
  // 填充矩形换算到图案自己的坐标系里，正好盖住视口；图案本身按一格为周期重复
  S.ctx.fillRect((vp.x - ax) / k, (vp.y - ay) / k, vp.w / k, vp.h / k);
  S.ctx.restore();
}

// 激光辉光用的离屏位图：尺寸跟着画布走，只在画布尺寸变化时重建
// 位图是降采样的（倍数见 CONFIG.laserGlowDownscale），所以同样一条宽描边，在这里要光栅化的像素数少得多
function getLaserGlowLayer() {
  const ds = CONFIG.laserGlowDownscale;
  if (S.laserGlowCache === null) {
    S.laserGlowCache = document.createElement("canvas");
    S.laserGlowCacheCtx = S.laserGlowCache.getContext("2d");
  }
  const w = Math.max(1, Math.round(state.cssW / ds));
  const h = Math.max(1, Math.round(state.cssH / ds));
  // 尺寸对不上就重建；改 width/height 会顺带清空并复位上下文，所以重建之后必须重新设变换，见调用处
  if (S.laserGlowCache.width !== w || S.laserGlowCache.height !== h) {
    S.laserGlowCache.width = w;
    S.laserGlowCache.height = h;
  }
  return S.laserGlowCache;
}

// 画激光场：先铺一层辉光，再描一根光芯
// 线段端点可能是 ±Infinity，夹到视口的世界范围即可，不必真去算无穷远
// 辉光与光芯共用同一条 Path2D，所以路径只拼一次，两处各描各的
function drawLaser(vp) {
  if (S.renderSkip.laser) return;   // 逐层开关：排查帧率时整层跳过，画面上只留网格与元件
  if (S.laserSegments.length === 0) return;

  // 视口对应的世界范围：注意屏幕 y 向下、世界 y 向上，所以上边界对应 maxY
  const minX = screenToWorldX(vp.x);
  const maxX = screenToWorldX(vp.x + vp.w);
  const minY = screenToWorldY(vp.y + vp.h);
  const maxY = screenToWorldY(vp.y);

  // 所有线段攒成一条路径，下面的辉光与光芯两层都复用它，不必各建一次
  const path = new Path2D();
  for (let j = 0; j < S.laserSegments.length; j++) {
    const s = S.laserSegments[j];
    if (s.horizontal) {
      // 行上的线段：固定坐标是 wy，变化坐标是 wx
      if (s.key < minY || s.key > maxY) continue;  // 整条线在视口上下之外，跳过
      const a = Math.max(s.a, minX);
      const b = Math.min(s.b, maxX);
      if (a > b) continue;                          // 裁完为空，说明这段在视口左右之外
      path.moveTo(worldToScreenX(a), worldToScreenY(s.key));
      path.lineTo(worldToScreenX(b), worldToScreenY(s.key));
    } else {
      // 列上的线段：固定坐标是 wx，变化坐标是 wy
      if (s.key < minX || s.key > maxX) continue;
      const a = Math.max(s.a, minY);
      const b = Math.min(s.b, maxY);
      if (a > b) continue;
      path.moveTo(worldToScreenX(s.key), worldToScreenY(a));
      path.lineTo(worldToScreenX(s.key), worldToScreenY(b));
    }
  }

  const w = CONFIG.laserWidth * state.scale;

  // 铺辉光：若干层同心描边由内到外依次变宽变淡，叠出连续衰减
  // 用多层而不是「一圈固定宽度的半透明」，是因为后者边缘是硬的，看起来像一条带子而不是光晕
  // 关掉高级渲染就整段跳过：只剩最内层的光芯，激光的走向照样看得清，省下每层一次整路径描边
  // 这八层是整帧最贵的绘制，所以把它们描在一张降采样位图上再整张贴回：每层要光栅化的像素少四分之三
  // 辉光本身就是一层连续衰减的柔光，放大后与逐层满分辨率描边在肉眼上分不出差别
  if (S.advancedRenderOn && !S.renderSkip.laserGlow) {   // 逐层开关：排查帧率时可单独关掉辉光、只留光芯
    const layer = getLaserGlowLayer();
    const gc = S.laserGlowCacheCtx;
    const ds = CONFIG.laserGlowDownscale;
    // 清空时先回到位图自己的像素坐标系，按整张位图的物理尺寸清，避免除不尽时在边上留一条没清掉的旧痕
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.clearRect(0, 0, layer.width, layer.height);
    // 之后仍用 CSS 像素坐标绘制，只是整体缩小 ds 倍：主画布那份绘制代码才能原样搬过来
    gc.setTransform(1 / ds, 0, 0, 1 / ds, 0, 0);
    gc.save();
    // 裁剪到视口：延伸到视口外的激光不该画到面板或画布空白处
    gc.beginPath();
    gc.rect(vp.x, vp.y, vp.w, vp.h);
    gc.clip();
    gc.lineCap = "round";  // 圆头：线段末端不出现生硬的方角
    gc.strokeStyle = COLOR.laserGlow;
    const N = CONFIG.laserGlowLayers;
    for (let k = 0; k < N; k++) {
      const t = k / N;                  // 0 贴着光芯，越接近 1 越靠外
      const fade = (1 - t) * (1 - t);   // 二次衰减：近处降得慢、远处迅速消失，观感更柔
      gc.lineWidth = w * (1 + (CONFIG.laserGlowSpread - 1) * t);
      gc.globalAlpha = CONFIG.laserGlowAlpha * fade;
      gc.stroke(path);                  // 每层复用同一条路径，不重建
    }
    gc.globalAlpha = 1;
    gc.restore();
    // 整张贴回主画布：放大交给浏览器的双线性采样，辉光这种低频图形不会显出锯齿
    S.ctx.drawImage(layer, 0, 0, state.cssW, state.cssH);
  }

  // 描光芯：实色不透明，压在最内层之上，保证中心是一根清晰的白线
  // 这一根留在主画布上满分辨率直接画，不跟着辉光降采样，否则细线会发糊
  S.ctx.save();
  S.ctx.beginPath();
  S.ctx.rect(vp.x, vp.y, vp.w, vp.h);
  S.ctx.clip();
  S.ctx.lineCap = "round";
  S.ctx.lineWidth = w;
  S.ctx.strokeStyle = COLOR.laserCore;
  S.ctx.stroke(path);
  S.ctx.restore();
}

// 灯的光晕纹理：把「做模糊」从每帧每盏灯各来一次，改成整帧只做一次
// 纹理是一张正方形位图，正中是灯的圆角方框，四周留出模糊摊开的余量；用的时候按灯心位置整张贴上去
// 之所以等价：模糊是平移不变的卷积，先把图形模糊好再挪到灯的位置，与先挪过去再模糊，结果一致
function getLampGlowSprite() {
  const blurPx = CONFIG.lampGlowBlur * state.scale;   // 模糊半径随缩放走，灯放大时光晕跟着一起放大
  const pad = blurPx * 3;                             // 高斯模糊的可见摊开范围约三倍半径，留这么多透明边
  const h = CONFIG.lampHalf * state.scale;            // 光晕底形与灯同大，模糊后自然向外晕出
  const r = CONFIG.lampRadius * state.scale;
  const size = h * 2 + pad * 2;                       // 纹理边长（CSS px）：灯本体加两侧留白
  const dpr = effectiveDpr();
  // 缩放或像素比一变，纹理就得按新参数重画；指纹一致就说明上一张还能用
  const key = size + "|" + blurPx + "|" + r + "|" + dpr;
  if (S.lampGlowCacheKey === key) return S.lampGlowCache;

  if (S.lampGlowCache === null) {
    S.lampGlowCache = document.createElement("canvas");
    S.lampGlowCacheCtx = S.lampGlowCache.getContext("2d");
  }
  const dev = Math.max(1, Math.round(size * dpr));    // 位图按物理像素开，清晰度与主画布一致
  S.lampGlowCache.width = dev;
  S.lampGlowCache.height = dev;
  // 改 width/height 会复位上下文状态，所以变换与滤镜都在重建之后再设一遍
  S.lampGlowCacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S.lampGlowCacheCtx.clearRect(0, 0, size, size);
  S.lampGlowCacheCtx.filter = "blur(" + blurPx + "px)";
  S.lampGlowCacheCtx.fillStyle = COLOR.lampGlow;
  S.lampGlowCacheCtx.beginPath();
  S.lampGlowCacheCtx.roundRect(pad, pad, h * 2, h * 2, r);
  S.lampGlowCacheCtx.fill();
  S.lampGlowCacheCtx.filter = "none";
  // 贴回时用的边长按实际位图像素数反推：位图边长的取整不会让贴图被拉伸一点点
  S.lampGlowCacheSize = dev / dpr;
  S.lampGlowCacheKey = key;
  return S.lampGlowCache;
}

// 灯光晕的离屏位图：尺寸跟着画布走，只在画布尺寸变化时重建
// 与激光辉光同一套做法：光晕本来就是一团低频模糊，降采样一半再放大贴回肉眼分不出，光栅化面积却少四分之三
function getLampGlowLayer() {
  const ds = CONFIG.lampGlowDownscale;
  if (S.lampGlowLayer === null) {
    S.lampGlowLayer = document.createElement("canvas");
    S.lampGlowLayerCtx = S.lampGlowLayer.getContext("2d");
  }
  const w = Math.max(1, Math.round(state.cssW / ds));
  const h = Math.max(1, Math.round(state.cssH / ds));
  // 尺寸对不上就重建；改 width/height 会顺带清空并复位上下文，所以重建之后必须重新设变换，见调用处
  if (S.lampGlowLayer.width !== w || S.lampGlowLayer.height !== h) {
    S.lampGlowLayer.width = w;
    S.lampGlowLayer.height = h;
  }
  return S.lampGlowLayer;
}

// 画灯的光晕：被照亮的灯在元件层之下铺一团淡红辉光，元件本体是独立图层，天然压在光晕中心上
// 关掉高级渲染就整段跳过，与激光辉光保持一致；强度随亮起进度一起涨落，灯不会突然冒出一团光
// 用高斯模糊把灯的轮廓整体向外化开，而不是画一个圆形渐变：
// 圆形渐变与方形灯形状对不上，光晕在四角和四边深浅不一，看上去就是一圈能看出来的边界
// 之所以改成「贴一张预模糊好的纹理」而不是每盏灯当场模糊一次：每盏灯要的模糊结果完全一样，只差一个位置
// 之所以不用「先把所有灯画进离屏再整体模糊一次」：那样相邻灯的边缘会先在离屏里叠一次，
// 与原来「每盏灯各自模糊后逐盏叠加」在重叠处对不上，两盏灯挨着时会看出深浅不同
// 灯多的时候走「先在降采样离屏上把各盏灯的光晕叠好、再整块贴回主画布」这条路：
// canvas 的合成是可结合的，先把半透明贴图叠在透明底上、再按不透明贴回，与逐盏直接叠在主画布上结果一致，
// 重叠处不会变样；而每盏灯要光栅化的像素少了降采样倍数的平方倍，灯密的时候这一项就是整帧的大头
function drawLampGlow(vp) {
  if (!S.advancedRenderOn || S.renderSkip.lampGlow) return;   // 逐层开关：排查帧率时可单独关掉灯光晕
  // 画布滤镜是标准能力：纹理本身也靠它生成，浏览器不支持就干脆不画，宁可没有光晕也不要画出一圈硬邦邦的色块
  if (typeof S.ctx.filter !== "string") return;
  // 先扫一遍看这一帧到底有没有亮着的灯：一盏都没有就整段跳过，连纹理都不必生成
  // 只走活跃表：亮着的灯必定在表里（判据里就带着「亮起进度大于零」这一条），不必为这一句话扫全表
  let anyLit = false;
  for (let i = 0; i < S.activeEls.length; i++) {
    const el = S.activeEls[i];
    if (el.typeId === "lamp" && !el.deleting && el.litP.cur > 0) { anyLit = true; break; }
  }
  if (!anyLit) return;

  const sprite = getLampGlowSprite();
  const size = S.lampGlowCacheSize;   // 纹理贴出来的 CSS 边长：由位图像素数除以像素比反推，保证一比一不缩放
  const half = size / 2;            // 半边长：贴图时以灯心为中心

  // 收一遍这一帧真正要贴的灯：同样只走活跃表，并先做视口相交判断
  // 视口外的灯原来靠裁剪挡住画面，但绘制指令照发、浏览器还要先算一次边界；这里提前剔掉，白跑的调用就不发了
  // 顺带把用到的包围盒算出来：贴回主画布时只贴这一块，灯少而集中时贴回量就很小
  const list = S.lampGlowList;
  list.length = 0;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let i = 0; i < S.activeEls.length; i++) {
    const el = S.activeEls[i];
    if (el.typeId !== "lamp" || el.deleting) continue;
    const k = el.litP.cur;
    if (k <= 0) continue;  // 没亮的灯完全不画，省掉一次贴图
    // 位置取画面的视觉位置：数据位置加上拖动缓动偏移，光晕才跟着灯一起滑
    const cx = worldToScreenX(el.wx + el.mvOffU);
    const cy = worldToScreenY(el.wy + el.mvOffV);
    if (cx + half < vp.x || cx - half > vp.x + vp.w) continue;   // 整个光晕都在视口左右之外
    if (cy + half < vp.y || cy - half > vp.y + vp.h) continue;   // 整个光晕都在视口上下之外
    list.push(cx, cy, k);
    if (cx - half < bx0) bx0 = cx - half;
    if (cy - half < by0) by0 = cy - half;
    if (cx + half > bx1) bx1 = cx + half;
    if (cy + half > by1) by1 = cy + half;
  }
  const n = list.length / 3;
  if (n === 0) return;   // 视口内一盏亮灯都没有，连贴图都不必做
  // 包围盒夹进视口：视口外的部分本来就看不见，不夹的话包围盒会白白大出一圈
  if (bx0 < vp.x) bx0 = vp.x;
  if (by0 < vp.y) by0 = vp.y;
  if (bx1 > vp.x + vp.w) bx1 = vp.x + vp.w;
  if (by1 > vp.y + vp.h) by1 = vp.y + vp.h;

  // 走哪条路要先算一笔账：降采样那条把每盏灯的光栅化面积按倍数平方缩小，代价是多贴一次整块包围盒
  // 灯少而散的时候那块包围盒比所有灯加起来还大，这时直接逐盏贴反而更省，所以按面积比一下再决定
  const ds = CONFIG.lampGlowDownscale;
  const boxArea = (bx1 - bx0) * (by1 - by0);
  if (boxArea >= n * size * size * (1 - 1 / (ds * ds))) {
    // 直接逐盏贴在主画布上：与改动前完全一样的画法，灯少时画面也因此逐像素不变
    S.ctx.save();
    // 裁剪到视口：视口外的灯不该把光晕画到面板或画布空白处
    S.ctx.beginPath();
    S.ctx.rect(vp.x, vp.y, vp.w, vp.h);
    S.ctx.clip();
    for (let i = 0; i < list.length; i += 3) {
      // 模糊会把边缘摊薄一半，所以贴边处约是这里的一半浓度，整体就是一层淡红
      S.ctx.globalAlpha = CONFIG.lampGlowAlpha * list[i + 2];
      S.ctx.drawImage(sprite, list[i] - half, list[i + 1] - half, size, size);
    }
    S.ctx.globalAlpha = 1;
    S.ctx.restore();
    pval("亮灯", n);   // 探针读数：贴了多少次光晕贴图，这个数直接对应上面的贴图开销
    return;
  }

  // 合成那条路：先把各盏灯的光晕叠在降采样离屏上
  const layer = getLampGlowLayer();
  const g = S.lampGlowLayerCtx;
  // 清场先回到位图自己的像素坐标系；只清「上一帧用过的那块」与「这一帧要用到的那块」的并集，
  // 灯少时不必每帧清整张位图；而并集一定能盖住上一帧留下的全部内容，不会留残影
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (S.lampGlowPrevUsed) {
    const ux0 = Math.min(S.lampGlowPrevX0, bx0);
    const uy0 = Math.min(S.lampGlowPrevY0, by0);
    const ux1 = Math.max(S.lampGlowPrevX1, bx1);
    const uy1 = Math.max(S.lampGlowPrevY1, by1);
    g.clearRect(ux0 / ds, uy0 / ds, (ux1 - ux0) / ds, (uy1 - uy0) / ds);
  } else {
    g.clearRect(0, 0, layer.width, layer.height);
  }
  S.lampGlowPrevX0 = bx0; S.lampGlowPrevY0 = by0; S.lampGlowPrevX1 = bx1; S.lampGlowPrevY1 = by1;
  S.lampGlowPrevUsed = true;
  // 之后仍用 CSS 像素坐标绘制，只是整体缩小 ds 倍：主画布那份贴图代码才能原样搬过来
  g.setTransform(1 / ds, 0, 0, 1 / ds, 0, 0);
  g.save();
  // 裁剪到包围盒：作画、清场、贴回都按同一块走，范围之外不会被碰
  g.beginPath();
  g.rect(bx0, by0, bx1 - bx0, by1 - by0);
  g.clip();
  for (let i = 0; i < list.length; i += 3) {
    g.globalAlpha = CONFIG.lampGlowAlpha * list[i + 2];
    g.drawImage(sprite, list[i] - half, list[i + 1] - half, size, size);
  }
  g.globalAlpha = 1;
  g.restore();
  // 整块贴回主画布：放大交给浏览器的双线性采样，光晕这种低频图形不会显出锯齿
  S.ctx.save();
  S.ctx.beginPath();
  S.ctx.rect(vp.x, vp.y, vp.w, vp.h);
  S.ctx.clip();
  S.ctx.drawImage(layer,
    bx0 / ds, by0 / ds, (bx1 - bx0) / ds, (by1 - by0) / ds,
    bx0, by0, bx1 - bx0, by1 - by0);
  S.ctx.restore();
  pval("亮灯", n);   // 探针读数：贴了多少次光晕贴图，这个数直接对应上面的贴图开销
}

// 画视口边框，明确标出可显示区域的边界
function drawViewportBorder(vp) {
  S.ctx.save();
  S.ctx.lineWidth = 2;
  S.ctx.strokeStyle = COLOR.border;
  S.ctx.strokeRect(vp.x + 1, vp.y + 1, vp.w - 2, vp.h - 2);
  S.ctx.restore();
}

// 画上方元件面板的占位矩形：左右两条边与网格视口边框严格对齐（同 x、同宽度）
// 线宽和颜色直接沿用视口边框，两者是同一套外框样式，看起来才是一体的
// +1/-2 的写法和视口边框一致：让 2px 描边整个落在矩形内部，外沿正好压在 vp.x 与 vp.x + vp.w 上
function drawPanelBox(vp) {
  const gap = CONFIG.panelGap;
  const x = vp.x;
  const w = vp.w;
  const y = gap;
  const h = vp.y - gap * 2; // 上下各留 gap，中间才是矩形
  S.ctx.save();
  // 底板色硬编码取 COLOR.panelFill，与调试面板的 HSL 滑块解绑：滑块只当取色沙盒，不影响实际渲染
  // 先铺底色再描边：填充范围同样内缩 1px，正好落在描边内侧，边界上不会露出半像素白边
  S.ctx.fillStyle = COLOR.panelFill;
  S.ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  S.ctx.lineWidth = 2;
  S.ctx.strokeStyle = COLOR.border;
  S.ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  S.ctx.restore();
}

// 画底部那条栏：风格与上方元件面板完全一致（同底色、同线宽、同描边色、同样是直角），只是高度减半
// 左右两条边同样与网格视口边框对齐；上下各留一个 panelGap，整页上下才是对称的
// 栏内只放一行随状态变化的操作提示，具体文字见 hintText
function drawBottomBar(vp) {
  const gap = CONFIG.panelGap;
  const h = CONFIG.bottomBarHeight;
  const x = vp.x;
  const w = vp.w;
  const y = state.cssH - gap - h;  // 底边离窗口底一个 gap，从下往上量出栏高
  S.ctx.save();
  S.ctx.fillStyle = COLOR.panelFill;
  S.ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  S.ctx.lineWidth = 2;
  S.ctx.strokeStyle = COLOR.border;
  S.ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  S.ctx.restore();
}

// 当前有没有选中的元件：删除动画中的不算，它已经退出模拟，也不该算进选区
function hasSelectedElement() {
  // 只走活跃表：选中的元件必定在表里，十万个元件里不必为这一句提示扫一遍全表
  for (let i = 0; i < S.activeEls.length; i++) {
    const el = S.activeEls[i];
    if (el.selected && !el.deleting) return true;
  }
  return false;
}

// 底栏提示的文字：按当前状态挑一条最相关的，回答的是「我现在这一刻能干什么」，不是一份说明书
// 顺序就是优先级，越靠前越具体：正在做的动作 > 手上有东西 > 指针下的东西 > 手上拿的工具 > 默认
// 每次重绘都重算一遍，所以不必另外维护一份「当前提示」，状态一变提示自然就跟着变
// 默认状态返回空串，栏里就空着，不硬凑一句话
function hintText() {
  // 正在拉框 / 正在拖动选区：这时候最该说清的是「松手之后会怎样」
  if (S.marqueeActive) return "松开完成框选";
  if (S.moveDragging) return "松手仍是悬空；点空白处才落地";
  // 正在原地编辑浮动文本：说清有哪两条收尾的路；回车在这里是换行，所以确定要专门点明
  if (S.textEditing) return "直接输入；Esc 取消；Cmd/Ctrl+回车 完成";
  // 手上有选中的元件：这时 WASD 转的是整批，H/V 把整批翻一次，右键删的是指针下那一个
  if (hasSelectedElement()) return "WASD旋转；H/V镜像；右键删除";
  // 进了选中工具但手上还空着
  if (selectToolActive()) return "拖动框选；shift追加";
  // 指针不在画布上：位置相关的操作都不作数，按默认处理
  if (!S.pointerInside) return "";
  // 文本工具：手上没有元件，左键的语义改成「放一段文字」或「改指针下那一块」
  // 排在指针下元件的提示之前：这块文字画在元件之上，显示哪一条提示要跟「抓到谁」一致
  if (textToolActive()) return "左键放置文本；拖动移动；双击编辑；右键删除";
  // 指针停在一块浮动文本上：这三件事与手上拿什么工具无关，所以排在工具提示之后、元件提示之前
  if (textAtPointer(S.pointerSX, S.pointerSY) !== null) return "拖动移动；双击编辑；右键删除";
  // 指针停在某个元件上：光源能开关，别的元件只能右键删
  const hovered = findElementAtPointer();
  if (hovered !== null && !hovered.deleting) {
    if (hovered.typeId === "light") return "点击开启/关闭；右键删除";
    return "WASD旋转；右键删除";
  }
  // 手上拿着元件，正在挑格子放；拿的是光源时多一条开关说明
  // WASD旋转放在缩放之后、开关之前：两条提示里它都紧跟着滚轮缩放，位置固定，读起来不会跳
  const typeId = selectedTypeId();
  if (typeId === "light") return "左键放置；数字键/ ` 键选择；中键拖动视野；滚轮缩放；WASD旋转；点击开启/关闭";
  if (typeId !== null) return "左键放置；数字键/ ` 键选择；中键拖动视野；滚轮缩放；WASD旋转";
  return "";  // 默认：无提示
}

// 把提示文字画在底部栏里：单行、垂直居中、左对齐
// 左内缩取与上方第一个元件槽相同的值，上下两栏的左边缘落在同一条竖线上
// 用 save/restore 包住，字体与对齐方式不会漏到后面的绘制里去
function drawBottomBarHint(vp) {
  const text = hintText();
  if (text === "") return;  // 默认状态没有提示，栏里就空着
  const h = CONFIG.bottomBarHeight;
  const y = state.cssH - CONFIG.panelGap - h;
  const x = vp.x + 2 + CONFIG.panelSlotPad;
  S.ctx.save();
  S.ctx.font = CONFIG.hintFontSize + "px " + UI_FONT;
  S.ctx.fillStyle = COLOR.hintText;
  S.ctx.textAlign = "left";
  S.ctx.textBaseline = "middle";
  // 窗口太窄时提示会比栏还宽：宁可不显示，也不要让它压到描边上、甚至溢出到栏外
  if (S.ctx.measureText(text).width > vp.x + vp.w - 16 - x) { S.ctx.restore(); return; }
  S.ctx.fillText(text, x, y + h / 2);
  S.ctx.restore();
}

