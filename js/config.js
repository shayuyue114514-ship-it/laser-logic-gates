// config.js：所有可调参数的集中登记处：画布尺寸、配色、面板排版、按键映射。
"use strict";

/* ========== 常量配置 ========== */

const CONFIG = {
  gridUnit: 1,            // 网格基本单位：1 个世界单位 = 1 格，也是永远显示的最小格子
  viewportMargin: 24,     // 视口相对画布的内缩边距（CSS px），让视口边界可见
  sidebarWidth: 220,      // 左侧工作区竖栏的宽度（CSS px）：网格视口与上方面板的左边缘都从竖栏右边起算
  sidebarTipDelay: 0.8,   // 指针停在列表某一条上多久才显示全名小窗（秒）：扫过一排时不会闪出一堆小窗
  panelHeight: 70,        // 画布上方预留的空白高度（CSS px）：给元件选择面板用，网格视图整体下移这么多
  panelGap: 12,           // 上方面板矩形与窗口顶边、网格顶边之间的空隙（CSS px）
  bottomBarHeight: 35,    // 底部栏的高度（CSS px）：取上方元件面板高度的一半，整页上下形成呼应
  hintFontSize: 15,       // 底栏提示文字的字号（CSS px）
  panelSlotCount: 7,      // 面板里选项槽的数量：一个选中槽加五个元件槽，末尾另留一个空位
  panelSlotPad: 8,        // 选项槽区域相对面板内沿的内缩（CSS px），让槽不贴到面板边框上
  panelSlotGap: 8,        // 选项槽之间的横向间隔（CSS px）
  panelSlotRadius: 8,     // 选项槽的圆角半径（CSS px）
  panelSlotSide: 50,      // 选项槽边长（CSS px）：固定值，不再由面板高度推出，面板加高不会把槽一起撑大
  panelSlotElementLen: 28,      // 槽内元件的长度（CSS px，三角形顶点到底边）：形状比例不变，宽度按 elementWid/elementLen 自动推出
  panelSlotHoverScale: 0.93,    // 悬停时整个槽缩到的比例：槽与槽内元件一起缩，不会只缩框不缩元件
  panelSlotPressedScale: 0.86,  // 按下时整个槽缩到的比例：比悬停更深，手感像真的按进去
  panelSlotAnimDuration: 0.16,  // 槽反馈动画时长（秒）：悬停与按下的缩放都用它，走固定时长的缓出曲线，不用指数平滑
  slotSelectedBorderWidth: 3,   // 选中槽的描边宽度（CSS px）：比普通槽的 2px 略粗，作为选中标识
  settingsLitAmount: 0.45,      // 设置按钮打开时的提亮幅度（0~1）：朝白色混这么多，太大就发灰不像同一色系
  settingsLitDuration: 0.22,    // 设置按钮提亮的过渡时长（秒）：亮起与熄灭都走它，太快会像闪一下
  gearTeeth: 8,           // 齿轮齿数：8 齿在二十几像素的尺寸下疏密刚好，再多就糊成一圈看不出齿
  gearTipR: 0.33,         // 齿顶半径（世界单位）：和元件同一套尺度，随槽内缩放自动变小
  gearRootR: 0.245,       // 齿根半径（世界单位）：齿顶到齿根的高度即齿高，太浅就不像齿轮
  gearHoleR: 0.125,       // 中心孔半径（世界单位）：孔和齿根之间要留出一圈可见的环，否则齿轮糊成一坨
  gearTipHalfDeg: 7,      // 齿顶半角（度）：齿顶比齿根窄，齿才是有锥度的梯形而不是方块
  gearRootHalfDeg: 12,    // 齿根半角（度）：两齿之间的空隙由它和齿距共同决定
  gearStroke: 0.07,       // 齿轮描边宽度（世界单位）：比元件描边细，否则中心孔会被描边糊死
  fileHalfW: 0.26,        // 文件图标半宽（世界单位）：纸比齿轮窄一点，视觉重量才和齿轮相当
  fileHalfH: 0.325,       // 文件图标半高（世界单位）：约 26px，加上描边后与齿轮外径 29px 基本齐平
  fileCornerR: 0.06,      // 文件图标外框圆角半径（世界单位）：与齿轮的圆角风格一致，不出现硬直角
  fileFoldLen: 0.15,      // 文件图标右上折角的边长（世界单位）：随纸面一起缩小，比例保持不变
  fileStroke: 0.04,       // 文件图标描边宽度（世界单位）：比齿轮明显细一档，约 1.6px，纸面才显得轻盈不糊
  selectIconH: 0.66,      // 「选中」图标的高度（世界单位）：与文件图标 0.65 基本齐平，一排图标视觉重量一致
  selectIconStroke: 0.075, // 「选中」图标描边宽度（世界单位）：比文件图标明显粗一档，约 3px，箭头轮廓更实
  selectIconDX: 0.04,     // 「选中」图标的水平偏移（世界单位）：箭头略微右移，让视觉重心更靠近槽心
  tutorialIconOuterR: 0.33, // 教程图标外缘半径（世界单位）：与齿轮齿顶 0.33 同档，一排按钮的图标视觉重量一致
  tutorialRingStroke: 0.04, // 教程图标圆环的描边宽度（世界单位）：圆面填实后边框只当一圈轮廓，取与文件图标同一档
  marqueeThreshold: 4,    // 拉框判定阈值（CSS px）：指针移动超过它才算拉框，否则仍当单击，避免手一抖拉出一个空框
  marqueeWidth: 1,        // 拉框边框宽度（CSS px）：细一点，别挡住框住的内容
  panelTipGap: 6,         // 面板矩形下边缘与简介浮层之间的竖向间隔（CSS px）
  panelTipPadX: 12,       // 简介底板内的左右内边距（CSS px）
  panelTipPadY: 4,        // 简介底板内的上下内边距（CSS px）
  panelTipRadius: 6,      // 简介底板圆角半径（CSS px）
  panelTipNameSize: 13,   // 简介里元件名称的字号（CSS px）
  panelTipDescSize: 12,   // 简介里说明文字的字号（CSS px）
  panelTipLineHeight: 17, // 简介说明文字的行高（CSS px）
  panelTipDelay: 0.9,     // 指针停在同一个槽上多久才显示简介（秒）：防止扫过一排槽时闪出一堆浮层
  panelTipAnimDuration: 0.18, // 简介浮层的显隐动画时长（秒）：走缓入缓出曲线
  panelTipRise: 6,        // 简介浮层滑入的起始偏移（CSS px）：从上方这么远的位置滑到位
  settingsPanelWidth: 264,      // 设置弹窗宽度（CSS px）：右边缘与齿轮槽右内沿对齐，宽度要装下「文字＋滑块＋数值」一行
  settingsPanelGap: 6,          // 设置弹窗顶边与上方面板矩形下边缘的间隔（CSS px）
  settingsPanelPadX: 12,        // 设置弹窗内的左右内边距（CSS px）
  settingsPanelPadY: 8,         // 设置弹窗内的上下内边距（CSS px）
  settingsPanelRadius: 8,       // 设置弹窗圆角半径（CSS px）：与选项槽、简介浮层同一档
  settingsPanelRowH: 28,        // 设置弹窗里每行的行高（CSS px）：以后放开关或滑块都按这个高度排
  settingsPanelFontSize: 12,    // 设置弹窗文字字号（CSS px）：与简介浮层的说明文字同号
  tutorialPanelW: 520,          // 教程弹窗宽度（CSS px）：要装下成段的教程文字，比设置弹窗宽得多
  tutorialPanelH: 360,          // 教程弹窗高度（CSS px）：高度定死，文字超出时由里面的内容区自己滚动，窗口不被撑高
  confirmPanelW: 300,           // 确认弹窗宽度（CSS px）：只要装下一句问话和两个按钮，比另外三个弹窗都窄
  minScale: 4,            // 最小缩放：1 世界单位 = 4 CSS px
  maxScale: 400,          // 最大缩放：1 世界单位 = 400 CSS px
  wheelZoomRate: 0.0015,  // 滚轮 deltaY → 缩放指数的系数
  smoothLambda: 14,       // 平滑收敛速度，越大越跟手
  settlePx: 0.01,         // 平滑吸附阈值（CSS px）：误差小于它就判定为已停下
  settleLogEps: 1e-4,     // 缩放对数的吸附阈值
  defaultScale: 40,       // 初始缩放
  defaultAnchorWX: 0,     // 初始参考点的世界坐标 X（网格原点）
  defaultAnchorWY: 0,     // 初始参考点的世界坐标 Y（网格原点）
  elementLen: 0.7,        // 元件长度（世界单位，1 = 1 格）：等腰三角形顶点到底边
  elementWid: 0.45,       // 元件底边宽度（世界单位）
  elementNotch: 0.2,      // 透射器底边的内凹深度（世界单位）：凹点取底边中点，朝顶点方向凹进去
  inverterLen: 0.6,       // 反相器三角形顶点到底边的长度：比 elementLen 短，给顶点上的气泡腾出位置
  elementBubbleR: 0.13,   // 反相器气泡的半径（世界单位）：非门符号的标志，圆心正好落在三角形顶点上
  elementHeadRatio: 0.4,  // 光源尖头段占元件长度的比例：按参考图，右侧三角段约占整体四成
  lampHalf: 0.3,          // 灯的半边长（世界单位）：边长 0.6，比其它元件的 0.7 略小一圈
  lampRadius: 0.12,       // 灯的圆角半径（世界单位）：约占半边长的四成，圆角明显但不至于圆成一团
  lampAnimDuration: 0.02, // 灯亮起的缓动时长（秒）：只剩两帧左右的过渡，观感上等同瞬间亮起
  lampGlowBlur: 0.3,      // 灯光晕的模糊半径（世界单位）：用高斯模糊把灯的轮廓向外化开，边缘没有硬圈
  lampGlowAlpha: 0.8,     // 灯光晕的颜色浓度：模糊后贴着灯的那一圈约为它的一半，整体是淡红
  elementStroke: 0.1,     // 元件描边宽度（世界单位）；描边只露外侧一半，可见环宽即 0.05
  elementStrokeSelected: 0.13, // 选中元件的描边宽度（世界单位）：只比常态粗三成，轮廓更实即可，再粗就成粗黑框
  ghostLambda: 30,        // 虚影跟随鼠标的收敛速度，比相机快得多，换格时干脆利落不拖沓
  ghostSettle: 0.001,     // 虚影吸附阈值（世界单位）：误差小于它就直接落到格心
  ghostOpacity: 0.45,     // 虚影整体透明度：必须用整节点透明度，不能用 fill-opacity/stroke-opacity
  ghostRejectDuration: 1,     // 虚影「进不去」动画总时长（秒）：指数缓出，在 0.1 处位移过半、透明度归零，所以可见部分约 0.1 秒
  ghostFadeInLambda: 25,      // 虚影淡入速度（1/秒）：回到可放置格时按指数收敛出现，约 0.25 秒收敛到吸附阈值
  rotateLambda: 25,           // 朝向旋转的收敛速度（1/秒）：先快后慢，约 0.3 秒转到目标朝向；虚影和元件共用
  rotateSettle: 0.1,          // 旋转吸附阈值（度）：误差小于它就直接落到目标角度，避免留残差
  elementDeleteDuration: 0.1,  // 元件删除动画时长（秒）：一边收缩一边淡出，和选中缓动同一档节奏
  selectAnimDuration: 0.1,     // 选中缓动时长（秒）：填充与描边在这段时间里从常态过渡到选中配色
  orbitDuration: 0.16,          // 公转动画时长（秒）：WASD 整批旋转一步 90° 的走完时间，短一点才跟手
  moveLambda: 20,               // 拖动缓动速度（1/秒）：元件视觉位置按指数缓出追上目标格，先快后慢、跟手但不硬跳
  moveSettle: 0.002,            // 拖动缓动吸附阈值（世界单位）：残差小于它就直接归零，避免留一点点永远抖的尾巴
  microframeDt: 0.12,          // 一个微帧对应的真实时长（秒）：约 8 微帧/秒，也是速度滑块初值的来源
  speedSliderSteps: 1000,      // 速度滑块的总刻度数：刻度越细，拖动手感越连续
  speedDtMin: 0.02,            // 滑块最左端之外的最小微帧时长（秒）：选 0.02 是为了让滑块中点落在约 0.14 秒，贴近常用的 0.12 秒
  speedDtMax: 1,               // 滑块最右端的微帧时长（秒）：一个微帧要等满 1 秒
  maxQuiescentSteps: 10000,    // 零延迟时单帧最多结算的微帧数：只防逻辑成环时死循环，正常链路远用不到
  laserWidth: 0.133,           // 激光光芯宽度（世界单位）：随缩放一起变粗变细，1 格 = 1
  laserGlowLayers: 8,          // 辉光层数：用多层同心描边叠出连续衰减，层数越多过渡越平滑
  laserGlowSpread: 3.4,        // 最外层辉光的宽度相对光芯的倍数：越大晕开得越远
  laserGlowAlpha: 0.11,        // 单层辉光的峰值透明度：多层会叠加，实际观感约为它的两倍
  laserGlowDownscale: 2,       // 激光辉光离屏位图的降采样倍数：辉光是低频图形，降一倍肉眼看不出，光栅化面积却少四分之三
  maxStepsPerFrame: 8          // 单帧最多推进的微帧数：防止切回标签页后一次性补算太多，陷入「越补越慢」的螺旋
};

/* 配色：网格蓝色系，背景淡蓝 */
const COLOR = {
  line: "#42A5F5",        // 网格线：全部同色同粗细，没有加粗线
  background: "#81D4FA",  // 视口内背景：淡蓝
  border: "#29B6F6",      // 视口边框：Light Blue 400
  panelFill: "#7AD5FF",   // 上方面板底板：硬编码定死，等价于 hsl(199, 100%, 74%)，不随调试面板变化
  slotFill: "#94DBFF",    // 选项槽填充：硬编码定死，等价于 hsl(200, 100%, 79%)，不随调试面板变化
  slotFillSelected: "#C4EBFF", // 选中槽填充：比 slotFill 朝白色提亮约 45%，和未选中槽一眼能分开
  slotBorder: "#29B6F6",  // 选项槽描边：与视口边框同色，整页外框保持一个色系
  slotBorderSelected: "#5FC8F8", // 选中槽描边：比 slotBorder 朝白色提亮约 25%，只亮一点点，和加粗一起构成选中标识
  tipFill: "#C4EBFF",     // 简介底板填充：淡蓝，比面板底色浅一档，浮在网格上也读得清
  tipBorder: "#29B6F6",   // 简介底板描边：与面板、视口边框同色，整页仍是同一套外框
  tipName: "#0D47A1",     // 简介里元件名称的文字色：深蓝，层级最高
  tipDesc: "#2C4A63",     // 简介里说明文字的颜色：略浅的深灰蓝，不抢名称
  laserCore: "#F5FBFF",   // 激光光芯：淡白略偏冷，比浅蓝底亮，压在上面读得出来
  laserGlow: "#FFFFFF",   // 激光辉光：纯白，透明度由每层的 globalAlpha 单独给，所以这里只要颜色
  lampGlow: "#FF8A80",    // 灯被照亮时的光晕：淡红，透明度由亮起进度与峰值一起给
  selectBorder: "#1565C0", // 拉框描边：深蓝，压在淡蓝网格上边界清晰
  selectFill: "rgba(21, 101, 192, 0.14)", // 拉框的填充：同色低透明度，压得住网格又不遮住框里的元件
  hintText: "#0D47A1"     // 底栏提示文字：深蓝，压在淡蓝底板上读得清，且与整页仍是同一色系
};

// 画布上文字的字体族：与页面正文同族，底栏提示和以后画布上的其它文字都用它，避免各处各写一串
const UI_FONT = "-apple-system, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"; // string：画布文字字体族

// 元件配色：用 HSL 三元组而不是 hex，因为临时调色器直接改这三个数就能实时生效
const elementHSL = {
  fill: { h: 207, s: 89, l: 55 },   // 填充：Blue 500
  stroke: { h: 210, s: 80, l: 42 }  // 描边：Blue 800，同色系略深一档
};

// 选中配色：同样用 HSL 三元组，和本体配色一套表示，选中缓动时逐通道插值就行，不必再拆 hex
// 数值分别等价于原来的 #4FC3F7 与 #0277BD，色相只小幅平移，不跨 0 度，线性插值不会串色
const selectLitHSL = {
  fill: { h: 199, s: 91, l: 64 },   // 选中填充：比本体亮一档，一眼看出被选中又不刺眼
  stroke: { h: 202, s: 98, l: 37 }  // 选中描边：比浅色填充明显更深一档，但仍是饱和的蓝，不压到近黑
};

// 灯被激光照亮时的配色：淡红，与本体同一套 HSL 表示，亮起缓动时逐通道插值过渡
// 这里只作为「亮起后的目标色」的登记处，实际混合在 RGB 里做，所以不用操心色相绕远路的问题
const lampLitHSL = {
  fill: { h: 0, s: 85, l: 80 },    // 亮起填充：很浅的红，压得住深色描边又不刺眼
  stroke: { h: 0, s: 62, l: 50 }   // 亮起描边：比填充深一档，轮廓依旧清晰
};

// 常态色、亮起色、选中色三组端点预先换算成 RGB：混合时只做乘加，省掉每帧重复的 HSL 换算
// 灯的颜色过渡全部在这几组数上做逐通道混合，效果等价于盖一层遮罩淡入，且不经过色相环
const RGB = {
  elementFill: hslToRgb(elementHSL.fill),
  elementStroke: hslToRgb(elementHSL.stroke),
  lampFill: hslToRgb(lampLitHSL.fill),
  lampStroke: hslToRgb(lampLitHSL.stroke),
  selectFill: hslToRgb(selectLitHSL.fill),
  selectStroke: hslToRgb(selectLitHSL.stroke)
};

// 调试面板里元件那两组滑块的取色沙盒：初值从上面的实际配色拷一份，面板一打开显示的就是当前颜色
// 和面板里其他组一样已经解绑：拖滑块只改这里的值与色块，画面始终取 elementHSL
const elementSandbox = {
  fill: Object.assign({}, elementHSL.fill),
  stroke: Object.assign({}, elementHSL.stroke)
};

// 上方面板底板的取色沙盒：初值就等于 COLOR.panelFill 对应的 hsl(199, 100%, 74%)
// 这三个数已经和实际渲染解绑，拖动只改沙盒的色块和色值文本，底板颜色始终取 COLOR.panelFill
const panelHSL = { h: 199, s: 100, l: 74 };

// 面板选项槽的取色沙盒：初值就等于 COLOR.slotFill 对应的 hsl(200, 100%, 79%)
// 和 panelHSL 一样已经和实际渲染解绑，拖动只改沙盒的色块和色值文本，槽填充始终取 COLOR.slotFill
const slotHSL = { h: 200, s: 100, l: 79 };

// 设置齿轮与它所在槽的实际配色：画面取这里，是真正的颜色来源
const settingsHSL = {
  gearFill: { h: 207, s: 89, l: 55 },    // 齿轮填充：初值同元件填充
  gearStroke: { h: 210, s: 80, l: 42 },  // 齿轮描边：初值同元件描边
  slotFill: { h: 200, s: 100, l: 79 },   // 设置槽底板填充：初值同元件槽填充
  slotStroke: { h: 199, s: 92, l: 56 }   // 设置槽底板描边：初值同元件槽描边
};

// 调试面板里那四组滑块的取色沙盒：初值从上面的实际配色拷一份，所以面板一打开显示的就是当前颜色
// 但两者已经解绑：拖滑块只改这里的值和面板上的色块，画面始终取 settingsHSL，调参不会误改实际颜色
const settingsSandbox = {
  gearFill: Object.assign({}, settingsHSL.gearFill),
  gearStroke: Object.assign({}, settingsHSL.gearStroke),
  slotFill: Object.assign({}, settingsHSL.slotFill),
  slotStroke: Object.assign({}, settingsHSL.slotStroke)
};

// 元件选择面板各槽放的类型：下标即类型下标，第一个元件槽放的就是第 0 个类型
const PANEL_SLOT_TYPES = ["deflector", "transmitter", "light", "inverter", "lamp"];

// 「选中」工具槽的序号：插在所有元件槽的最左侧，所以是 0
// 它和元件槽一样占一个槽位、一样走悬停与按下的动画，但不是元件槽，不参与放置类型和简介
const SELECT_SLOT_INDEX = 0;

// 第一个元件槽的序号：紧跟在选中槽右边
// 元件槽的序号一律由它推算，以后还想在最左边再加工具槽，只改这一个数即可
const ELEMENT_SLOT_BASE = SELECT_SLOT_INDEX + 1;

// 设置按钮在槽动画数组里的下标：排在所有元件槽之后
// 给它一个正式序号，悬停与按下就自动走元件槽那同一套，不必再维护第二份状态，手感也不会走样
const SETTINGS_SLOT_INDEX = CONFIG.panelSlotCount;

// 文件按钮在槽动画数组里的下标：紧挨着设置按钮的左边，所以序号再往后一位
// 同样给正式序号，悬停与按下复用元件槽那套动画，和设置按钮手感完全一致
const FILE_SLOT_INDEX = SETTINGS_SLOT_INDEX + 1;

// 教程按钮在槽动画数组里的下标：紧挨着文件按钮的左边，所以序号再往后一位
// 同样给正式序号，悬停与按下复用元件槽那套动画，三个按钮手感完全一致
const TUTORIAL_SLOT_INDEX = FILE_SLOT_INDEX + 1;

// 判断某个槽序号是不是「元件槽」：元件槽才响应放置类型与简介，选中槽和两个按钮槽都不算
// 以后再加按钮时，只要它的序号排在元件槽之后，这里不必改
function isElementSlot(i) {
  return i >= ELEMENT_SLOT_BASE && i < ELEMENT_SLOT_BASE + PANEL_SLOT_TYPES.length;
}

// 判断某个槽序号是不是「可选中的槽」：选中槽和元件槽都能点中并高亮，两个按钮槽不能
// 按钮槽有自己的开关状态，不参与选中，所以不能拿 isElementSlot 反过来当「不可选」
function isPickableSlot(i) {
  return i === SELECT_SLOT_INDEX || isElementSlot(i);
}

// WASD 对应的朝向索引：与元件的朝向索引同一套编号（0 上 1 右 2 下 3 左）
// 按键直接拨到目标朝向，只走最近的一条路，转多少交给旋转动画去补
const DIR_KEYS = { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 };

/* SVG 相关常量 */
const SVG_NS = "http://www.w3.org/2000/svg";

/* 元件类型表 */
