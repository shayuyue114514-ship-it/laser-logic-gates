// state.js：全部状态变量的集中声明处，含类型与默认值。
"use strict";

/* ========== 状态变量（集中声明，含类型与默认值） ========== */

let canvas = null;        // HTMLCanvasElement：画布
let ctx = null;           // CanvasRenderingContext2D：2D 上下文
let elemLayer = null;     // SVGSVGElement：元件层
let clipRect = null;      // SVGRectElement：元件层的裁剪矩形，跟随视口

const elements = [];      // Array<Element>：已放置的元件。每项字段见 placeElement 里的构造：id 内部编号（只用于历史差分）、wx/wy 格心世界坐标、dir 朝向索引（0 上 1 右 2 下 3 左）、angle/angleTarget 旋转动画角度、typeId 元件类型、deleting/deleteP 删除动画状态、on 光源开关、fillCss/strokeCss/strokeW 配色缓存（配 litK/litK2 两个进度键，键没变就不重算）、selected 是否选中（选中即离地、退出电路）、litK/litK2 上次算配色时的选中与亮起进度、litIn 本微帧是否被照亮、litP/selP 亮起与选中的缓动标量、selBase 拉框按下时的选中快照、orbitU0/orbitV0/orbitAngle0/orbitShiftU/orbitShiftV 公转动画状态、mvOffU/mvOffV 拖动视觉偏移、out 本微帧要发射的方向位掩码。元件不再挂 SVG 节点，一律由 renderElements 直接画到画布上

/* 阻挡图：把「谁挡谁」从坐标问题变成下标问题，结算时读表即可，不必每微帧扫坐标 */
// 只在元件增删或朝向定下来之后重建（由 dirty 标记），其余时候一直复用
const rayGraph = {
  dirty: true,   // boolean：是否需要重建；元件增删、朝向改变时置 true，重建后归 false
  rows: null,    // Map<number, Array<number>>：key 为 wy，value 是该行存活元件在 elements 中的下标，按 wx 升序
  cols: null,    // Map<number, Array<number>>：key 为 wx，value 是该列存活元件在 elements 中的下标，按 wy 升序
  endR: null,    // Array<number>：每个元件向右第一个阻挡者的行位置；右边没人挡则记行数组长度，表示延伸到视口外
  endL: null,    // Array<number>：向左第一个阻挡者的行位置；左边没人挡记 -1
  endD: null,    // Array<number>：向下（视觉向下，即 wy 减小）第一个阻挡者的列位置；下边没人挡记 -1
  endU: null     // Array<number>：向上（wy 增大）第一个阻挡者的列位置；上边没人挡则记列数组长度，表示延伸到视口外
};

/* 接收掩码：每微帧算一次，记录激光从哪几侧到达每个元件 */
// 位序与朝向索引一致：0 上、1 右、2 下、3 左，于是 1 << dir 正好就是「朝 dir 发射」这一位
const SIDE_UP = 1;      // number：上侧位
const SIDE_RIGHT = 2;   // number：右侧位
const SIDE_DOWN = 4;    // number：下侧位
const SIDE_LEFT = 8;    // number：左侧位
let recvMask = [];      // Array<number>：以 elements 下标为索引的四位掩码，某位为 1 表示该侧有发射者的激光射到它
let laserSegments = []; // Array<{horizontal:boolean, key:number, a:number, b:number}>：本微帧激光场取并集后的线段，a/b 可能是 ±Infinity
let microframe = 0;     // number：全局微帧计数 t，整数，从 0 起只增不减；元件的接收与输出时刻都以它为准
let microAcc = 0;       // number：固定步长累加器（秒），攒够当前微帧时长就结算一个微帧，余数留到下一帧
let lastEmit = null;    // Array<number>|null：上一微帧的发射掩码，用来判断本微帧是否需要重算；阻挡图重建后置 null

let sceneDirty = true;    // boolean：场景是否有非连续变化（尺寸、配色、选中槽、激光场）需要强制重绘一次
let prevSettled = false;  // boolean：上一帧是否完全静止；动画收尾那一帧它还是 false，保证最终状态一定被画出来
let gridTile = null;      // HTMLCanvasElement：网格瓷砖，一格大小的小位图，只在缩放变化时重画一次
let gridTileCtx = null;   // CanvasRenderingContext2D：瓷砖的上下文，与瓷砖一起按需重建
let gridTileKey = "";     // string：瓷砖对应的物理像素边长与像素比指纹，指纹一致就直接复用同一张
let gridPattern = null;   // CanvasPattern：由瓷砖生成的重复图案，配合坐标系平移缩放铺满视口，一帧只填一次

let laserGlowCache = null;    // HTMLCanvasElement：激光辉光的低分辨率离屏位图，每帧在上面描完一次整张贴回主画布
let laserGlowCacheCtx = null; // CanvasRenderingContext2D：它的上下文，与位图一起按画布尺寸重建
let lampGlowCache = null;     // HTMLCanvasElement：灯的预模糊光晕纹理，整帧只生成一次、逐个灯贴图复用
let lampGlowCacheCtx = null;  // CanvasRenderingContext2D：它的上下文，与纹理一起在参数变化时重建
let lampGlowCacheKey = "";    // string：纹理对应的缩放与像素比指纹，指纹一致就直接复用同一张
let lampGlowCacheSize = 0;    // number：纹理贴回画布时的 CSS 边长，由位图像素数除以像素比反推，保证一比一不缩放

/* 性能读数：只供调试面板显示，不参与任何逻辑，也不影响画面 */
let perfDom = null;          // {fps,interval,script,total,drawn,culled,scale}：读数那几处的 DOM 引用，初始化前为 null
let perfLastTs = 0;          // number：上一帧的 rAF 时间戳（毫秒），用来算帧间隔；0 表示还没收到过帧
let perfFps = 0;             // number：最近一个统计窗口算出的帧率（帧/秒）
let perfIntervalMs = 0;      // number：最近一个统计窗口算出的平均帧间隔（毫秒）
let perfScriptMs = 0;        // number：最近一个统计窗口算出的平均脚本耗时（毫秒），即每帧 JS 占用的时间
let perfWinMs = 0;           // number：当前窗口已累计的帧间隔之和（毫秒）
let perfWinFrames = 0;       // number：当前窗口已统计的帧数
let perfWinScriptMs = 0;     // number：当前窗口已累计的脚本耗时之和（毫秒）
let drawnElementCount = 0;   // number：最近一次渲染真正提交到 SVG 的元件数（视口剔除之后剩下的）
let culledElementCount = 0;  // number：最近一次渲染被视口剔除跳过的元件数

let paletteUI = null;     // {fill,stroke,panel,slot,gearFill,gearStroke,setFill,setStroke}：调色器面板的 DOM 引用，没初始化前为 null

let ghostNode = null;     // SVGPathElement：虚影节点，路径取当前选中的元件类型
let ghostWX = 0;          // number：虚影当前世界坐标 X（平滑值）
let ghostWY = 0;          // number：虚影当前世界坐标 Y（平滑值）
let ghostTWX = 0;         // number：虚影目标格心的世界坐标 X
let ghostTWY = 0;         // number：虚影目标格心的世界坐标 Y
let ghostVisible = false; // boolean：虚影当前是否应该显示（指针在视口内且所在格可放置）
let ghostAlpha = 0;       // number：虚影淡入淡出的当前系数，0 为完全不可见、1 为完全可见
let ghostRejectActive = false; // boolean：虚影是否正在走「进入不可放置格」的边移动边消失动画
let ghostRejectP = 0;          // number：该动画的进度，0→1 线性推进
let ghostRejectStartAlpha = 0; // number：动画开始瞬间的淡入系数，作为乘数保证透明度不跳变
let ghostRejectFromWX = 0;     // number：动画起点的世界坐标 X，即进入不可放置格那一刻虚影所在位置
let ghostRejectFromWY = 0;     // number：动画起点的世界坐标 Y
let ghostRejectToWX = 0;       // number：动画终点的世界坐标 X，即不可放置格的格心
let ghostRejectToWY = 0;       // number：动画终点的世界坐标 Y
let ghostAngle = 0;       // number：虚影当前朝向的角度（度），动画期间是连续值，不一定是 90 的整数倍
let ghostAngleTarget = 0; // number：虚影朝向的目标角度（度），WASD 拨到对应朝向；连续累积，不提前归一化
let pointerSX = 0;        // number：指针在画布上的最后屏幕 X（CSS px）
let pointerSY = 0;        // number：指针在画布上的最后屏幕 Y
let pointerInside = false; // boolean：指针是否停留在画布内
let slotHoverIndex = -1;  // number：指针当前悬停的选项槽序号，-1 表示没悬停在任何槽上
let slotPressedIndex = -1; // number：指针正按住的选项槽序号，-1 表示没按住任何槽
let slotSelectedIndex = ELEMENT_SLOT_BASE + 1; // number：当前选中的槽序号，默认第一个元件槽的下一格（透射器），手上的虚影即该类型
const slotAnim = [];      // Array<Object>：每个槽一个缓动标量（newEased 建的），值即该槽当前的缩放比例
let slotHoverTime = 0;    // number：指针在当前槽上已停留的秒数；换槽或移出立即归零，简介的延迟按它算
let tipIndex = -1;        // number：简介浮层当前显示的槽序号，-1 表示没有浮层
let marqueePressing = false; // boolean：左键已在画布上按下，但还没判定是单击还是拉框
let marqueeActive = false;   // boolean：指针已移过阈值，正在拉框
let marqueePointerId = -1;   // number：拉框所用的指针 id，-1 表示当前没有拉框；move/up 只认它自己的 id
let marqueeStartSX = 0;      // number：拉框起点屏幕 X，按下那一刻的位置，拉框期间不变
let marqueeStartSY = 0;      // number：拉框起点屏幕 Y
let marqueeEndSX = 0;        // number：拉框终点屏幕 X，跟着指针走
let marqueeEndSY = 0;        // number：拉框终点屏幕 Y
// 修饰键自己维护的按下状态：按键事件里带的 metaKey / ctrlKey 在有些时刻不可信
// 比如窗口刚拿回焦点、或 Cmd 与字母几乎同时落下时，那一下 keydown 里的标志可能是旧的 false，
// 于是 Cmd+S 被当成普通的 s 丢掉；所以另记一份，判快捷键时与事件里的标志认一个即可
let metaHeld = false;        // boolean：Cmd（Mac）/ Win 键此刻是否按着，由它自己的按下与抬起事件维护
let ctrlHeld = false;        // boolean：Ctrl 键此刻是否按着
let saveKeyDone = false;     // boolean：这一轮 Cmd+S 是否已经在「按下」那一步处理过，用来防止抬起时再存一次
let moveDragging = false;    // boolean：左键按在已选中的元件上，正在拖动这批元件
let movePointerId = -1;      // number：拖动所用的指针 id，-1 表示当前没有拖动；move/up 只认它自己的 id
let moveStartWX = 0;         // number：按下那一刻指针所在的世界坐标 X，拖动全程以它为基准算位移
let moveStartWY = 0;         // number：按下那一刻指针所在的世界坐标 Y
let moveDGX = 0;             // number：当前已经加在元件上的整数格位移（X 方向），用来只补差值、避免重复累加
let moveDGY = 0;             // number：当前已经加在元件上的整数格位移（Y 方向）
const moveGroup = [];        // Array<Object>：本次拖动带着走的元件；按下时确定，拖动期间不变
let orbitActive = false;     // boolean：整批元件正在绕轴心公转，动画期间只改画面不改数据
let orbitP = 0;              // number：公转进度 0→1，走满即落位
let orbitTurns = 0;          // number：本次公转的 90° 步数，正数顺时针、负数逆时针
let orbitPivotU = 0;         // number：公转轴心的格号 u（取选区几何中心，可能是半格；落位时统一吸附回格心）
let orbitPivotV = 0;         // number：公转轴心的格号 v
let selOrientDir = 0;        // number：选区整体的朝向索引（0 上、1 右、2 下、3 左）：WASD 转的就是它，新选区一律归零朝上
let rotPivotU = 0;           // number：整批旋转的轴心格号 u（取选区几何中心，可能是半格；落位时统一吸附回格心）
let rotPivotV = 0;           // number：整批旋转的轴心格号 v
const tipAnim = newEased(0); // Object：简介浮层的显隐进度标量，0 全隐、1 全显，走缓入缓出曲线
const tipDom = document.getElementById("slotTip");         // HTMLElement：简介浮层容器，独立于 Canvas，压在元件层之上
const tipDomName = document.getElementById("slotTipName"); // HTMLElement：浮层里的元件名称
const tipDomDesc = document.getElementById("slotTipDesc"); // HTMLElement：浮层里的元件说明
let tipDomIndex = -1;     // number：浮层里已写入的槽序号，-1 表示内容为空；序号没变就不重复写文本

// 设置按钮自身的状态：悬停与按下都交给槽那套下标逻辑管，这里只剩「开着还是关着」以及它驱动的提亮
let settingsOpen = false;     // boolean：设置是否处于打开状态，默认关着；目前只驱动按钮发亮，还没有要打开的界面
const settingsLitAnim = newEased(0);   // Object：设置按钮的提亮进度标量，0 常态、1 全亮；跟随设置的开合状态
const settingsPanelDom = document.getElementById("settingsPanel"); // HTMLElement：设置弹窗容器，独立于 Canvas 的 DOM 层
const sidebarDom = document.getElementById("sidebar");             // HTMLElement：左侧工作区竖栏，宽度与配色由脚本注入
const sidebarTreeDom = document.getElementById("sidebarTree");     // HTMLElement：竖栏里的存档列表容器，行由 sidebar.js 生成
const sidebarTipDom = document.getElementById("sidebarTip");       // HTMLElement：列表里悬停时那个写全名的小窗，固定在窗口坐标上
let sidebarTipRow = null;     // HTMLElement|null：小窗当前是在哪一行上冒出来的；同一行内挪动就不必重摆一次
let sidebarTipTimer = null;   // Object|null：延时显示小窗的定时器标识；null 表示没有正在等的定时器
let sidebarTipMX = 0;         // number：指针最后落在列表上的横坐标（窗口坐标），小窗按它贴着指针摆
let sidebarTipMY = 0;         // number：指针最后落在列表上的纵坐标（窗口坐标）
const filePanelDom = document.getElementById("filePanel");         // HTMLElement：文件弹窗容器，与设置弹窗同款外观
const fileLitAnim = newEased(0);   // Object：文件按钮的提亮进度标量，0 常态、1 全亮；跟随文件弹窗的开合状态
let filePanelOpen = false;    // boolean：文件弹窗是否打开；两个弹窗互斥，同时只开一个，避免两块底板叠在一起
const tutorialLitAnim = newEased(0);   // Object：教程按钮的提亮进度标量，0 常态、1 全亮；跟随教程的开合状态
let tutorialOpen = false;     // boolean：教程是否处于打开状态，默认关着；打开时屏幕正中弹出教程窗口
const tutorialPanelDom = document.getElementById("tutorialPanel");         // HTMLElement：教程弹窗容器，独立于 Canvas 的 DOM 层
const btnTutorialCancelDom = document.getElementById("btnTutorialCancel"); // HTMLElement：教程弹窗左上角的取消按钮
const tutorialDocDom = document.getElementById("tutorialDoc");             // HTMLElement：教程弹窗里的内容区，以后教程文字就写进这里
const tutorialModalAnim = newEased(0); // Object：教程弹窗的显隐进度标量，0 全隐、1 全显；时长与按钮提亮同一档，两者同步进退
// 确认弹窗：换文件夹这种会把手上的改动丢掉的操作，先弹它问一句，点了头才往下走
// 它不由按钮驱动，而是由「等在后面的那段流程」临时叫起来，所以没有对应的提亮标量，只有一个显隐标量
const confirmPanelDom = document.getElementById("confirmPanel");             // HTMLElement：确认弹窗容器
const confirmTextDom = document.getElementById("confirmText");               // HTMLElement：确认弹窗里那句问话，文案由调用处按场合传入
const btnConfirmOkDom = document.getElementById("btnConfirmOk");             // HTMLElement：右边那个确认按钮（点它表示同意丢弃）
const btnConfirmCancelDom = document.getElementById("btnConfirmCancel");     // HTMLElement：左边那个取消按钮
const confirmModalAnim = newEased(0); // Object：确认弹窗的显隐进度标量，0 全隐、1 全显；与教程弹窗同一档时长
let confirmOpen = false;      // boolean：确认弹窗当前是否开着，由 askConfirm / settleConfirm 成对改写
let confirmResolve = null;    // Function|null：等在弹窗背后的那段流程留下来的作答入口；null 表示没人在等
const fileNameDom = document.getElementById("fileName");           // HTMLElement：文件弹窗里显示当前存档名字的那行文字
const btnOpenDom = document.getElementById("btnOpen");             // HTMLElement：文件弹窗里的「打开」按钮
const btnSaveDom = document.getElementById("btnSave");             // HTMLElement：文件弹窗里的「保存」按钮
const btnSaveAsDom = document.getElementById("btnSaveAs");             // HTMLElement：文件弹窗里的「另存为」按钮
const btnImportSelDom = document.getElementById("btnImportSel");       // HTMLElement：文件弹窗里的「以选区导入」按钮
const btnExportSelDom = document.getElementById("btnExportSel");       // HTMLElement：文件弹窗里的「以选区导出」按钮
const SAVE_EXT = ".lccas";    // string：存档文件的后缀名；只有这一处写死，改名时改这里
// 存档的文件类型声明：保存框与打开框共用一份，两边的扩展名写法才不会各写各的
const SAVE_FILE_TYPES = [{ description: "激光逻辑门存档", accept: { "application/json": [SAVE_EXT] } }]; // Array：交给系统文件框的类型过滤表
let currentFileName = "";     // string：当前存档的文件名（不含路径），空串表示还没存过，显示时用占位名代替
let currentFileHandle = null; // FileSystemFileHandle | null：当前存档的文件句柄，null 表示还没绑定过文件
let docDirty = false;         // boolean：当前电路有未保存的改动；为真时列表上那一条的名字前面亮一个圆点
let openFileNode = null;      // Object|null：当前打开的那条存档在列表里的节点；从系统文件框打开时为 null，列表上没有行可标
// 上次用过的文件句柄：只用来给系统选择器定「从哪个目录起步」，与「当前绑定哪个文件」是两件事
// 系统选择器默认每次都从文稿目录开，把句柄存进 IndexedDB 后跨会话也能读回，下次就从它所在目录打开
const FS_DB_NAME = "laser-gate-files"; // string：存放文件句柄的小数据库名
const FS_STORE_NAME = "handles";       // string：对象仓库名
const FS_HANDLE_KEY = "last";          // string：上次用过的文件句柄在库里的键名
let lastPickerHandle = null;           // FileSystemFileHandle | null：上次用过的文件句柄；启动时异步读回，读不到就是 null
// 本地文件读写能力：保存对话框与打开对话框是同一批方法，任一存在就说明整条路线可用
// 只在初始化时检测一次写死：这个能力在页面存活期间不会变，不必每帧重算
const canUseLocalFile = "showSaveFilePicker" in window; // boolean：浏览器是否支持直接读写本地文件
// 系统剪贴板写入能力：粘贴不走这个接口（它要授权且本地文件下不可靠），只有复制用它
const canUseClipboard = !!(navigator.clipboard && navigator.clipboard.writeText); // boolean：浏览器是否支持直接写剪贴板
const gridSwitchDom = document.getElementById("gridSwitch");       // HTMLElement：设置弹窗里「渲染网格」开关的滑轨
let gridRenderOn = true;      // boolean：是否绘制网格线，默认开；关掉只隐藏网格线，视口底色与边框照旧
const advSwitchDom = document.getElementById("advSwitch");          // HTMLElement：设置弹窗里「高级渲染」开关的滑轨
let advancedRenderOn = true;  // boolean：是否启用高级渲染，默认开；目前只控制激光外围的辉光，关掉只剩光芯
const speedSliderDom = document.getElementById("speedSlider");     // HTMLElement：设置弹窗里「运行速度」滑块
const speedValueDom = document.getElementById("speedValue");       // HTMLElement：速度数值显示，在滑块右边
let microDt = CONFIG.microframeDt;  // number：当前每个微帧对应的真实时长（秒），0 表示不设延迟；由速度滑块改写

/* 撤销/重做：只记「已落定的电路」的差分，悬空中的那批不进历史 */
// 每步存一组差分，一条差分描述一个元件的新增、消失或字段变化；不存整份电路，所以步数与电路大小无关
let historyStack = [];     // Array<Array<Object>>：历史里每一步的差分清单
let historyIndex = -1;     // number：当前走到历史里的哪一步，-1 表示还停在起点、没有可撤销的步
let committedTable = new Map(); // Map<number, {rec:Object, el:Object}>：上一次落定时已落定电路的样子，按元件内部编号存
let nextElementId = 1;     // number：元件内部编号的发号器；编号只在本程序内用来认人，不写进存档
const HISTORY_LIMIT = 100; // number：最多保留多少步，超出丢掉最老的，避免长时间编辑把内存撑大

const state = {
  cssW: 0,                // number：画布 CSS 宽度
  cssH: 0,                // number：画布 CSS 高度
  anchorWX: CONFIG.defaultAnchorWX, // number：参考点的世界坐标 X
  anchorWY: CONFIG.defaultAnchorWY, // number：参考点的世界坐标 Y
  anchorSX: 0,            // number：参考点当前的屏幕 X（平滑值，平移时变化）
  anchorSY: 0,            // number：参考点当前的屏幕 Y
  tAnchorSX: 0,           // number：参考点屏幕 X 的目标值
  tAnchorSY: 0,           // number：参考点屏幕 Y 的目标值
  scale: CONFIG.defaultScale, // number：当前缩放（世界单位 → CSS px）
  logScale: Math.log(CONFIG.defaultScale),  // number：当前缩放的对数（对数插值更自然）
  tLogScale: Math.log(CONFIG.defaultScale), // number：缩放目标值的对数
  isPanning: false,       // boolean：是否正在中键拖拽
  panPointerId: null,     // number|null：正在拖拽的指针 id
  panLastX: 0,            // number：上一次 pointermove 的屏幕 X，用来自己算位移
  panLastY: 0,            // number：上一次 pointermove 的屏幕 Y
  lastTs: 0               // number：上一帧时间戳（毫秒），用于计算 dt
};

