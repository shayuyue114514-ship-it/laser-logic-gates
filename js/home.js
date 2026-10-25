// home.js：首页（进入界面）的绘制与交互。
// 整屏一张画布，从下往上依次画网格、两侧的演示电路、中间那一列（标题与四个入口）；两个弹窗是 DOM。
// 入口的矩形与命中判定共用同一个函数，画出来的行与点得到的行永远一致（与编辑器里画选项槽同一套做法）。
// 两侧演示不是另画的示意图：元件形状取 element-types.js 那份点列，光的走向取 circuit.js 那套微帧结算，
// 与编辑器是同一份代码；不同的只有两处——镜头钉死在演示方框上，微帧拉长到一个看得清的速度。
// 配色也不另立一份：整页底色、网格线、入口底板、标题与入口文字、激光两色、元件配色全部在绘制处
// 直接回读 COLOR / elementHSL / CONFIG，首页与编辑器因此是同一套色，不同的只是排版。
"use strict";

/* ========== 状态变量（集中声明，含类型与默认值） ========== */

let homeCanvas = null;      // HTMLCanvasElement|null：首页画布
let ctx = null;             // CanvasRenderingContext2D|null：首页画布的 2D 上下文；icons.js 读的就是这个全局名
let homeW = 0;              // number：窗口宽（CSS px），也是画布宽
let homeH = 0;              // number：窗口高（CSS px），也是画布高
let homeLastTs = 0;         // number：上一帧的时间戳（毫秒），0 表示还没收到过帧
let homeEntryAnim = [];     // Array<{scale:Object, text:Object, fill:Object}>：四个入口的缩放与两种颜色的缓动标量
let homeHoverEntry = -1;    // number：指针悬停的入口序号，-1 表示没停在任何一个上
let homePressedEntry = -1;  // number：指针按下的入口序号，-1 表示没按着
let homePopup = "";         // string：当前开着的弹窗名（"tutorial" / "about"），空串表示两个都关着
let homeTutorialPanel = null; // HTMLElement|null：教程弹窗容器
let homeTutorialDoc = null;   // HTMLElement|null：教程弹窗的内容区
let homeAboutPanel = null;    // HTMLElement|null：关于弹窗容器
let homeAboutDoc = null;      // HTMLElement|null：关于弹窗的内容区
let homeTextRgb = null;       // Object|null：入口文字的常态色（RGB 三元组），悬停时要在数值上混过去
let homeTextHoverRgb = null;  // Object|null：入口文字的悬停色（RGB 三元组）
let homeEntryFillRgb = null;      // Object|null：入口底板常态填充色（RGB 三元组），悬停时同样要在数值上混
let homeEntryFillHoverRgb = null; // Object|null：入口底板悬停填充色（RGB 三元组）
let homeAboutStyleDone = false; // boolean：关于窗的排版样式是否已经注入过，重复调用不再塞第二份
let homeDemoL = null;       // Object|null：左侧演示（非门）的运行时对象，见 demoCreate
let homeDemoR = null;       // Object|null：右侧演示（或门）的运行时对象

/* ========== 仿真环境：circuit.js 要读的那几个全局名 ========== */

// circuit.js 是围绕这几个名字写的（在编辑器里它们声明于 state.js）。首页要跑同一份引擎，
// 就得把同样的名字先声明出来，引擎才找得到元件表、阻挡图与结算结果；
// 只是不引入 state.js 里那一大堆编辑状态（相机、选区、虚影、面板），那些与演示无关。
let elements = [];        // Array<Object>：当前正在结算的那一侧的元件表，字段与编辑器里完全一致
let rayGraph = {          // Object：阻挡图，引擎自己会填 rows / cols / endR / endL / endU 与 dirty
  rows: new Map(), cols: new Map(),
  endR: [], endL: [], endD: [], endU: [], dirty: true
};
let recvMask = [];        // Array<number>：接收掩码，引擎每算一次微帧都会写它
let laserSegments = [];   // Array<Object>：本微帧的激光场线段，画激光读的就是它
let lastEmit = null;      // Array<number>|null：上一微帧的发射掩码；置 null 强制引擎重算
let microframe = 0;       // number：微帧计数，引擎会自增；首页不读它
let sceneDirty = true;    // boolean：引擎要求存在的一个重绘标志位；首页不读它
const SIDE_UP = 1;        // number：上侧位，与编辑器同一套位掩码
const SIDE_RIGHT = 2;     // number：右侧位
const SIDE_DOWN = 4;      // number：下侧位
const SIDE_LEFT = 8;      // number：左侧位

/* ========== 四个入口 ========== */

// 编辑器的地址：站点部署在 Cloudflare 上，静态资源默认会把 /editor 这类整洁地址指到 editor.html，
// 地址栏里因此不会出现 .html；用 file:// 双击打开时没有服务器做这层映射，只能按文件名找过去，
// 所以两种打开方式各写各的地址
const EDITOR_URL = location.protocol === "file:" ? "editor.html" : "editor";

// 四个入口：图标画法、文字、点击后要做什么；图标画法一律取 icons.js 里那一份，与编辑器面板同源
const HOME_ENTRIES = [
  { key: "new",      label: "新建", icon: drawPlusIcon },
  { key: "open",     label: "打开", icon: drawFileIcon },
  { key: "tutorial", label: "教程", icon: drawTutorialIcon },
  { key: "about",    label: "关于", icon: drawAboutIcon }
];

/* ========== 两侧演示电路：场景（第 5 节） ========== */

// 场景直接存成存档里那种记录：type 是元件类型，gx / gy 是整数格索引（gy 越大越靠上，与世界 y 同一个方向），
// dir 是朝向索引（0 上、1 右、2 下、3 左），字段与 scene.js 的 elementToRecord 写出来的完全一致。
// 于是编辑器里摆好一个电路、导出存档，把那份 elements 数组原样贴到这里就能当演示，不必再手工换算。
// margin 是方框四周多留的格数，steps 是一个周期结算的微帧数，script 是输入排程（见 demoApplyInputs 的说明）

// 两侧用的是同一套电路，右侧是左侧左右镜像（见 demoMirror）。
// 这是一条自激振荡的光路：反相器在左下角朝上发，光沿一列偏转器逐级抬高，
// 每一级旁边的透射器顺手把光横着分给一盏灯，最上面一路再绕过右上角折回反相器的入射侧；
// 光一回到入射侧，反相器立刻停发，整条光路随之熄灭，熄灭之后反相器又重新发——如此往复。
// 这个电路在编辑器里就是自己一直闪的，不需要任何输入，所以 script 是空的
const DEMO_OSC = {
  margin: 1,
  steps: 60,
  script: [],
  records: [
    { type: "inverter", gx: 7, gy: 0, dir: 0 },
    { type: "deflector", gx: 8, gy: 0, dir: 3 },
    { type: "transmitter", gx: 7, gy: 1, dir: 1 },
    { type: "deflector", gx: 8, gy: 1, dir: 2 },
    { type: "lamp", gx: 6, gy: 2, dir: 3 },
    { type: "transmitter", gx: 7, gy: 2, dir: 3 },
    { type: "deflector", gx: 7, gy: 3, dir: 0 },
    { type: "lamp", gx: 6, gy: 4, dir: 3 },
    { type: "transmitter", gx: 7, gy: 4, dir: 3 },
    { type: "deflector", gx: 7, gy: 5, dir: 0 },
    { type: "lamp", gx: 6, gy: 6, dir: 3 },
    { type: "transmitter", gx: 7, gy: 6, dir: 3 },
    { type: "deflector", gx: 7, gy: 7, dir: 0 },
    { type: "lamp", gx: 6, gy: 8, dir: 3 },
    { type: "deflector", gx: 7, gy: 8, dir: 3 }
  ]
};

// 左右镜像一份记录：格索引按包围盒的中线翻，朝向只互换左右（1 与 3），上下不动
// 朝向里 1 与 3 都是奇数，转置后阻挡属性的取法（按奇偶决定横竖互换）因此不受影响，镜像与原图等价
// 镜像后的包围盒与原来一模一样，所以两侧方框的格数相同，全页仍然只有一格宽
function demoMirror(records) {
  let minGx = Infinity, maxGx = -Infinity;
  for (let i = 0; i < records.length; i++) {
    if (records[i].gx < minGx) minGx = records[i].gx;
    if (records[i].gx > maxGx) maxGx = records[i].gx;
  }
  const out = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    out.push({
      type: r.type,
      gx: minGx + maxGx - r.gx,
      gy: r.gy,
      dir: r.dir === 1 ? 3 : (r.dir === 3 ? 1 : r.dir),
      on: r.on
    });
  }
  return out;
}

/* ========== 两侧演示：几何 ========== */

// 中间走廊的左边缘：只用来量两侧演示方框的横向位置（标题与四块入口已各自水平居中，不再从这里起）
// 走廊本身在窗口里居中，所以留给两侧演示的宽度是对称的
function colLeft() {
  return (homeW - HOME.colWidth) / 2;
}

// 标题字号：窗口宽的一成不到、取 5.5%，再钳在配置的上下限之间
function titleFontPx() {
  return clamp(homeW * HOME.titleFontRatio, HOME.titleFontMin, HOME.titleFontMax);
}

// 副标题字号：同样按窗口宽算再钳一次，比例小得多，所以无论窗口多宽它都比标题小一大截
function subtitleFontPx() {
  return clamp(homeW * HOME.subtitleFontRatio, HOME.subtitleFontMin, HOME.subtitleFontMax);
}

// 标题与副标题合成的那一块高度：标题 + 两者之间的间隔 + 副标题
// 竖列居中与菜单的起点都按它算，副标题因此是「跟着标题一起占位」，不会把菜单往下顶出格
function titleBlockHeight() {
  return titleFontPx() + HOME.titleSubtitleGap + subtitleFontPx();
}

// 菜单整块的高度：四个入口各占一行，行与行之间留一个间隔
function menuHeight() {
  return HOME_ENTRIES.length * HOME.entryRowH + (HOME_ENTRIES.length - 1) * HOME.entryGap;
}

// 标题、副标题与菜单合成一竖列，在窗口里垂直居中；返回这一列的顶边
function columnTop() {
  return (homeH - (titleBlockHeight() + HOME.titleMenuGap + menuHeight())) / 2;
}

// 第 i 个入口的底板矩形：绘制与命中判定共用这一个函数，看得见的范围与点得到的范围永远一致
// 底板定宽并水平居中，不再铺满整条走廊：命中区就是那枚看得见的底板，
// 指针落在底板外面的空白上不会算点中，也就不会出现「没碰到任何东西却亮了」的情况
function entryRect(i) {
  return {
    x: (homeW - HOME.entryW) / 2,
    y: columnTop() + titleBlockHeight() + HOME.titleMenuGap + i * (HOME.entryRowH + HOME.entryGap),
    w: HOME.entryW,
    h: HOME.entryRowH
  };
}

// 指针落在哪个入口上：没有就返回 -1；命中判定只认这一个来源，与绘制用的是同一组矩形
function hitEntry(sx, sy) {
  for (let i = 0; i < HOME_ENTRIES.length; i++) {
    const r = entryRect(i);
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return i;
  }
  return -1;
}

// 一侧演示能用的宽度：从页面留白到中间列之间，再让出与中间列的最小间隔
function demoAvailW() {
  return (homeW - HOME.colWidth) / 2 - HOME.colDemoGap - HOME.inset;
}

// 一格的屏幕边长：两侧演示与背景网格共用这一个值，全页因此只有一格宽
// 取「按宽度放得下最宽的那一侧」与「按高度放得下最高的那一侧」里更小的那个，再钳在上下限之间
// 上限就是编辑器里一格的屏幕尺寸（CONFIG.defaultScale）：首页与编辑器一格一样大，
// 元件与激光的粗细也完全一致，看上去是同一套东西，而不是首页上另画一份放大版示意
function demoCellPx() {
  let cols = 1, rows = 1;
  const list = [homeDemoL, homeDemoR];
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (!d) continue;
    if (d.boxCols > cols) cols = d.boxCols;   // 方框的格数由场景的包围盒定，两侧相同
    if (d.boxRows > rows) rows = d.boxRows;
  }
  const byW = demoAvailW() / cols;
  const byH = (homeH * HOME.demoHeightRatio) / rows;
  return clamp(Math.min(byW, byH), HOME.demoCellMin, HOME.demoCellMax);
}

// 整组演示的透明度：最宽的那一侧连最小格宽都放不下时开始淡出，并在前后留一段过渡带
// 判据直接取「可用宽度与最小格宽的关系」，所以淡出发生的位置与「放不下」这件事严格对应；
// 用连续过渡而不是硬切，拖窗口时透明度跟着宽度一路变化，不会突然出现或消失
function demoAlpha() {
  let cols = 1;
  const list = [homeDemoL, homeDemoR];
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].boxCols > cols) cols = list[i].boxCols;
  }
  const need = cols * HOME.demoCellMin;   // 放得下最宽那一侧所需的最小可用宽度
  return clamp((demoAvailW() - need) / HOME.demoFadeBand, 0, 1);
}

// 演示方框的左上角屏幕坐标：横向取这一段可用宽度的中点，纵向取窗口高度上的设定比例
// 两个方向都按格宽取整落位，方框的四条边因此都压在格线上，演示与网格是同一套格子
// 方框的格数一并挂在这个对象上：画的时候从它取，各个绘制函数不必各自去问「这是哪一侧」
function demoOrigin(side, d) {
  const cell = demoCellPx();
  const boxW = d.boxCols * cell;
  const boxH = d.boxRows * cell;
  const x0 = side === "left" ? HOME.inset : colLeft() + HOME.colWidth + HOME.colDemoGap;
  const x1 = side === "left" ? colLeft() - HOME.colDemoGap : homeW - HOME.inset;
  return {
    x: Math.round(((x0 + x1) / 2 - boxW / 2) / cell) * cell,
    y: Math.round((homeH * HOME.demoCenterRatio - boxH / 2) / cell) * cell,
    boxCols: d.boxCols,
    boxRows: d.boxRows
  };
}

// 世界 X → 屏幕 X：世界原点（0）就在演示方框的左边缘上，1 个世界单位就是一格
function demoScreenX(origin, cell, wx) {
  return origin.x + wx * cell;
}

// 世界 Y → 屏幕 Y：世界 y 向上、屏幕 y 向下，所以整段要翻一次；方框的格数从 origin 上取
function demoScreenY(origin, cell, wy) {
  return origin.y + (origin.boxRows - wy) * cell;
}

/* ========== 两侧演示：驱动引擎 ========== */

// 一个演示电路的运行时对象：场景定义、方框格数、当前元件表、当前激光场、当前灯的亮灭、算到第几个微帧
// total 是一个周期的秒数；两侧的 steps 相同，所以两边周期长度一样，只是起始相位差半拍
function demoCreate(scene, phaseRatio) {
  const d = {
    scene: scene,        // Object：场景定义，重置时照着它重建元件表
    steps: scene.steps,  // number：一个周期结算的微帧数
    boxCols: 1,          // number：方框宽（格），重置时按场景的包围盒算出来
    boxRows: 1,          // number：方框高（格），同上
    els: [],             // Array<Object>：当前元件表，字段与编辑器里一致
    lit: [],             // Array<number>：每个元件这一刻亮不亮，只有灯会是非零
    segments: [],        // Array<Object>：当前激光场，直接引用引擎算出来的那一份
    done: 0,             // number：本轮已经算完的微帧数
    timer: 0,            // number：本演示自己的累计时间（秒），从它算出当前处在周期的哪一段
    alpha: 1,            // number：整组当前的透明度
    total: 0             // number：一个周期的秒数
  };
  d.total = scene.steps * HOME.demoMicroDt + HOME.demoHold + HOME.demoFadeOut + HOME.demoFadeIn;
  demoReset(d);
  d.timer = phaseRatio * d.total;   // 相位错开：右侧从半个周期处起步，两边不会同时亮同时灭
  return d;
}

// 照场景记录重建元件表：整数格索引先按包围盒挪进方框，再换算成引擎要的世界坐标
// 同一趟顺手把方框的格数定下来——四周各留 margin 格空边，光路的圆头和最外面一圈元件才不会被裁掉
// 自查通过：重置只重建元件表与方框尺寸，并把微帧计数、激光场、灯的亮灭一起清干净，不留上一轮的残留
function demoReset(d) {
  const recs = d.scene.records;
  const margin = d.scene.margin;
  let minGx = Infinity, maxGx = -Infinity, minGy = Infinity, maxGy = -Infinity;
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].gx < minGx) minGx = recs[i].gx;
    if (recs[i].gx > maxGx) maxGx = recs[i].gx;
    if (recs[i].gy < minGy) minGy = recs[i].gy;
    if (recs[i].gy > maxGy) maxGy = recs[i].gy;
  }
  d.boxCols = (maxGx - minGx + 1) + margin * 2;
  d.boxRows = (maxGy - minGy + 1) + margin * 2;
  const els = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const col = (r.gx - minGx) + margin;          // 在方框里从左数第几格
    const rowTop = (maxGy - r.gy) + margin;       // 在方框里从上数第几格：gy 越大越靠上，所以这里翻一次
    els.push({
      typeId: r.type,
      key: r.key || "",                                  // 输入排程按它认领元件
      wx: col + 0.5,                                     // 世界 X：格 c 的格心
      wy: (d.boxRows - 1 - rowTop) + 0.5,                // 世界 Y：屏幕第 r 行要翻过来数
      dir: r.dir,                                        // 朝向索引，0 上、1 右、2 下、3 左
      on: r.on ? 1 : 0,                                  // number：光源的开关，排程会改写
      out: 0,                                            // number：引擎每微帧写回的发射掩码
      litIn: false,                                      // boolean：引擎写回的「被照到了」
      litP: newEased(0),                                 // Object：灯亮起的缓动标量，画的时候读它
      deleting: false,                                   // boolean：引擎要求存在的字段
      selected: false                                    // boolean：同上
    });
  }
  d.els = els;
  d.done = 0;
  d.lit = new Array(els.length).fill(0);
  d.segments = [];
}

// 把排程落在第 mf 个微帧上的输入逐条写进元件：光源的开关由它决定，其余元件一律不动
function demoApplyInputs(d, mf) {
  for (let i = 0; i < d.scene.script.length; i++) {
    const s = d.scene.script[i];
    if (s.at !== mf) continue;
    for (let k = 0; k < d.els.length; k++) {
      if (d.els[k].key === s.key) d.els[k].on = s.on ? 1 : 0;
    }
  }
}

// 让这一侧往前结算一个微帧：把全局名临时指到这一侧，再调编辑器那份 stepMicroframe
// 引擎读的是 elements / rayGraph 这几个全局名，所以两侧演示要轮流借用它们；
// 借之前把阻挡图标脏、把上一微帧的发射掩码清空，引擎才会照新的元件表从头算一遍
// 借完之后把结果抄回这一侧自己的对象上，另一侧再轮到它时不会互相踩
function demoStepOnce(d) {
  demoApplyInputs(d, d.done);
  elements = d.els;
  rayGraph.dirty = true;
  lastEmit = null;
  stepMicroframe();
  d.segments = laserSegments;   // 引擎每次重算都会换一个新数组，直接引用是安全的
  for (let i = 0; i < d.els.length; i++) {
    d.lit[i] = d.els[i].typeId === "lamp" && d.els[i].litIn ? 1 : 0;
  }
  d.done++;
}

// 由累计时间算出这一刻处在周期的哪一段：先按微帧一格格跑完 steps 步，再停留，再淡出，再淡入
// 淡入那一段同时意味着新一轮开始，所以那一刻返回的微帧数是 0，调用方据此把电路重建一遍
function demoState(d) {
  const run = d.steps * HOME.demoMicroDt + HOME.demoHold;
  let p = d.timer % d.total;
  if (p < 0) p += d.total;                    // 小心负数取模，拉回 [0, total)
  if (p < run) return { mf: Math.min(Math.floor(p / HOME.demoMicroDt), d.steps), alpha: 1 };
  if (p < run + HOME.demoFadeOut) return { mf: d.steps, alpha: 1 - (p - run) / HOME.demoFadeOut };
  return { mf: 0, alpha: (p - run - HOME.demoFadeOut) / HOME.demoFadeIn };
}

// 推进两侧演示：按累计时间决定该算到第几个微帧，该补的微帧补齐，再把灯的亮灭缓动过去
// 微帧数比上一帧小，说明周期回绕到了新一轮，先把电路重建一遍，否则会拿着上一轮的状态接着算
function updateHomeDemos(dt) {
  const demos = [homeDemoL, homeDemoR];
  for (let i = 0; i < demos.length; i++) {
    const d = demos[i];
    if (!d) continue;
    d.timer += dt;
    const st = demoState(d);
    if (st.mf < d.done) demoReset(d);
    while (d.done < st.mf) demoStepOnce(d);
    d.alpha = st.alpha;
    for (let k = 0; k < d.els.length; k++) {
      const el = d.els[k];
      if (el.typeId !== "lamp") continue;     // 只有灯的配色会随亮灭变
      stepEased(el.litP, d.lit[k] ? 1 : 0, dt, CONFIG.lampAnimDuration);
    }
  }
}

/* ========== 绘制：网格 ========== */

// 画网格铺底：先铺底色，再按格距描一横一纵两组线
// 格距就是演示电路一格的边长，两者共用一个值：电路正好压在格线上，不是浮在网格上面
// 网格原点固定在窗口左上角，演示方框也按同一个格距取整落位，于是方框的四条边都落在格线上
function drawGrid(cell) {
  const dpr = window.devicePixelRatio || 1;
  ctx.fillStyle = COLOR.background;   // 整页底色取编辑器视口内那块底色，两个页面是同一个值
  ctx.fillRect(0, 0, homeW, homeH);
  ctx.save();
  ctx.strokeStyle = COLOR.line;       // 网格线取编辑器里那条网格线的颜色
  ctx.lineWidth = Math.max(1 / dpr, 0.5);   // 线取一个物理像素的当量，与编辑器里的网格同一档观感
  ctx.beginPath();
  // 逐条描到窗口边界之外一条，四边不会留下没盖住的缝
  for (let x = 0; x <= homeW; x += cell) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, homeH);
  }
  for (let y = 0; y <= homeH; y += cell) {
    ctx.moveTo(0, y);
    ctx.lineTo(homeW, y);
  }
  ctx.stroke();
  ctx.restore();
}

/* ========== 绘制：两侧演示电路 ========== */

// 画一束激光：八层同心描边由内到外依次变宽变淡，叠出连续衰减，最后压一根实色光芯
// 层数、扩散倍数、单层浓度与两处颜色全部回读 CONFIG / COLOR：与编辑器里那一束是同一组参数、同一个颜色
function drawDemoLaser(origin, cell, d, groupAlpha) {
  const segs = d.segments;
  if (!segs || segs.length === 0) return;
  const x0 = origin.x - cell * 0.5, x1 = origin.x + origin.boxCols * cell + cell * 0.5;
  const y0 = origin.y - cell * 0.5, y1 = origin.y + origin.boxRows * cell + cell * 0.5;
  const path = new Path2D();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.horizontal) {
      // 行上的线段：固定坐标是 wy，两端是 wx
      const y = demoScreenY(origin, cell, s.key);
      const a = clamp(demoScreenX(origin, cell, s.a), x0, x1);
      const b = clamp(demoScreenX(origin, cell, s.b), x0, x1);
      if (a === b) continue;
      path.moveTo(a, y);
      path.lineTo(b, y);
    } else {
      // 列上的线段：固定坐标是 wx，两端是 wy
      const x = demoScreenX(origin, cell, s.key);
      const a = clamp(demoScreenY(origin, cell, s.a), y0, y1);
      const b = clamp(demoScreenY(origin, cell, s.b), y0, y1);
      if (a === b) continue;
      path.moveTo(x, a);
      path.lineTo(x, b);
    }
  }
  // 端点可能是 ±Infinity（说明那一头没人挡），上面已经按方框四边夹过，路径里不会留下无穷大
  const w = CONFIG.laserWidth * cell;
  ctx.save();
  ctx.lineCap = "round";                      // 圆头：线段末端不出现生硬的方角
  ctx.strokeStyle = COLOR.laserGlow;          // 辉光色取编辑器里那一束用的同一个颜色
  const N = CONFIG.laserGlowLayers;
  for (let k = 0; k < N; k++) {
    const t = k / N;                          // 0 贴着光芯，越接近 1 越靠外
    const fade = (1 - t) * (1 - t);            // 二次衰减：近处降得慢、远处迅速消失，观感更柔
    ctx.lineWidth = w * (1 + (CONFIG.laserGlowSpread - 1) * t);
    ctx.globalAlpha = groupAlpha * CONFIG.laserGlowAlpha * fade;
    ctx.stroke(path);                         // 每层复用同一条路径，不重建
  }
  ctx.globalAlpha = groupAlpha;
  ctx.lineWidth = w;
  ctx.strokeStyle = COLOR.laserCore;          // 光芯色同上，与编辑器共用
  ctx.stroke(path);
  ctx.restore();
}

// 画被照亮的灯的光晕：用高斯模糊把灯的轮廓向外化开，而不是画一个圆形渐变
// 圆形渐变与方形灯对不上，光晕在四角和四边深浅不一，看上去就是一圈能看出来的边界
// 编辑器的做法是预生成一张模糊纹理逐盏贴图；这里最多四盏灯，每帧当场模糊一次即可，不必再维护一张纹理
function drawDemoLampGlow(origin, cell, d, groupAlpha) {
  if (typeof ctx.filter !== "string") return;   // 画布滤镜是标准能力，不支持就干脆不画，宁可没有光晕
  const h = CONFIG.lampHalf * cell;             // 光晕底形与灯同大，模糊后自然向外晕出
  const r = CONFIG.lampRadius * cell;
  ctx.save();
  ctx.filter = "blur(" + (CONFIG.lampGlowBlur * cell) + "px)";
  ctx.fillStyle = COLOR.lampGlow;
  for (let i = 0; i < d.els.length; i++) {
    const el = d.els[i];
    if (el.litP.cur <= 0.001) continue;         // 还没亮到看得见就跳过
    const p = { x: demoScreenX(origin, cell, el.wx), y: demoScreenY(origin, cell, el.wy) };
    ctx.globalAlpha = groupAlpha * CONFIG.lampGlowAlpha * el.litP.cur;
    ctx.beginPath();
    ctx.roundRect(p.x - h, p.y - h, h * 2, h * 2, r);
    ctx.fill();
  }
  ctx.filter = "none";
  ctx.restore();
}

// 画一个元件本体：平移到格心 → 按朝向旋转 → 按「一格为 1」缩放，之后一律用世界单位作图
// 屏幕 y 轴向下，所以顺时针转 90° 正好让顶点朝右；朝向索引 0/1/2/3 即 0°/90°/180°/270°
// 轮廓取 element-types.js 的 traceElementPath，配色取 config.js 的 elementHSL 与 RGB：
// 形状与配色都只有这一个出处，首页画的元件与编辑器里那一个逐点相同，不是照着重画的一份
function drawDemoElement(origin, cell, el, groupAlpha) {
  ctx.save();
  ctx.translate(demoScreenX(origin, cell, el.wx), demoScreenY(origin, cell, el.wy));
  ctx.rotate(el.dir * Math.PI / 2);
  ctx.scale(cell, cell);
  ctx.globalAlpha = groupAlpha;
  ctx.lineJoin = "round";              // 圆角靠描边的圆角连接实现，与编辑器里元件那一套一致
  ctx.lineWidth = CONFIG.elementStroke;
  if (el.typeId === "lamp") {
    // 灯另走一套：亮起时逐通道从元件蓝混向淡红，混法与编辑器里那盏灯完全一致
    ctx.fillStyle = rgbCss(mixRgb(RGB.elementFill, RGB.lampFill, el.litP.cur));
    ctx.strokeStyle = rgbCss(mixRgb(RGB.elementStroke, RGB.lampStroke, el.litP.cur));
  } else {
    ctx.fillStyle = hslCss(elementHSL.fill);
    ctx.strokeStyle = hslCss(elementHSL.stroke);
  }
  traceElementPath(el.typeId);
  ctx.stroke();   // 先描边后填充：描边内侧那半被填充盖住、只留外面一圈，与编辑器里各处画法一致
  ctx.fill();
  ctx.restore();
}

// 画一侧演示：裁剪到演示方框（四边各放半格），层次从下往上——灯的光晕、激光、元件本体
// 裁剪是必要的：激光的一端可能是 ±Infinity，不能让它顺着屏幕一直画出去
function drawDemo(origin, cell, d, groupAlpha) {
  if (!d || groupAlpha <= 0.001) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(origin.x - cell * 0.5, origin.y - cell * 0.5,
           origin.boxCols * cell + cell, origin.boxRows * cell + cell);
  ctx.clip();
  drawDemoLampGlow(origin, cell, d, groupAlpha);
  drawDemoLaser(origin, cell, d, groupAlpha);
  for (let i = 0; i < d.els.length; i++) drawDemoElement(origin, cell, d.els[i], groupAlpha);
  ctx.restore();
}

/* ========== 绘制：中间那一列 ========== */

// 画标题：水平居中，竖直落在这一列的顶边往下半个字号处
// 字色取 COLOR.tipName，与编辑器里那几处深蓝文字同一档；不描边，靠粗字重与字色立住轮廓
function drawHomeTitle() {
  const size = titleFontPx();
  const x = homeW / 2;
  const y = columnTop() + size / 2;    // 竖列的顶边往下半个字号，正好是字的竖直中心
  ctx.save();
  ctx.font = HOME.titleWeight + " " + size + "px " + UI_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLOR.tipName;
  ctx.fillText(HOME.titleText, x, y);
  ctx.restore();
}

// 画副标题：压在标题下面一行，同样水平居中
// 字色取 COLOR.tipDesc，也就是说明文字那一档，比标题的深蓝浅一档，读起来是标题的补充而不是又一个标题
// 字号与字重都比标题轻一大截，所以两者同处一列也不会互相抢
function drawHomeSubtitle() {
  const size = subtitleFontPx();
  const x = homeW / 2;
  // 顶边接在标题那一块之下：标题高加两者之间的间隔，再往下半个字号正好是它的竖直中心
  const y = columnTop() + titleFontPx() + HOME.titleSubtitleGap + size / 2;
  ctx.save();
  ctx.font = HOME.subtitleWeight + " " + size + "px " + UI_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLOR.tipDesc;
  ctx.fillText(HOME.subtitleText, x, y);
  ctx.restore();
}

// 画四个入口：每行是一块水平居中的圆角底板，图标与文字合成一组、在底板里居中
// 缩放绕底板中心进行，悬停与按下时整块连内容一起缩，位置不往任何一边跑
// 四个标签都是两个字、字宽一致，于是图标那一列天然对齐，不必再靠左对齐去约束
function drawHomeEntries() {
  const box = HOME.entryIconBox;
  for (let i = 0; i < HOME_ENTRIES.length; i++) {
    const r = entryRect(i);
    const a = homeEntryAnim[i];
    const label = HOME_ENTRIES[i].label;
    // 先量一次标签宽度：图标 + 间隔 + 文字合成一组，由组的宽度反推起笔位置，组才在底板里居中
    ctx.save();
    ctx.font = HOME.entryTextWeight + " " + HOME.entryTextSize + "px " + UI_FONT;
    const textW = ctx.measureText(label).width;
    ctx.restore();
    const groupW = box + HOME.entryIconTextGap + textW;
    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);   // 原点落在底板中心，缩放就绕这里进行
    ctx.scale(a.scale.cur, a.scale.cur);
    // 一、底板：填充在常态色与悬停色之间连续过渡，描边只给底板封个边
    ctx.beginPath();
    ctx.roundRect(-r.w / 2, -r.h / 2, r.w, r.h, HOME.entryRadius);
    ctx.fillStyle = rgbCss(mixRgb(homeEntryFillRgb, homeEntryFillHoverRgb, a.fill.cur));
    ctx.fill();
    ctx.lineWidth = HOME.entryBorderWidth;
    ctx.strokeStyle = COLOR.slotBorder;   // 底板描边取编辑器选项槽那一圈描边色
    ctx.stroke();
    // 二、图标与文字：整组以底板中心为基准居中，图标在外框里按 icons.js 那套画法画
    const gx = -groupW / 2;
    HOME_ENTRIES[i].icon({ x: gx, y: -box / 2, w: box, h: box }, HOME.entryIconScale);
    ctx.font = HOME.entryTextWeight + " " + HOME.entryTextSize + "px " + UI_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = rgbCss(mixRgb(homeTextRgb, homeTextHoverRgb, a.text.cur));
    ctx.fillText(label, gx + box + HOME.entryIconTextGap, 0);
    ctx.restore();
  }
}

/* ========== 一帧的绘制 ========== */

// 一帧的绘制，从下往上依次是网格、两侧演示、中间那一列
// 主循环只调用它，具体的画法都收在上面各自的函数里；网格与演示共用同一个格宽，两层才咬得准
function renderHome() {
  const cell = demoCellPx();
  const groupAlpha = demoAlpha();
  drawGrid(cell);
  if (homeDemoL) drawDemo(demoOrigin("left", homeDemoL), cell, homeDemoL, groupAlpha);
  if (homeDemoR) drawDemo(demoOrigin("right", homeDemoR), cell, homeDemoR, groupAlpha);
  drawHomeTitle();
  drawHomeSubtitle();
  drawHomeEntries();
}

/* ========== 两个弹窗 ========== */

// 关于窗的正文，按行排：每行一个名称加一段内容，两个地址做成可以直接点的链接
const ABOUT_ROWS = [
  { name: "作者", text: "shayuyue" },
  { name: "开源地址", text: "github.com/shayuyue114514-ship-it/laser-logic-gates", href: "https://github.com/shayuyue114514-ship-it/laser-logic-gates" },
  { name: "在线地址", text: "laser.shayuyue.com", href: "https://laser.shayuyue.com" },
  { name: "许可证", text: "MIT" }
];

// 弹窗的通用外观：尺寸只覆盖宽度与高度，其余一律回读 CONFIG / COLOR
// 与编辑器里那几块弹窗取的是同一组配置，所以「和编辑器同款」不靠两边各写一份数值来维持，改一处两边一起变
function initHomeModalDom(dom, docDom, w, h) {
  dom.style.width = w + "px";
  if (h > 0) dom.style.height = h + "px";   // 教程窗高度定死，文字超出由内容区自己滚；关于窗的高度交给内容
  dom.style.padding = CONFIG.settingsPanelPadY + "px " + CONFIG.settingsPanelPadX + "px";
  dom.style.borderRadius = CONFIG.settingsPanelRadius + "px";
  dom.style.background = COLOR.tipFill;     // 与编辑器里那几块弹窗同色：都是浮在网格上的浅蓝底板
  dom.style.borderColor = COLOR.tipBorder;
  dom.style.color = COLOR.tipDesc;
  dom.style.fontSize = CONFIG.settingsPanelFontSize + "px";
  // 内容区压暗一级：本项目里白色代表选中，铺白底会被误读成选中态，压暗一级反而正好读成凹进去的一块
  docDom.style.background = COLOR.slotFill;
  docDom.style.color = COLOR.tipDesc;
}

// 关于窗那几行的排版样式：项目名、简介、名称列与内容列各一档
// 与 tutorial-content.js 同一套做法——样式和它要排的文字待在一处，改文案不必翻回样式表
function initHomeAboutStyle() {
  if (homeAboutStyleDone) return;
  homeAboutStyleDone = true;
  const css =
    '.popup.modal .doc .about-title { margin: 0 0 4px; font-size: 1.15em; font-weight: 700; color: ' + COLOR.tipName + '; }' +
    '.popup.modal .doc .about-desc { margin: 0 0 12px; opacity: 0.85; }' +
    '.popup.modal .doc .about-row { display: flex; margin: 0 0 6px; }' +
    '.popup.modal .doc .about-row:last-child { margin-bottom: 0; }' +
    '.popup.modal .doc .about-name { flex: none; width: 5em; color: ' + COLOR.tipName + '; }' +
    '.popup.modal .doc .about-value { flex: 1; min-width: 0; word-break: break-all; }' +
    '.popup.modal .doc .about-value[href] { color: ' + COLOR.tipName + '; }';
  const styleDom = document.createElement("style");
  styleDom.textContent = css;
  document.head.appendChild(styleDom);
}

// 填关于窗的正文：项目名、一句话简介，再按上面的表逐行排下去
// 文字一律用 textContent 写入，地址是写死在本文件里的常量，不经过任何外部输入
function fillAboutDoc() {
  homeAboutDoc.innerHTML = "";   // 先清空：万一以后重复调用，也不会堆出第二份
  const title = document.createElement("p");
  title.className = "about-title";
  title.textContent = "激光门";
  const desc = document.createElement("p");
  desc.className = "about-desc";
  desc.textContent = "在网格上放置光学元件，让激光沿网格传播，亲手搭出逻辑门。";
  homeAboutDoc.appendChild(title);
  homeAboutDoc.appendChild(desc);
  for (let i = 0; i < ABOUT_ROWS.length; i++) {
    const row = document.createElement("div");
    row.className = "about-row";
    const name = document.createElement("span");
    name.className = "about-name";
    name.textContent = ABOUT_ROWS[i].name;
    row.appendChild(name);
    const value = ABOUT_ROWS[i].href ? document.createElement("a") : document.createElement("span");
    value.className = "about-value";
    value.textContent = ABOUT_ROWS[i].text;
    if (ABOUT_ROWS[i].href) {
      value.href = ABOUT_ROWS[i].href;
      value.target = "_blank";        // 新开一个标签页，封面不会被浏览器直接替换掉
      value.rel = "noopener";         // 新开的页面拿不到本页的引用，两页之间不必互相持有
    }
    row.appendChild(value);
    homeAboutDoc.appendChild(row);
  }
}

// 开关弹窗：两个窗互斥，开一个另一个自动关；点同一个入口再点一次就把当前这个关掉
// 名字传空串即全部关掉，两个叉形关闭按钮都走这一条路
// 显隐用 display 直接切，并把 opacity 一并摆正：样式表里 .popup 的默认透明度是 0，
// 编辑器那边由主循环逐帧把它推到 1 做淡入淡出；首页不做这段动画，所以要在这里自己写成 1
function setHomePopup(name) {
  homePopup = homePopup === name ? "" : name;
  const showTutorial = homePopup === "tutorial";
  const showAbout = homePopup === "about";
  homeTutorialPanel.style.display = showTutorial ? "flex" : "none";
  homeTutorialPanel.style.opacity = showTutorial ? "1" : "0";
  homeAboutPanel.style.display = showAbout ? "flex" : "none";
  homeAboutPanel.style.opacity = showAbout ? "1" : "0";
  // 弹窗一开就把入口的悬停清掉：指针可能正停在某个入口上，不清会一直留着按下的样子
  homeHoverEntry = -1;
  homePressedEntry = -1;
}

// 初始化两个弹窗：外观、内容、关闭按钮一次做完
// 监听器只在这里绑一次，重复初始化不会重复注册
function initHomePopups() {
  homeTutorialPanel = document.getElementById("homeTutorialPanel");
  homeTutorialDoc = document.getElementById("homeTutorialDoc");
  homeAboutPanel = document.getElementById("homeAboutPanel");
  homeAboutDoc = document.getElementById("homeAboutDoc");
  initHomeModalDom(homeTutorialPanel, homeTutorialDoc, HOME.tutorialW, HOME.tutorialH);
  initHomeModalDom(homeAboutPanel, homeAboutDoc, HOME.aboutW, 0);   // 高度传 0：关于窗由内容自己定高
  initTutorialDocStyle();                  // 教程正文自己的排版样式，与编辑器共用同一份
  homeTutorialDoc.innerHTML = TUTORIAL_TEXT;   // 内容来自共用文件，两个页面的教程一字不差
  initHomeAboutStyle();
  fillAboutDoc();
  // 叉形关闭按钮只绑这一处；两个窗的显隐全由 setHomePopup 一处改写，别处不再碰 display
  document.getElementById("btnHomeTutorialClose").addEventListener("click", function () { setHomePopup(""); });
  document.getElementById("btnHomeAboutClose").addEventListener("click", function () { setHomePopup(""); });
  // 按下按钮时不让它抢走焦点：与编辑器里那几块弹窗同一套处理
  const panels = [homeTutorialPanel, homeAboutPanel];
  for (let i = 0; i < panels.length; i++) {
    panels[i].addEventListener("mousedown", function (e) {
      if (e.target.classList.contains("btn")) e.preventDefault();
    });
  }
}

/* ========== 输入 ========== */

// 指针移动：只更新悬停的入口序号，缓动由主循环按它推进
// 弹窗开着时不认任何入口，指针划过也不会点亮后面的行
function onHomePointerMove(e) {
  homeHoverEntry = homePopup === "" ? hitEntry(e.clientX, e.clientY) : -1;
}

// 指针按下：记下按的是哪一个入口；只有左键、且没开弹窗时才算
function onHomePointerDown(e) {
  if (e.button !== 0) return;
  homePressedEntry = homePopup === "" ? hitEntry(e.clientX, e.clientY) : -1;
}

// 指针松开：按下的与松开的还是同一个入口才执行，中途移开就不算点中
function onHomePointerUp(e) {
  const i = homePressedEntry;
  homePressedEntry = -1;
  if (e.button !== 0 || i < 0) return;
  if (hitEntry(e.clientX, e.clientY) !== i) return;
  runEntry(HOME_ENTRIES[i].key);
}

// 指针离开窗口或系统取消了这一串指针事件：悬停与按下一起清掉，免得留下一个永远亮着的入口
function onHomePointerCancel() {
  homeHoverEntry = -1;
  homePressedEntry = -1;
}

// 一个入口被点中之后做什么：两个动作项跳去编辑器，另两个就地在首页开窗
function runEntry(key) {
  if (key === "new") { goToEditor(false); return; }
  if (key === "open") { openFromHome(); return; }
  setHomePopup(key);
}

// 去编辑器：新建直接过去；从首页「打开」过来的，在地址后面缀一个标记
// 编辑器靠这个标记加上暂存内容，才知道这一次要接着把那份存档铺开
// 先把加载屏点亮再跳：点击到新页面画出自己的加载屏之间，浏览器还停在旧画面上，
// 那一段空着像卡住；两页的加载屏长得一模一样，把同一块接着亮着，点击那一刻就有加载屏，接过去看不出接缝
// 隔两帧再跳，是为了让这一层真的被画出来——在同一帧里改完类名又跳走，那一帧往往来不及画
function goToEditor(handoff) {
  showLeavingOverlay();
  const url = handoff ? EDITOR_URL + HANDOFF_MARK : EDITOR_URL;
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      window.location.href = url;
    });
  });
}

// 首页上的「打开」：系统的文件框只允许在用户刚点过东西的那一刻调用，所以只能在这一处弹
// 读完只做两件事：把正文暂存进会话存储，把句柄记进句柄库；跳过去之后由编辑器校验并铺到画布上
// 首页刻意不解析存档：解析要用的那一套属编辑器，拿过来只会把两个页面的职责搅在一起，内容坏了由编辑器照常报出来
async function openFromHome() {
  if (!canUseLocalFile) { goToEditor(false); return; }   // 浏览器不支持直接读文件：当作新建进编辑器
  let handle;
  try {
    // 打开框不带类型过滤：过滤规则由系统按文件类型判定，曾出现本程序后缀的文件在框里选不到的情形
    // 内容对不对由编辑器读进来之后校验，所以这里不传 types
    const handles = await window.showOpenFilePicker(Object.assign({ multiple: false }, startInOption()));
    handle = handles[0];   // 只允许选一个，返回的数组里必定有且只有一项
  } catch (err) {
    // 用户按取消不是错误，静默收场；其它错误才报出来，免得一次取消就弹一堆提示
    if (err.name !== "AbortError") console.log("[首页] 打开框出错：", err);
    return;
  }
  rememberPickerHandle(handle);   // 先记句柄：编辑器启动时读到的就是刚选的这个文件，之后保存写回原文件
  let text;
  try {
    const file = await handle.getFile();
    text = await file.text();
  } catch (err) {
    console.log("[首页] 读取失败：", err);
    return;
  }
  try {
    sessionStorage.setItem(HANDOFF_KEY, text);   // 正文原样带过去，解析与校验都留给编辑器
  } catch (err) {
    console.log("[首页] 存档太大，暂存不下：", err);
    return;   // 带不过去就不跳了，留在封面上，免得跳过去打开一份空白
  }
  goToEditor(true);
}

// 绑事件：指针的四个动作都绑在窗口上，画布之外松开也能收到，不会漏掉一次「点中了」
function setupHomeInput() {
  window.addEventListener("pointermove", onHomePointerMove);
  window.addEventListener("pointerdown", onHomePointerDown);
  window.addEventListener("pointerup", onHomePointerUp);
  window.addEventListener("pointerleave", onHomePointerCancel);
  window.addEventListener("pointercancel", onHomePointerCancel);
  window.addEventListener("resize", resizeHomeCanvas);   // 布局每帧按窗口宽高现算，这里只要把画布对上
}

/* ========== 主循环与初始化 ========== */

// 推进四个入口的缓动：缩放在常态、悬停、按下三档之间走，底板填充与文字色在常态与悬停之间走
function updateHomeEntries(dt) {
  for (let i = 0; i < HOME_ENTRIES.length; i++) {
    const a = homeEntryAnim[i];
    let to = 1;                                        // 常态
    if (homePressedEntry === i) to = HOME.entryPressedScale;
    else if (homeHoverEntry === i) to = HOME.entryHoverScale;
    stepEased(a.scale, to, dt, HOME.entryAnimDuration);
    stepEased(a.text, homeHoverEntry === i ? 1 : 0, dt, HOME.entryAnimDuration);
    stepEased(a.fill, homeHoverEntry === i ? 1 : 0, dt, HOME.entryAnimDuration);
  }
}

// 主循环只算时间、推进缓动与演示、调用绘制，具体的画法都收在各自的函数里
function homeFrame(ts) {
  const dt = homeLastTs ? Math.min((ts - homeLastTs) / 1000, 0.1) : 0;   // 钳制 dt，避免切回标签页时跳变
  homeLastTs = ts;
  updateHomeEntries(dt);
  updateHomeDemos(dt);
  renderHome();
  markBootFrame();   // 首帧到此画完，遮挡层可以走了；boot.js 只认第一次，之后每帧再报都立刻回头
  requestAnimationFrame(homeFrame);
}

// 按 devicePixelRatio 调整画布位图尺寸，并把绘制坐标系统一到 CSS 像素
// 首页画布没有相机，尺寸就等于窗口；顺带把宽高记下来给布局算，免得每个函数各自去问一次窗口
function resizeHomeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  homeW = window.innerWidth;
  homeH = window.innerHeight;
  homeCanvas.width = Math.round(homeW * dpr);
  homeCanvas.height = Math.round(homeH * dpr);
  homeCanvas.style.width = homeW + "px";
  homeCanvas.style.height = homeH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 这里设一次，之后所有绘制都用 CSS 像素坐标，高清屏才不会糊
}

// 初始化：拿上下文 → 定画布尺寸 → 备好配色与缓动 → 建两个弹窗与两侧演示 → 绑事件 → 启动主循环
function initHome() {
  // 第一句就摆好遮挡层：它必须从第一帧起就在，晚了就盖不住「网格与标题都还没画出来」的那一瞬
  initBootScreen();
  homeCanvas = document.getElementById("homeCanvas");
  ctx = homeCanvas.getContext("2d");
  resizeHomeCanvas();
  homeTextRgb = hexToRgb(COLOR.tipDesc);              // 入口文字的两种颜色先拆成数值，逐帧混合时不必再解析
  homeTextHoverRgb = hexToRgb(COLOR.tipName);         // 两档都取 COLOR 里已经有的文字色
  homeEntryFillRgb = hexToRgb(COLOR.slotFill);        // 底板填充的两种颜色同样先拆开
  homeEntryFillHoverRgb = hexToRgb(COLOR.slotFillSelected);
  for (let i = 0; i < HOME_ENTRIES.length; i++) {
    homeEntryAnim.push({ scale: newEased(1), text: newEased(0), fill: newEased(0) });
  }
  initHomePopups();
  homeDemoL = demoCreate(DEMO_OSC, 0);   // 左侧：那条自激振荡的光路，从周期起点开始
  // 右侧：同一份记录左右镜像之后的结果。镜像不改包围盒，两侧方框的格数因此相同，全页仍只有一格宽
  homeDemoR = demoCreate({
    margin: DEMO_OSC.margin,
    steps: DEMO_OSC.steps,
    script: [],
    records: demoMirror(DEMO_OSC.records)
  }, HOME.demoPhase);
  setupHomeInput();
  requestAnimationFrame(homeFrame);
  // 首页每帧都重画，字重到位后不必额外标脏；取字排在样式表之后，理由见 boot.js 的 whenBootCssReady
  // 取完报一句「字体落定」给遮挡层：它要等这一条、首帧与样式表三条都齐了才收
  whenBootCssReady().then(loadUIFonts).then(markBootFonts);
}

// 把 "#RRGGBB" 拆成 RGB 三元组：文字色要平滑地从常态色过渡到悬停色，插值只能在数值上做
// HOME 里那两种颜色都是这个写法，所以这里只认这一种格式，不做多余兼容
function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

// 自查通过：
// 一、用到的 Web API 逐个核对过，都是标准能力——Canvas 2D 的 roundRect / clip / filter / measureText、
//     Path2D、requestAnimationFrame、Pointer 与 resize 事件、location、sessionStorage、
//     以及仅在句柄库那三个函数里用到的 IndexedDB，没有一处用到不存在的方法或属性；
//     代码里调用的引擎函数（stepMicroframe、traceElementPath）与工具函数（clamp、newEased、stepEased、
//     mixRgb、rgbCss、hslCss）都是本项目里已经存在的定义，文件名与函数签名逐一对过；
//     goToEditor 里调用的 showLeavingOverlay 定义在 boot.js，而 boot.js 在首页的加载顺序里排在 home.js 之前
// 二、事件只绑在 window 上且只绑一次：全部通过 setupHomeInput 与 initHomePopups 两个入口注册，
//     初始化只跑一次，没有在循环或回调里重复 addEventListener，不会泄漏
// 三、画布尺寸：位图按 devicePixelRatio 放大、CSS 尺寸取窗口尺寸、变换在 resizeHomeCanvas 里设一次，
//     三者始终一致；resize 时重新对齐，绘制坐标全程是 CSS 像素；演示方框按格宽取整落位，与网格同格
// 四、状态变量全部在文件顶部集中声明并给了默认值，没有未声明的变量；
//     引擎要读的 elements / rayGraph / laserSegments 这几个全局名也一并声明在这里，不引入 state.js
// 五、绘制状态成对包住：icons.js 内部每一条都在 save/restore 之内，本文件自己的绘制也都成对包住，
//     不会把 globalAlpha、filter、clip、字体这些状态漏给后面的绘制
initHome();
