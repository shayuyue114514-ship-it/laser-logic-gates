// state.js：全部状态变量的集中声明处，含类型与默认值。
"use strict";

/* ========== 状态变量（集中声明，含类型与默认值） ========== */



// 格子索引：格号 → 该格上的元件数组。一格最多一个元件是模型硬约束，但选区悬空期间允许暂时叠在别人的格上，
// 所以存数组而不是单个元件；绝大多数格子只有一项。有了它，按格查元件是一步直达，不必每次扫全表
// 活跃元件：本帧还需要推进动画、或需要单独画在最上层（选中、删除中、亮着、有标签）的那些元件。
// 每帧只重建一次，之后十几趟循环都只走这一张小表，开销与元件总数脱钩

/* 阻挡图：把「谁挡谁」从坐标问题变成下标问题，结算时读表即可，不必每微帧扫坐标 */
// 只在元件增删或朝向定下来之后重建（由 dirty 标记），其余时候一直复用

/* 接收掩码：每微帧算一次，记录激光从哪几侧到达每个元件 */
// 位序与朝向索引一致：0 上、1 右、2 下、3 左，于是 1 << dir 正好就是「朝 dir 发射」这一位



/* 性能读数：只供调试面板显示，不参与任何逻辑，也不影响画面 */

// 元件缓存层：把「冷淡状态」的元件（不亮、不选、不在动画里）整批画进一张离屏位图，之后每帧只贴图
// 亮的、选中的、正在动的那几个不进缓存，每帧单独盖在最上面，所以点亮不会让整张缓存作废
// 下面六项记下建图那一刻的相机与位图原点：贴图时按「当时的相机 → 现在的相机」算一次仿射变换，
// 缩放与平移都由这次变换承担，于是缩放途中不必每帧重画四万多个元件


// 修饰键自己维护的按下状态：按键事件里带的 metaKey / ctrlKey 在有些时刻不可信
// 比如窗口刚拿回焦点、或 Cmd 与字母几乎同时落下时，那一下 keydown 里的标志可能是旧的 false，
// 于是 Cmd+S 被当成普通的 s 丢掉；所以另记一份，判快捷键时与事件里的标志认一个即可
// 浮动文本另放一组：它不吸附网格，位移要按连续量走，不能与元件共用那个取整的位移
/* 浮动文本：摆在画布上的自由文字，与元件、与激光都没有关系，也不吸附网格
   每项字段：id 内部编号（只用于历史差分）、wx/wy 左上角的世界坐标、text 文字（可多行）
   为什么锚在左上角而不是中心：它是一段可以多行的说明，左上角对齐才和「从这一点往右往下排」的直觉一致 */

/* 元件标签的拖动：与拖动选区、拉框并列的第三种指针操作，三者各认各的指针 id，互不干扰 */
/* 浮动文本的拖动：与拖标签并列的第四种指针操作，各认各的指针 id */
/* 浮动文本的原地输入：一块真实的输入框铺在那块文字所在的屏幕上，字形仍由画布画，输入框自己的字是透明的 */
// 这样输入法、选中、方向键、鼠标点选全是浏览器原生行为，而染色在打字过程中实时可见
/* 元件标签的输入框：双击元件或标签时弹出的那个小弹窗，改的是一段单行文字 */

// 设置按钮自身的状态：悬停与按下都交给槽那套下标逻辑管，这里只剩「开着还是关着」以及它驱动的提亮
/* 列表的右键菜单与新建条目：菜单位置按指针摆，同一时刻最多有一轮新建在进行 */
// 确认弹窗：换文件夹这种会把手上的改动丢掉的操作，先弹它问一句，点了头才往下走
// 它不由按钮驱动，而是由「等在后面的那段流程」临时叫起来，所以没有对应的提亮标量，只有一个显隐标量
// 存档文件的后缀名、文件类型声明、句柄记忆与本地文件能力都已搬到 handle-store.js：
// 那几样编辑器与首页共用，首页不加载本文件，所以不能留在这里
// number：改动序号，每次画面改动加一。保存时记下写出去的那份对应到第几次改动，
// 写完之后用它判断「期间有没有又改过」，决定未保存的标记能不能就此灭掉
// 系统剪贴板写入能力：粘贴不走这个接口（它要授权且本地文件下不可靠），只有复制用它
// 逐层开关：只供排查帧率用，正常游玩四项全为 false，控制台通过 perfLayers.set 打开某一项
// 拆成四项的原因：脚本耗时探针看不到画布光栅化的开销，只能逐层关掉、看帧率跳到多少来定位
// 渲染精度：滑块上的读数本身（5~20），画布像素比上限 = 精度 / 5，于是 5 对应 1 倍、10 对应 2 倍、20 对应 4 倍
// 缩放刷新速度：缓存位图被放大到多少倍就当场重画一次；相机停稳时不受它限制，总是重画

/* 撤销/重做：只记「已落定的电路」的差分，悬空中的那批不进历史 */
// 每步存一组差分，一条差分描述一个元件的新增、消失或字段变化；不存整份电路，所以步数与电路大小无关
// 浮动文本的对照表：结构与上面那张一样，只是记的是 texts 里那几块文字
// 两张表分开：元件与文字是两类东西，各自的编号空间也各自独立，混在一张表里会串号

/* ========== 共享状态容器 ==========
  下面这一份是编辑器与引擎共用的全部可变状态。原先它们是散落在全局的 240 个变量，
   任何两个文件重名都会静默覆盖，改动时也看不出谁在用它。收进一个对象后只有 S 这一个名字，
   谁读写哪些字段在 S.xxx 上一目了然。 */
const S = {
  canvas: null,  // HTMLCanvasElement：画布
  ctx: null,  // CanvasRenderingContext2D：2D 上下文
  elemLayer: null,  // SVGSVGElement：元件层
  clipRect: null,  // SVGRectElement：元件层的裁剪矩形，跟随视口
  elements: [],  // Array<Element>：已放置的元件。每项字段见 placeElement 里的构造：id 内部编号（只用于历史差分）、wx/wy 格心世界坐标、dir 朝向索引（0 上 1 右 2 下 3 左）、angle/angleTarget 旋转动画角度、typeId 元件类型、deleting/deleteP 删除动画状态、gone 删除动画已走完等着被摘掉、idx 在元件表里的下标（结算层按它存发射与接收掩码，增删后由阻挡图重建刷新）、inOut 是否登记在「正在发射的门」那张小表里、on 光源开关、fillCss/strokeCss/strokeW 配色缓存（配 litK/litK2 两个进度键，键没变就不重算）、selected 是否选中（选中即离地、退出电路）、litK/litK2 上次算配色时的选中与亮起进度、litIn 本微帧是否被照亮、litP/selP 亮起与选中的缓动标量、selBase 拉框按下时的选中快照、orbitU0/orbitV0/orbitAngle0/orbitShiftU/orbitShiftV 公转动画状态、mvOffU/mvOffV 拖动视觉偏移、out 本微帧要发射的方向位掩码、labelText/labelAngle 元件标签的文字与它绕元件的方位（标签挂在元件上，跟着元件走，不存在放丢这回事）。元件不再挂 SVG 节点，一律由 renderElements 直接画到画布上
  cellIndex: new Map(),
  activeEls: [],
  rayGraph: {
    dirty: true,   // boolean：是否需要重建；元件增删、朝向改变时置 true，重建后归 false
    rows: null,    // Map<number, Array<number>>：key 为 wy，value 是该行存活元件在 elements 中的下标，按 wx 升序
    cols: null,    // Map<number, Array<number>>：key 为 wx，value 是该列存活元件在 elements 中的下标，按 wy 升序
    endR: null,    // Array<number>：每个元件向右第一个阻挡者的行位置；右边没人挡则记行数组长度，表示延伸到视口外
    endL: null,    // Array<number>：向左第一个阻挡者的行位置；左边没人挡记 -1
    endD: null,    // Array<number>：向下（视觉向下，即 wy 减小）第一个阻挡者的列位置；下边没人挡记 -1
    endU: null     // Array<number>：向上（wy 增大）第一个阻挡者的列位置；上边没人挡则记列数组长度，表示延伸到视口外
  },
  SIDE_UP: 1,  // number：上侧位
  SIDE_RIGHT: 2,  // number：右侧位
  SIDE_DOWN: 4,  // number：下侧位
  SIDE_LEFT: 8,  // number：左侧位
  recvMask: new Uint8Array(0),  // Uint8Array：以 elements 下标为索引的四位掩码，某位为 1 表示该侧有发射者的激光射到它
  laserSegments: [],  // Array<{horizontal:boolean, key:number, a:number, b:number}>：本微帧激光场取并集后的线段，a/b 可能是 ±Infinity
  microframe: 0,  // number：全局微帧计数 t，整数，从 0 起只增不减；元件的接收与输出时刻都以它为准
  microAcc: 0,  // number：固定步长累加器（秒），攒够当前微帧时长就结算一个微帧，余数留到下一帧
  pendingCompact: false,  // boolean：有元件的删除动画走完、等着被摘出元件表；帧末统一压实一次，避免逐个 splice
  sceneDirty: true,  // boolean：场景是否有非连续变化（尺寸、配色、选中槽、激光场）需要强制重绘一次
  prevSettled: false,  // boolean：上一帧是否完全静止；动画收尾那一帧它还是 false，保证最终状态一定被画出来
  gridTile: null,  // HTMLCanvasElement：网格瓷砖，一格大小的小位图，只在缩放变化时重画一次
  gridTileCtx: null,  // CanvasRenderingContext2D：瓷砖的上下文，与瓷砖一起按需重建
  gridTileKey: "",  // string：瓷砖对应的物理像素边长与像素比指纹，指纹一致就直接复用同一张
  gridPattern: null,  // CanvasPattern：由瓷砖生成的重复图案，配合坐标系平移缩放铺满视口，一帧只填一次
  laserGlowCache: null,  // HTMLCanvasElement：激光辉光的低分辨率离屏位图，每帧在上面描完一次整张贴回主画布
  laserGlowCacheCtx: null,  // CanvasRenderingContext2D：它的上下文，与位图一起按画布尺寸重建
  lampGlowLayer: null,  // HTMLCanvasElement|null：灯光晕的降采样离屏位图，每帧把各灯的光晕合成在上面再整块贴回
  lampGlowLayerCtx: null,  // CanvasRenderingContext2D|null：它的上下文，与位图一起按画布尺寸重建
  lampGlowList: [],  // Array<number>：本帧要贴光晕的灯的屏幕横坐标、纵坐标、亮度，三个一组复用，避免每帧新建数组
  lampGlowPrevX0: 0,  // number：上一帧在离屏位图上用到的那块矩形（CSS px），只清它与这一帧要用的并集
  lampGlowPrevY0: 0,  // number：上一帧用到的那块矩形上边界
  lampGlowPrevX1: 0,  // number：上一帧用到的那块矩形右边界
  lampGlowPrevY1: 0,  // number：上一帧用到的那块矩形下边界
  lampGlowPrevUsed: false,  // boolean：上一帧是否真的用过离屏位图，没用过就得整张清一次
  lampGlowCache: null,  // HTMLCanvasElement：灯的预模糊光晕纹理，整帧只生成一次、逐个灯贴图复用
  lampGlowCacheCtx: null,  // CanvasRenderingContext2D：它的上下文，与纹理一起在参数变化时重建
  lampGlowCacheKey: "",  // string：纹理对应的缩放与像素比指纹，指纹一致就直接复用同一张
  lampGlowCacheSize: 0,  // number：纹理贴回画布时的 CSS 边长，由位图像素数除以像素比反推，保证一比一不缩放
  perfDom: null,  // {fps,interval,script,total,drawn,culled,scale}：读数那几处的 DOM 引用，初始化前为 null
  perfLastTs: 0,  // number：上一帧的 rAF 时间戳（毫秒），用来算帧间隔；0 表示还没收到过帧
  perfFps: 0,  // number：最近一个统计窗口算出的帧率（帧/秒）
  perfIntervalMs: 0,  // number：最近一个统计窗口算出的平均帧间隔（毫秒）
  perfScriptMs: 0,  // number：最近一个统计窗口算出的平均脚本耗时（毫秒），即每帧 JS 占用的时间
  perfWinMs: 0,  // number：当前窗口已累计的帧间隔之和（毫秒）
  perfWinFrames: 0,  // number：当前窗口已统计的帧数
  perfWinScriptMs: 0,  // number：当前窗口已累计的脚本耗时之和（毫秒）
  drawnElementCount: 0,  // number：最近一次渲染真正提交到 SVG 的元件数（视口剔除之后剩下的）
  elemCacheCanvas: null,  // HTMLCanvasElement|null：缓存位图，比视口四周各大出一圈，尺寸或缩放变了重建
  elemCacheCtx: null,  // CanvasRenderingContext2D|null：它的上下文
  elemCacheScale: 0,  // number：构建时的缩放，缩放一变整张作废
  elemCacheWX: 0,  // number：位图左上角对应的世界横坐标，贴图位置每帧按它现算
  elemCacheWY: 0,  // number：位图左上角对应的世界纵坐标
  elemCacheW: 0,  // number：位图的 CSS 宽
  elemCacheH: 0,  // number：位图的 CSS 高
  elemCacheAnchorSX: 0,  // number：建图时的参考点屏幕 X
  elemCacheAnchorSY: 0,  // number：建图时的参考点屏幕 Y
  elemCacheAnchorWX: 0,  // number：建图时的参考点世界 X
  elemCacheAnchorWY: 0,  // number：建图时的参考点世界 Y
  elemCacheOX: 0,  // number：位图左上角建图时的屏幕 X（已对齐到物理像素）
  elemCacheOY: 0,  // number：位图左上角建图时的屏幕 Y（已对齐到物理像素）
  elemCacheDirty: true,  // boolean：结构或选中集变了，下一帧要整张重画
  elemCacheDrawn: 0,  // number：最近一次重建时画进位图的元件数，供性能读数显示
  elemCacheCulled: 0,  // number：最近一次重建时落在位图之外、被跳过的元件数
  elemCacheCand: [],  // Array<Element>：重建位图时用来收候选元件的复用表，避免每帧新建数组
  elementPathCache: new Map(),  // Map<string, Path2D>：每种元件类型的轮廓，形状与位置缩放无关，建一次就够
  paintBatchMap: new Map(),  // Map<string, Object>：元件批量绘制的桶表，键是「类型+朝向+配色+缩放+透明度」，每批开始时清空
  elemSpriteMap: new Map(),  // Map<string, Object>：冷淡元件的预渲染贴图，键是「类型+朝向+配色+描边宽+缩放」，重建位图时清空
  culledElementCount: 0,  // number：最近一次渲染被视口剔除跳过的元件数
  paletteUI: null,  // {fill,stroke,panel,slot,gearFill,gearStroke,setFill,setStroke}：调色器面板的 DOM 引用，没初始化前为 null
  ghostNode: null,  // SVGPathElement：虚影节点，路径取当前选中的元件类型
  ghostWX: 0,  // number：虚影当前世界坐标 X（平滑值）
  ghostWY: 0,  // number：虚影当前世界坐标 Y（平滑值）
  ghostTWX: 0,  // number：虚影目标格心的世界坐标 X
  ghostTWY: 0,  // number：虚影目标格心的世界坐标 Y
  ghostVisible: false,  // boolean：虚影当前是否应该显示（指针在视口内且所在格可放置）
  ghostAlpha: 0,  // number：虚影淡入淡出的当前系数，0 为完全不可见、1 为完全可见
  ghostRejectActive: false,  // boolean：虚影是否正在走「进入不可放置格」的边移动边消失动画
  ghostRejectP: 0,  // number：该动画的进度，0→1 线性推进
  ghostRejectStartAlpha: 0,  // number：动画开始瞬间的淡入系数，作为乘数保证透明度不跳变
  ghostRejectFromWX: 0,  // number：动画起点的世界坐标 X，即进入不可放置格那一刻虚影所在位置
  ghostRejectFromWY: 0,  // number：动画起点的世界坐标 Y
  ghostRejectToWX: 0,  // number：动画终点的世界坐标 X，即不可放置格的格心
  ghostRejectToWY: 0,  // number：动画终点的世界坐标 Y
  ghostAngle: 0,  // number：虚影当前朝向的角度（度），动画期间是连续值，不一定是 90 的整数倍
  ghostAngleTarget: 0,  // number：虚影朝向的目标角度（度），WASD 拨到对应朝向；连续累积，不提前归一化
  pointerSX: 0,  // number：指针在画布上的最后屏幕 X（CSS px）
  pointerSY: 0,  // number：指针在画布上的最后屏幕 Y
  pointerInside: false,  // boolean：指针是否停留在画布内
  slotHoverIndex: -1,  // number：指针当前悬停的选项槽序号，-1 表示没悬停在任何槽上
  slotPressedIndex: -1,  // number：指针正按住的选项槽序号，-1 表示没按住任何槽
  slotKeyPressIndex: -1,  // number：键盘刚选中的槽序号，-1 表示没有正在播的键盘按下反馈
  slotKeyPressTimer: 0,  // number：键盘按下反馈还要持续多少秒，走完后那个槽自动退回常态缩放
  slotSelectedIndex: ELEMENT_SLOT_BASE + 1,  // number：当前选中的槽序号，默认第一个元件槽的下一格（透射器），手上的虚影即该类型
  slotAnim: [],  // Array<Object>：每个槽一个缓动标量（newEased 建的），值即该槽当前的缩放比例
  slotHoverTime: 0,  // number：指针在当前槽上已停留的秒数；换槽或移出立即归零，简介的延迟按它算
  tipIndex: -1,  // number：简介浮层当前显示的槽序号，-1 表示没有浮层
  marqueePressing: false,  // boolean：左键已在画布上按下，但还没判定是单击还是拉框
  marqueeActive: false,  // boolean：指针已移过阈值，正在拉框
  marqueePointerId: -1,  // number：拉框所用的指针 id，-1 表示当前没有拉框；move/up 只认它自己的 id
  marqueeStartSX: 0,  // number：拉框起点屏幕 X，按下那一刻的位置，拉框期间不变
  marqueeStartSY: 0,  // number：拉框起点屏幕 Y
  marqueeEndSX: 0,  // number：拉框终点屏幕 X，跟着指针走
  marqueeEndSY: 0,  // number：拉框终点屏幕 Y
  metaHeld: false,  // boolean：Cmd（Mac）/ Win 键此刻是否按着，由它自己的按下与抬起事件维护
  ctrlHeld: false,  // boolean：Ctrl 键此刻是否按着
  saveKeyDone: false,  // boolean：这一轮 Cmd+S 是否已经在「按下」那一步处理过，用来防止抬起时再存一次
  moveDragging: false,  // boolean：左键按在已选中的元件上，正在拖动这批元件
  movePointerId: -1,  // number：拖动所用的指针 id，-1 表示当前没有拖动；move/up 只认它自己的 id
  moveStartWX: 0,  // number：按下那一刻指针所在的世界坐标 X，拖动全程以它为基准算位移
  moveStartWY: 0,  // number：按下那一刻指针所在的世界坐标 Y
  moveDGX: 0,  // number：当前已经加在元件上的整数格位移（X 方向），用来只补差值、避免重复累加
  moveDGY: 0,  // number：当前已经加在元件上的整数格位移（Y 方向）
  moveDWX: 0,  // number：当前已经加在浮动文本上的连续位移（X 方向，世界单位）
  moveDWY: 0,  // number：当前已经加在浮动文本上的连续位移（Y 方向）
  moveGroup: [],  // Array<Object>：本次拖动带着走的元件；按下时确定，拖动期间不变
  moveGroupTexts: [],  // Array<Object>：本次拖动带着走的浮动文本；同样按下时确定
  texts: [],  // Array<Object>：画布上的浮动文本
  nextTextId: 1,  // number：浮动文本内部编号的发号器；与元件那套分开，两边各认各的人
  labelDragging: false,  // boolean：左键按在某个标签上，正在绕元件拖它
  labelPointerId: -1,  // number：拖动标签所用的指针 id，-1 表示当前没有在拖标签
  labelDragEl: null,  // Object|null：正在被拖标签的那个元件；标签挂在元件上，认元件就等于认标签
  labelDragActive: false,  // boolean：指针已移过阈值、真的在挪标签；没挪之前只是「按住了」
  labelDragStartSX: 0,  // number：按下标签那一刻的屏幕 X：用来判有没有移过阈值
  labelDragStartSY: 0,  // number：按下标签那一刻的屏幕 Y
  labelDragFromAngle: 0,  // number：按下那一刻的方位角，拖动被系统打断时用它把标签摆回原处
  labelDragFromGap: 0,  // number：按下那一刻「文字外框最近点到格心」的距离，打断时同样用它摆回原处
  textDragging: false,  // boolean：左键按在某块浮动文本上，正在拖它
  textPointerId: -1,  // number：拖动浮动文本所用的指针 id，-1 表示当前没有在拖
  textDragEl: null,  // Object|null：正在被拖的那块浮动文本
  textDragActive: false,  // boolean：指针已移过阈值、真的在挪；没挪之前只是「按住了」
  textDragStartSX: 0,  // number：按下那一刻的屏幕 X，用来判有没有移过阈值
  textDragStartSY: 0,  // number：按下那一刻的屏幕 Y
  textDragStartWX: 0,  // number：按下那一刻指针的世界 X：位移取它与此刻世界坐标之差
  textDragStartWY: 0,  // number：按下那一刻指针的世界 Y
  textDragFromWX: 0,  // number：这块文本原来所在的世界 X，拖动被系统打断时摆回原处
  textDragFromWY: 0,  // number：这块文本原来所在的世界 Y
  textFieldDom: document.getElementById("textField"),  // HTMLTextAreaElement：铺在画布上的那个透明输入框
  textEditing: false,  // boolean：是否正在原地编辑一块浮动文本
  textEditEl: null,  // Object|null：正在编辑的那块文字；新建时它已经进了 texts，只是内容还空着
  textEditIsNew: false,  // boolean：这一轮是不是新建的；取消时新建的直接摘掉，已存在的把内容退回去
  textEditFromText: "",  // string：开始编辑前的内容，取消时用它把这块文字摆回原样
  textEditImeLen: 0,  // number：输入法正在拼的那一段有几个字符，用来在它下面画一条下划线
  labelEditorDom: document.getElementById("labelEditor"),  // HTMLElement：输入框容器，与确认弹窗同一套底板
  labelEditorInputDom: document.getElementById("labelEditorInput"),  // HTMLInputElement：真正打字的那一行
  btnLabelOkDom: document.getElementById("btnLabelOk"),  // HTMLElement：右边那个确定按钮
  btnLabelCancelDom: document.getElementById("btnLabelCancel"),  // HTMLElement：左边那个取消按钮
  labelEditorAnim: newEased(0),  // Object：输入框的显隐进度标量，0 全隐、1 全显；与另外几个弹窗同一档时长
  labelEditorOpen: false,  // boolean：输入框当前是否开着，由 openLabelEditor / closeLabelEditor 成对改写
  labelEditorEl: null,  // Object|null：正在给哪个元件改标签；null 表示没在改
  orbitActive: false,  // boolean：整批元件正在绕轴心公转，动画期间只改画面不改数据
  orbitP: 0,  // number：公转进度 0→1，走满即落位
  orbitTurns: 0,  // number：本次公转的 90° 步数，正数顺时针、负数逆时针
  orbitPivotU: 0,  // number：公转轴心的格号 u（取选区几何中心，可能是半格；落位时统一吸附回格心）
  orbitPivotV: 0,  // number：公转轴心的格号 v
  selOrientDir: 0,  // number：选区整体的朝向索引（0 上、1 右、2 下、3 左）：WASD 转的就是它，新选区一律归零朝上
  rotPivotU: 0,  // number：整批旋转的轴心格号 u（取选区几何中心，可能是半格；落位时统一吸附回格心）
  rotPivotV: 0,  // number：整批旋转的轴心格号 v
  tipAnim: newEased(0),  // Object：简介浮层的显隐进度标量，0 全隐、1 全显，走缓入缓出曲线
  tipDom: document.getElementById("slotTip"),  // HTMLElement：简介浮层容器，独立于 Canvas，压在元件层之上
  tipDomName: document.getElementById("slotTipName"),  // HTMLElement：浮层里的元件名称
  tipDomDesc: document.getElementById("slotTipDesc"),  // HTMLElement：浮层里的元件说明
  tipDomIndex: -1,  // number：浮层里已写入的槽序号，-1 表示内容为空；序号没变就不重复写文本
  settingsOpen: false,  // boolean：设置是否处于打开状态，默认关着；目前只驱动按钮发亮，还没有要打开的界面
  settingsLitAnim: newEased(0),  // Object：设置按钮的提亮进度标量，0 常态、1 全亮；跟随设置的开合状态
  settingsPanelDom: document.getElementById("settingsPanel"),  // HTMLElement：设置弹窗容器，独立于 Canvas 的 DOM 层
  sidebarDom: document.getElementById("sidebar"),  // HTMLElement：左侧工作区竖栏，宽度与配色由脚本注入
  sidebarTreeDom: document.getElementById("sidebarTree"),  // HTMLElement：竖栏里的存档列表容器，行由 sidebar.js 生成
  rightBarDom: document.getElementById("rightBar"),  // HTMLElement：右侧工具栏，位置与配色由脚本注入
  rightBarToolsDom: document.getElementById("rightBarTools"),  // HTMLElement：工具栏里纵向那一列功能图标，图标由脚本插入
  rightBarTipDom: document.getElementById("rightBarTip"),  // HTMLElement：工具栏的悬停名称小窗，位置按所悬停的格子算
  rightToolSelected: -1,  // number：右侧工具栏当前选中的格号，-1 表示一个都没选；只影响外观
  rightToolRunning: true,  // boolean：右侧工具栏第一格（状态槽）当前是不是「运行中」，初始为运行
  rightBarTipTimer: 0,  // number：工具栏名称小窗的延时句柄，0 表示没有排着的显示任务
  sidebarResumeHandle: null,  // FileSystemDirectoryHandle|null：上次的工作区文件夹，还差一次点击才能继续访问时先记在这里，空状态里据此摆出「继续打开」
  sidebarTipDom: document.getElementById("sidebarTip"),  // HTMLElement：列表里悬停时那个写全名的小窗，固定在窗口坐标上
  sidebarTipRow: null,  // HTMLElement|null：小窗当前是在哪一行上冒出来的；同一行内挪动就不必重摆一次
  sidebarTipTimer: null,  // Object|null：延时显示小窗的定时器标识；null 表示没有正在等的定时器
  sidebarTipMX: 0,  // number：指针最后落在列表上的横坐标（窗口坐标），小窗按它贴着指针摆
  sidebarTipMY: 0,  // number：指针最后落在列表上的纵坐标（窗口坐标）
  sidebarMenuDom: document.getElementById("sidebarMenu"),  // HTMLElement：右键菜单容器，里面两条由 sidebar.js 生成
  sidebarMenuOpen: false,  // boolean：菜单当前是不是显示着，默认收起
  sidebarMenuTarget: null,  // Object|null：这一轮右键的目标文件夹节点；null 表示建在工作区根目录
  sidebarMenuNode: null,  // Object|null：这一轮右键压在哪个条目上（文件或文件夹都算）；null 表示没压在条目行上，菜单里不出现「更改文件名」
  sidebarSubmenuDom: document.getElementById("sidebarSubmenu"),  // HTMLElement：右键菜单里「新建文件」右侧引出的那一列，里面写着能存成哪几种文件
  sidebarSubmenuOpen: false,  // boolean：那一列子列表当前是不是显示着，默认收起
  sidebarSubmenuTimer: null,  // Object|null：延时收起子列表的定时器标识；指针从条目挪进子列表时要靠它留住
  sidebarFileItem: null,  // HTMLElement|null：菜单里「新建文件」那一条，指针压在它身上就引出子列表
  sidebarCreateKind: "",  // string：正在新建的类型，"folder" 或 "file"；空串表示没有在新建
  sidebarCreateExt: "",  // string：正在新建的文件用哪种后缀，取值来自 NEW_FILE_EXTS；新建文件夹时是空串
  sidebarCreateParent: null,  // Object|null：正在新建的那一层；null 表示根目录，非 null 是某个文件夹节点
  sidebarNewRow: null,  // Object|null：就地输入那一行，形如 {root, input, hint, baseLen}；提交或取消后归 null
  filePanelDom: document.getElementById("filePanel"),  // HTMLElement：文件弹窗容器，与设置弹窗同款外观
  fileLitAnim: newEased(0),  // Object：文件按钮的提亮进度标量，0 常态、1 全亮；跟随文件弹窗的开合状态
  filePanelOpen: false,  // boolean：文件弹窗是否打开；两个弹窗互斥，同时只开一个，避免两块底板叠在一起
  tutorialLitAnim: newEased(0),  // Object：教程按钮的提亮进度标量，0 常态、1 全亮；跟随教程的开合状态
  tutorialOpen: false,  // boolean：教程是否处于打开状态，默认关着；打开时屏幕正中弹出教程窗口
  tutorialPanelDom: document.getElementById("tutorialPanel"),  // HTMLElement：教程弹窗容器，独立于 Canvas 的 DOM 层
  btnTutorialCancelDom: document.getElementById("btnTutorialCancel"),  // HTMLElement：教程弹窗左上角的取消按钮
  tutorialDocDom: document.getElementById("tutorialDoc"),  // HTMLElement：教程弹窗里的内容区，以后教程文字就写进这里
  tutorialModalAnim: newEased(0),  // Object：教程弹窗的显隐进度标量，0 全隐、1 全显；时长与按钮提亮同一档，两者同步进退
  confirmPanelDom: document.getElementById("confirmPanel"),  // HTMLElement：确认弹窗容器
  confirmTextDom: document.getElementById("confirmText"),  // HTMLElement：确认弹窗里那句问话，文案由调用处按场合传入
  btnConfirmOkDom: document.getElementById("btnConfirmOk"),  // HTMLElement：右边那个确认按钮（点它表示同意丢弃）
  btnConfirmCancelDom: document.getElementById("btnConfirmCancel"),  // HTMLElement：左边那个取消按钮
  confirmModalAnim: newEased(0),  // Object：确认弹窗的显隐进度标量，0 全隐、1 全显；与教程弹窗同一档时长
  confirmOpen: false,  // boolean：确认弹窗当前是否开着，由 askConfirm / settleConfirm 成对改写
  confirmResolve: null,  // Function|null：等在弹窗背后的那段流程留下来的作答入口；null 表示没人在等
  fileNameDom: document.getElementById("fileName"),  // HTMLElement：文件弹窗里显示当前存档名字的那行文字
  btnOpenDom: document.getElementById("btnOpen"),  // HTMLElement：文件弹窗里的「打开」按钮
  btnSaveDom: document.getElementById("btnSave"),  // HTMLElement：文件弹窗里的「保存」按钮
  btnSaveAsDom: document.getElementById("btnSaveAs"),  // HTMLElement：文件弹窗里的「另存为」按钮
  btnImportSelDom: document.getElementById("btnImportSel"),  // HTMLElement：文件弹窗里的「以选区导入」按钮
  btnExportSelDom: document.getElementById("btnExportSel"),  // HTMLElement：文件弹窗里的「以选区导出」按钮
  btnCopyAiDom: document.getElementById("btnCopyAi"),  // HTMLElement：文件弹窗里的「复制给 AI」按钮
  currentFileName: "",  // string：当前存档的文件名（不含路径），空串表示还没存过，显示时用占位名代替
  currentFileHandle: null,  // FileSystemFileHandle | null：当前存档的文件句柄，null 表示还没绑定过文件
  docDirty: false,  // boolean：当前电路有未保存的改动；为真时列表上那一条的名字前面亮一个圆点
  docEditSeq: 0,
  openFileNode: null,  // Object|null：当前打开的那条存档在列表里的节点；从系统文件框打开时为 null，列表上没有行可标
  canUseClipboard: !!(navigator.clipboard && navigator.clipboard.writeText),  // boolean：浏览器是否支持直接写剪贴板
  gridSwitchDom: document.getElementById("gridSwitch"),  // HTMLElement：设置弹窗里「渲染网格」开关的滑轨
  gridRenderOn: true,  // boolean：是否绘制网格线，默认开；关掉只隐藏网格线，视口底色与边框照旧
  advSwitchDom: document.getElementById("advSwitch"),  // HTMLElement：设置弹窗里「高级渲染」开关的滑轨
  advancedRenderOn: true,  // boolean：是否启用高级渲染，默认开；目前只控制激光外围的辉光，关掉只剩光芯
  renderSkip: { elements: false, lampGlow: false, laserGlow: false, laser: false },
  speedSliderDom: document.getElementById("speedSlider"),  // HTMLElement：设置弹窗里「运行速度」滑块
  speedValueDom: document.getElementById("speedValue"),  // HTMLElement：速度数值显示，在滑块右边
  renderPrecisionSliderDom: document.getElementById("renderPrecisionSlider"),  // HTMLElement：设置弹窗里「渲染精度」滑块
  renderPrecisionValueDom: document.getElementById("renderPrecisionValue"),  // HTMLElement：渲染精度数值显示，在滑块右边
  zoomRefreshSliderDom: document.getElementById("zoomRefreshSlider"),  // HTMLElement：设置弹窗里「缩放刷新速度」滑块
  zoomRefreshValueDom: document.getElementById("zoomRefreshValue"),  // HTMLElement：缩放刷新速度数值显示，在滑块右边
  microDt: CONFIG.microframeDt,  // number：当前每个微帧对应的真实时长（秒），0 表示不设延迟；由速度滑块改写
  renderPrecision: CONFIG.renderPrecisionDefault,  // number：当前渲染精度
  renderScaleCap: renderPrecision / CONFIG.renderPrecisionPerX,  // number：画布像素比上限，由精度换算
  zoomRefreshLimit: CONFIG.zoomRefreshDefault,  // number：放大重画的阈值倍数
  historyStack: [],  // Array<Array<Object>>：历史里每一步的差分清单
  historyIndex: -1,  // number：当前走到历史里的哪一步，-1 表示还停在起点、没有可撤销的步
  committedTable: new Map(),  // Map<number, {rec:Object, el:Object}>：上一次落定时已落定电路的样子，按元件内部编号存
  committedTextTable: new Map(),  // Map<number, {rec:Object, tx:Object}>：上一次落定时已落定的浮动文本
  nextElementId: 1,  // number：元件内部编号的发号器；编号只在本程序内用来认人，不写进存档
  HISTORY_LIMIT: 100,  // number：最多保留多少步，超出丢掉最老的，避免长时间编辑把内存撑大
};

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

