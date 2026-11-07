// config.js：所有可调参数的集中登记处：画布尺寸、配色、面板排版、按键映射。
"use strict";

/* ========== 常量配置 ========== */

const CONFIG = {
  appVersion: "1.0.0.020",    // 应用版本号：唯一一处定义，首页副标题、离线缓存与发布包都以它为准；内部号每次改动末位加一
  gridUnit: 1,            // 网格基本单位：1 个世界单位 = 1 格，也是永远显示的最小格子
  gridLineRatio: 0.03,    // 网格线宽 = 格宽 × 这个比例 + gridLineBase，上限 1 CSS px
  gridLineBase: 0.22,     // 上式里的固定加数（CSS px）：线细到 0.25 px 上下就看不见了，靠它兜住，缩到多小也画得出来
  gridLineBoost: 0.55,    // 放大到一定程度后线宽额外加粗的上限（CSS px）：只加一点点，避免放大后格线太淡看不清
  gridLineBoostFrom: 26,  // 开始加粗的格宽（CSS px）：低于它维持原来的 1 px 上限，观感与改动前一致
  gridLineBoostTo: 110,   // 加粗到满的格宽（CSS px）：从 from 到 to 之间按平滑曲线过渡，不会有突变
  elemCachePadPx: 320,    // 元件缓存位图四周多画出的屏幕边距（CSS px）：平移没超出这一圈就只贴旧图，不重画
  zoomRefreshMin: 1.05,   // 「缩放刷新速度」滑块最左端：缓存位图只被放大 5% 就重画，最清晰也最费
  zoomRefreshMax: 3,      // 滑块最右端：放到 3 倍才重画，最省也最糊
  zoomRefreshDefault: 1.4,// 滑块默认值：上一版手工定的那一档，放大到 1.4 倍重画一次
  viewportMargin: 24,     // 视口相对画布的内缩边距（CSS px），让视口边界可见
  sidebarWidth: 220,      // 左侧工作区竖栏的宽度（CSS px）：网格视口与上方面板的左边缘都从竖栏右边起算
  rightbarWidth: 40,      // 右侧工具栏的宽度（CSS px）：只放一列小功能图标，做得越细占掉网格越少
  rightToolCount: 24,     // 右侧工具栏里先摆出的方框个数：图标以后再做，先按格子把位置定下来
  // 右侧工具栏每一格的名称：指针停在上面时写在格子左侧；空串表示这一格还没功能，不显示小窗
  // 下标与格子序号一一对应，第一个是状态槽，第二个是逐微帧推进的「前进一步」，第三个是临时抹掉画面上所有激光，第四个是堆叠
  rightToolNames: ["运行开关", "前进一步", "清除激光", "堆叠", "查找"],
  rightBarTipDelay: 0.5,  // 指针停在工具栏某一格上多久才弹出名称（秒）：扫过一整列时不会一路闪出小窗
  sidebarTipDelay: 0.8,   // 指针停在列表某一条上多久才显示全名小窗（秒）：扫过一排时不会闪出一堆小窗
  sidebarSubmenuDelay: 0.16, // 指针离开菜单后隔多久才收起右侧那一列文件类型（秒）：留出斜着挪进子列表的时间，不然会闪一下
  panelHeight: 70,        // 画布上方预留的空白高度（CSS px）：给元件选择面板用，网格视图整体下移这么多
  panelGap: 12,           // 上方面板矩形与窗口顶边、网格顶边之间的空隙（CSS px）
  bottomBarHeight: 35,    // 底部栏的高度（CSS px）：取上方元件面板高度的一半，整页上下形成呼应
  hintFontSize: 15,       // 底栏提示文字的字号（CSS px）
  panelSlotCount: 7,      // 面板里选项槽的数量：一个选中槽、五个元件槽、末尾一个「文本」工具槽
  panelSlotPad: 8,        // 选项槽区域相对面板内沿的内缩（CSS px），让槽不贴到面板边框上
  panelSlotGap: 8,        // 选项槽之间的横向间隔（CSS px）
  panelSlotRadius: 6,     // 选项槽的圆角半径（CSS px）
  panelSlotSide: 50,      // 选项槽边长（CSS px）：固定值，不再由面板高度推出，面板加高不会把槽一起撑大
  panelSlotElementLen: 28,      // 槽内元件的长度（CSS px，三角形顶点到底边）：形状比例不变，宽度按 elementWid/elementLen 自动推出
  panelSlotHoverScale: 1,    // 悬停不再缩放：工具型界面靠底色变化反馈，避免整排槽抖动
  panelSlotPressedScale: 1,  // 按下同样不缩放：与悬停一致，反馈只改底色与描边
  panelSlotAnimDuration: 0.16,  // 槽反馈动画时长（秒）：悬停与按下的缩放都用它，走固定时长的缓出曲线，不用指数平滑
  panelSlotKeyPressDuration: 0.2, // 键盘选中时按下态保持的秒数：比动画时长略长，缩到底之后再回弹，与点一下鼠标看到的节奏一样
  slotSelectedBorderWidth: 1.5,   // 选中槽的描边宽度（CSS px）：比普通槽的 1px 略粗，作为选中标识
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
  textIconHalfW: 0.26,    // 「文本」图标 T 形横笔的半宽（世界单位）：与文件图标同宽档，一排图标的视觉重量才一致
  textIconHalfH: 0.3,     // 「文本」图标 T 形竖笔的半高（世界单位）：略高于半宽，T 才立得住
  textIconStroke: 0.075,  // 「文本」图标的描边宽度（世界单位）：与「选中」箭头同档，两枚笔划图标粗细一致
  tutorialIconOuterR: 0.33, // 教程图标外缘半径（世界单位）：与齿轮齿顶 0.33 同档，一排按钮的图标视觉重量一致
  tutorialRingStroke: 0.04, // 教程图标圆环的描边宽度（世界单位）：圆面填实后边框只当一圈轮廓，取与文件图标同一档
  aboutIconOuterR: 0.33,    // 「关于」图标外缘半径（世界单位）：与教程图标同档，两枚圆面图标并排时大小一致
  aboutIconRingStroke: 0.04, // 「关于」图标圆环的描边宽度（世界单位）：与教程图标同一档，外圈细轮廓的观感统一
  logIconHalfW: 0.24,       // 「日志」图标半宽（世界单位）：与文件图标同宽档，一排入口图标的视觉重量一致
  logIconHalfH: 0.3,        // 「日志」图标半高（世界单位）：略高于半宽，纸面立得住
  logIconCornerR: 0.06,     // 「日志」图标外框圆角半径（世界单位）：与文件图标同一档圆角
  logIconStroke: 0.04,      // 「日志」图标外框描边宽度（世界单位）：与文件图标同为细一档
  logIconLineStroke: 0.045, // 「日志」图标内三条横线的描边宽度（世界单位）：略粗于外框，小尺寸下仍看得见
  logIconLineHalfW: 0.12,   // 「日志」图标内横线的半长（世界单位）：左右各留一段边距
  logIconLineGap: 0.1,      // 「日志」图标内相邻横线的间距（世界单位）：三条线在纸面中均匀分布
  plusArm: 0.28,            // 「新建」加号从中心到笔画末端的长度（世界单位）：比圆面图标略大，留白多才不显得单薄
  plusStroke: 0.08,         // 「新建」加号的描边宽度（世界单位）：比文件图标粗一档，两笔短划在浅底上才立得住
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
  stackPanelWidth: 236,         // 堆叠设置框宽度（CSS px）：装下「堆叠次数」一行文字、数字格与两个步进键
  stackMaxLayers: 64,           // 堆叠层数上限：防止手滑填个大数一次性铺满整张网格
  stackDefaultCount: 2,         // 堆叠次数默认值：含原来那一批，所以默认是「原件加一份」
  stackDefaultDX: 0,            // X 偏移默认值（格）：每多一层就往右挪几格，默认不挪
  stackDefaultDY: -1,           // Y 偏移默认值（格）：世界 Y 向上为正，取 -1 表示往下一格叠
  stackPreviewAlpha: 0.3,       // 堆叠虚影的整体透明度：比选中态明显淡，一眼能分出「还没落下」
  stackPreviewDashOn: 0.16,     // 堆叠虚影描边虚线的实线段长度（世界单位）
  stackPreviewDashOff: 0.1,     // 堆叠虚影描边虚线的空线段长度（世界单位）
  // 查找：点右侧工具栏第五格后，在网格视口右上角浮出一个小设置框，按选区里的元件组合在整份电路里找同样的组合
  searchPanelWidth: 208,        // 查找设置框宽度（CSS px）：一行放得下方式与放大镜，一行放页码与两个箭头
  searchPanelPad: 8,            // 查找设置框内边距（CSS px）
  searchPanelRadius: 8,         // 查找设置框圆角半径（CSS px）
  searchPanelFontSize: 12,      // 查找设置框字号（CSS px）
  searchPanelInset: 10,         // 查找设置框离视口右上角两条边的距离（CSS px）
  searchFocusCover: 0.22,       // 定位到某个结果时它最长那边占视口短边的比例：落在 10%~30% 之间
  searchFlashDuration: 1.6,     // 定位到某个结果时闪两下的总时长（秒）：放慢一档，两下之间有足够空闲，不催人
  searchMaxResults: 2000,       // 一次最多收多少个结果：极常见的单件组合也不至于把结果表撑爆
  searchTintBase: 0.45,         // 所有结果里的元件朝橘黄偏的程度：低一档，看得清是橘黄又不抢眼
  searchTintActive: 0.72,       // 当前定位的那一组：比其余结果再重一档，一眼分得出是哪一组
  searchFlashExtra: 0.12,       // 闪两下时在当前这一组上额外加的程度：只轻轻起伏，不再把元件一下照白
  toastHold: 3,                 // 中间提示框停留多久才开始淡出（秒）：到点自己走，不用手点关闭
  toastFade: 0.3,               // 中间提示框淡出的时长（秒）：读完就干脆退场，不留拖尾
  toastFontSize: 13,            // 中间提示框的字号（CSS px）：比悬停小窗大一号，是一句要正眼读的话
  touchLongPressMs: 500,        // 触屏长按多久算「删除」（毫秒）：短了容易在放置时误删，长了又等得不耐烦
  minScale: 1,            // 最小缩放：1 世界单位 = 1 CSS px（再小连元件轮廓也落到亚像素上，格子里已没有可看的东西）
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
  labelFontSize: 0.34,        // 元件标签的字号（世界单位）：随缩放一起变，默认缩放下约 13.6px；不做任何基于缩放的隐藏
  labelLineHeight: 1.3,       // 多行文字的行高相对字号的倍数：元件标签恒为一行，这条是给以后的文本块留的
  labelAngleDefault: 180,     // 标签的默认方位角（度）：与元件朝向同一套，0 上、90 右、180 下、270 左，默认在正下方
  // 标签能在元件身旁小范围挪动：方位角可以绕元件转一圈，离元件多远则夹在下面这个区间里
  // 这个距离量的是「文字外框离元件格心最近的那一点」到格心的距离，不是文字中心到格心的距离：
  // 文字有宽有高，若按中心算，字越长看着离元件越远、字越短越像贴在元件上，同一种摆放给出的观感不一致
  // 按最近点算，则字长字短都一样贴，字与元件之间那道空隙在任何字数下都是同一个值
  // 上限一格：再远就和一块自由摆放的文字没有区别，挂在哪个元件上也就看不出来了
  // 下限四分之一格：允许字稍微压到元件外沿，但不允许它整个盖在元件上
  labelGapDefault: 0.75,      // number：新建标签与读档缺省时，文字外框最近点离元件格心的距离（世界单位）
  labelGapMin: 0.25,          // number：拖动标签时这个距离的下限（世界单位）
  labelGapMax: 1,             // number：拖动标签时这个距离的上限（世界单位）
  labelHitPad: 3,             // 标签命中区相对文字外框的外扩（CSS px）：字小的时候也点得中，不必先放大再去抓
  /* —— 浮动文本 —— */
  textFontSize: 0.5,          // 浮动文本的正文字号（世界单位）：比元件标签的 0.34 大一档，一段说明要比一行标签更醒目
  textLineHeight: 1.45,       // 浮动文本的行高相对该行字号的倍数：标题行更大，所以逐行按各自字号算
  textHitPad: 4,              // 浮动文本命中区相对整块外框的外扩（CSS px）
  textFieldMinW: 60,          // 原地输入框的最小宽度（CSS px）：内容还空着时也得有个够大、点得中的框
  textEditFillAlpha: 0.55,    // 原地编辑时垫在文字下面的那块底色的不透明度：看得见范围，又不改动网格与文字的对比
  textEditFillPadX: 0.18,     // 那块底色左右各外扩多少，相对该块正文字号的比例
  textEditFillPadY: 0.08,     // 那块底色上下各外扩多少，相对该块正文字号的比例
  textCaretW: 1.5,            // 原地输入的光标宽度（CSS px）：一像素在视网膜屏上太细，看着像根虚影
  textCaretBlinkMs: 1000,     // 光标一个完整的亮灭周期（毫秒）
  textCaretOnMs: 620,         // 光标在一个周期里亮着的那一段（毫秒）：亮略长于灭，读起来更稳
  textImeUnderlineRatio: 0.07, // 输入法拼字时那条下划线的粗细，相对该行字号的比例
  // Markdown 标题的缩放档位：下标是井号个数（0 表示这一行不是标题），值是该行字号相对正文字号的倍数
  // 只做「染色加略微缩放」，一个字符都不删：井号原样留在行的开头，所以改完样式随时能改回内容
  textHeadScale: [1, 1.45, 1.28, 1.14, 1.06, 1.03, 1.02],
  microframeDt: 0.12,          // 一个微帧对应的真实时长（秒）：约 8 微帧/秒，也是速度滑块初值的来源
  speedSliderSteps: 1000,      // 速度滑块的总刻度数：刻度越细，拖动手感越连续
  speedDtMin: 0.02,            // 滑块最左端之外的最小微帧时长（秒）：选 0.02 是为了让滑块中点落在约 0.14 秒，贴近常用的 0.12 秒
  speedDtMax: 1,               // 滑块最右端的微帧时长（秒）：一个微帧要等满 1 秒
  maxQuiescentSteps: 10000,    // 零延迟时单帧最多结算的微帧数：兜底防死循环；正常情况下先被下面那条时间预算挡住
  zeroDelayBudgetMs: 10,       // 零延迟时每帧最多花在结算上的毫秒数：按 30 帧的帧预算留出渲染余量，链没跑完就留到下一帧接着跑
  laserWidth: 0.133,           // 激光光芯宽度（世界单位）：随缩放一起变粗变细，1 格 = 1
  laserGlowLayers: 8,          // 辉光层数：用多层同心描边叠出连续衰减，层数越多过渡越平滑
  laserGlowSpread: 3.4,        // 最外层辉光的宽度相对光芯的倍数：越大晕开得越远
  laserGlowAlpha: 0.11,        // 单层辉光的峰值透明度：多层会叠加，实际观感约为它的两倍
  laserGlowDownscale: 2,       // 激光辉光离屏位图的降采样倍数：辉光是低频图形，降一倍肉眼看不出，光栅化面积却少四分之三
  lampGlowDownscale: 2,        // 灯光晕离屏位图的降采样倍数：光晕本身就是一团模糊，同样降一倍，贴灯多时省下的面积很可观
  renderPrecisionMin: 5,       // 「渲染精度」滑块最左端：精度 5 对应 1 倍像素比，画布按 CSS 像素开
  renderPrecisionMax: 20,      // 滑块最右端：精度 20 对应 4 倍像素比，属于超采样，最锐也最费
  renderPrecisionPerX: 5,      // 精度与倍率的换算：倍率 = 精度 / 5，于是 5=1×、10=2×、20=4×
  renderPrecisionDefault: 10,  // 默认精度 10，即 2 倍像素比：与改动前的默认观感一致
  maxStepsPerFrame: 8          // 单帧最多推进的微帧数：防止切回标签页后一次性补算太多，陷入「越补越慢」的螺旋
};

/* ========== 首页（进入界面）参数 ========== */

// 首页只做展示与分流：整屏一张画布，从上到下依次画网格、两侧的演示电路、中间那一列（标题与四个入口）
// 这一段只登记首页自己的排版尺寸，按设计文档《2026-10-10-home-page-design》第 3、5、6、7 节取
// 颜色一律不在这里另配一份：绘制时直接回读 COLOR / elementHSL / CONFIG 里已经存在的那一套。
// 整页底色、网格线、入口底板、标题与入口文字、激光两色、元件形状与配色全部来自程序内部，
// 于是首页与编辑器共用同一套配色，两边不同的只是排版，而不是各立一份看起来像的色
const HOME = {
  /* —— 中间那一列（第 3 节）—— */
  inset: 40,                // 页面四周的留白（CSS px）：中间列与两侧演示都不越过这一圈
  colWidth: 300,            // 中间走廊的宽度（CSS px）：两侧演示以它为界；标题与入口只做水平居中
  colDemoGap: 48,           // 走廊与两侧演示之间的最小间隔（CSS px）
  titleMenuGap: 40,         // 副标题底边与第一块入口底板顶边之间的间隔（CSS px）
  titleText: "激光门",       // 标题文字：项目名，与两个页面的 title 标签、关于窗的标题保持同一串字
  titleFontRatio: 0.055,    // 标题字号占窗口宽的比例：算完再按上下限钳一次
  titleFontMin: 34,         // 标题字号的下限（CSS px）
  titleFontMax: 64,         // 标题字号的上限（CSS px）
  titleWeight: 700,         // 标题字重：取粗档，标题本身是这一页最重的一块；字色取 COLOR.tipName，与编辑器里的深蓝文字同一档
  subtitleText: "V" + CONFIG.appVersion, // 副标题文字：取应用版本号，压在标题下面一行；版本只在上面那一处定义
  subtitleFontRatio: 0.012, // 副标题字号占窗口宽的比例：比标题小得多，同样算完再按上下限钳一次
  subtitleFontMin: 12,      // 副标题字号的下限（CSS px）
  subtitleFontMax: 16,      // 副标题字号的上限（CSS px）
  subtitleWeight: 400,      // 副标题字重：正文那一档，不起强调作用；字色取 COLOR.tipDesc，比标题的深蓝浅一档
  titleSubtitleGap: 6,      // 标题底边与副标题顶边之间的间隔（CSS px）：两者读起来是一组，所以贴得比菜单那一侧近得多

  /* —— 四个入口：四块水平居中的圆角底板 —— */
  entryW: 200,              // 底板宽度（CSS px）：命中判定取的就是这一块，看得见的范围与点得到的范围完全一致
  entryRowH: 46,            // 每块底板的高度（CSS px）
  entryGap: 10,             // 底板与底板之间的间隔（CSS px）
  entryRadius: 10,          // 底板圆角半径（CSS px）
  entryBorderWidth: 1.5,    // 底板描边宽度（CSS px）：只给底板封个边，不抢内容
  // 底板的填充、悬停填充与描边不在这里另配：一律回读 COLOR.slotFill / slotFillSelected / slotBorder，
  // 与编辑器里那几块选项槽取同一组值，两边是同一种东西
  entryIconBox: 30,         // 入口图标外框的边长（CSS px）
  entryIconScale: 45,       // 入口图标的缩放系数：约 30 ÷ 0.66，三十像素的外框正好罩住齿轮那枚最大的图标
  entryIconTextGap: 12,     // 图标外框与入口文字之间的间隔（CSS px）
  entryTextSize: 16,        // 入口文字的字号（CSS px）
  entryTextWeight: 400,     // 入口文字的字重：原来是 500，为把字体从四档减到两档已归到正文那一档
  // 入口文字色同样回读 COLOR：常态用说明文字那一档 tipDesc，悬停升到名称那一档 tipName
  entryHoverScale: 0.98,    // 悬停时整块底板缩到的比例：绕底板中心缩，图标与文字一起，位置不跑
  entryPressedScale: 0.95,  // 按下时缩到的比例：比悬停更深，手感像真的按进去
  entryAnimDuration: 0.16,  // 入口反馈动画的时长（秒）：与编辑器里的选项槽同一档

  /* —— 两侧演示电路（第 5 节）—— */
  // 演示方框的格数不在这里写死：由场景里元件的包围盒算出来（见 home.js 的 demoReset），
  // 两侧方框的格数相同，所以全页仍然只有一格宽——背景网格与两侧演示共用同一个值
  demoCellMin: 24,          // 一格的屏幕边长下限（CSS px）：放不下它就开始淡出（第 7 节）
  demoHeightRatio: 0.82,    // 演示方框最多占窗口高度的比例：演示是竖长的，靠它防止顶天立地
  // 一格的上限直接取编辑器里一格的屏幕尺寸：首页与编辑器一格一样大，元件与激光的粗细就完全一致，
  // 两页看上去是同一套东西，而不是首页上另画一份放大版的示意
  demoCellMax: CONFIG.defaultScale,
  demoMicroDt: 0.25,        // 一个微帧对应的真实时长（秒）：演示电路按编辑器那套微帧节奏一格格结算，
                            // 拉长成 0.25 秒才看得清「光往前走一步」；编辑器本身是 0.12 秒
  demoHold: 1.2,            // 最后一个微帧走完之后停留的时长（秒）
  demoFadeOut: 0.5,         // 整组淡出的时长（秒）
  demoFadeIn: 0.5,          // 整组淡入的时长（秒）
  demoPhase: 0.5,           // 右侧滞后整个周期的比例：半个周期即可错开两边，不会同时亮同时灭
  demoCenterRatio: 0.5,     // 演示电路的中心占窗口高度的比例：0.5 即上下居中
  demoFadeBand: 60,         // 淡出的过渡带（CSS px，按可用宽度算）：宽度差多少，透明度就降多少
  // 激光两色也不另配：回读 COLOR.laserGlow 与 COLOR.laserCore，首页那一束与编辑器里那一束是同一束

  /* —— 弹窗（第 6 节）—— */
  tutorialW: 520,           // 教程窗宽度（CSS px）：与编辑器那份同宽
  tutorialH: 360,           // 教程窗高度（CSS px）：与编辑器那份同高，文字超出时里面的内容区自己滚
  aboutW: 420,              // 关于窗宽度（CSS px）：高度由内容定
  logW: 680,                // 日志窗宽度（CSS px）：比教程窗宽，一条日志要放得下版本号与一行简介
  logH: 560                 // 日志窗高度（CSS px）：版本多了由内容区自己滚，窗口不会被撑高
};

/* ========== 首页与编辑器之间的交接 ========== */

// 首页点「打开」时把刚读好的那份存档暂存在会话存储里，编辑器按这个键把它接过来铺到画布上，读完就清掉
// 首页不加载编辑器的任何脚本，所以这个键必须放在两页都会加载的 config.js 里，只有这一处写死
const HANDOFF_KEY = "laser-gate:pending-scene";  // string：暂存键名

// 首页跳往编辑器时缀在地址后面的标记：编辑器只在这个标记与暂存内容同时存在时才接着打开存档
// 它同时是「这次启动来自首页」的唯一凭据，所以和暂存键一样只有这一处写死
const HANDOFF_MARK = "#open";  // string：地址里的标记

/* 配色：网格蓝色系，背景淡蓝 */
const COLOR = {
  line: "#DCE5EE",        // 网格线：淡灰蓝，退到背景层，不与元件抢视线
  background: "#E8F1F8",  // 视口内背景：近白的冷蓝，只留一点色相
  border: "#D7E0E9",      // 视口边框：淡灰蓝细线，只用来交代边界
  panelFill: "#F7F9FB",   // 上方面板底板：近白冷灰，界面不再用彩色大底
  slotFill: "#FFFFFF",    // 选项槽填充：白底，元件图标自己承担颜色
  slotFillSelected: "#E3F2FD", // 选中槽填充：只保留一层很浅的蓝，与白底分得开又不刺眼
  slotBorder: "#DDE5EC",  // 选项槽描边：淡灰，常态不抢眼
  slotBorderSelected: "#1E88E5", // 选中槽描边：唯一的强调蓝，选中状态一眼可辨
  rightToolFill: "#FFFFFF", // 右侧工具栏方框的填充：白底，与竖栏的浅灰底分出格子
  iconClearBeam: "#6BC5FA",  // 清除图标里激光束的外层蓝：取自图标原文件
  iconClearBeamInner: "#4BBBFB", // 激光束里叠的那条稍深的蓝：两层叠出光束的中芯
  iconClearSlash: "#F04242", // 划过光束的红色斜杠：全图标唯一的暖色，一眼看出是「清除」
  iconStackLight: "#45A4ED", // 堆叠图标最上层（绘制顺序第一个，最终压在最下面）：取自图标原文件
  iconStackMid: "#339CF0",   // 堆叠图标中间那一层
  iconStackDeep: "#2696F2",  // 堆叠图标最后画的一层，因此盖在最上面
  iconStackStroke: "#156BC1", // 堆叠图标每一层的描边：深蓝，把三层的轮廓分开
  runIcon: "#1E9E52",     // 状态槽「运行中」的绿色：朝右三角形，在淡蓝底上够深也够亮
  pauseIcon: "#E04A4F",   // 状态槽「已暂停」的红色：两条竖杠，与绿色形成一眼可辨的对照
  stepIcon: "#1E9E52",    // 「前进一步」的绿色：与运行中的三角同色，两者是同一组步进控制
  tipFill: "#FFFFFF",     // 简介底板填充：白底，靠细边与阴影浮起来
  tipBorder: "#DDE5EC",   // 简介底板描边：与元件槽同一条淡灰细线
  tipName: "#1F2933",     // 简介里元件名称的文字色：中性近黑，不再整页深蓝
  tipDesc: "#5B6B7B",     // 简介里说明文字的颜色：中性次要灰，比名称低一档
  laserCore: "#3FC6FA",   // 激光光芯：浅亮蓝，比背景饱和、比元件描边浅，三层关系一眼分得开
  laserGlow: "#7FD4FF",   // 激光辉光：中浅蓝，比背景明显、比光芯略淡，多层叠起来才看得见光晕
  lampGlow: "#FF8A80",    // 灯被照亮时的光晕：淡红，透明度由亮起进度与峰值一起给
  selectBorder: "#1565C0", // 拉框描边：深蓝，压在淡蓝网格上边界清晰
  selectFill: "rgba(21, 101, 192, 0.14)", // 拉框的填充：同色低透明度，压得住网格又不遮住框里的元件
  // 查找结果不再在格子上画框：直接把结果里的元件本体染成橘黄，靠颜色本身说话，画面上不多出任何形状
  // 下面两种颜色只作为「染到多重」时的目标色，实际混合在 RGB 里做，不会绕色环串出别的颜色
  // 填充取柔和的浅橙、描边取偏深的赭橙，同色系一浅一深，与蓝色的常态色区分得开又不刺眼
  searchLitFill: { h: 32, s: 92, l: 66 },   // 橘黄填充：相当于 #F7B96B，压住深色描边，不脏也不荧光
  searchLitStroke: { h: 26, s: 76, l: 44 }, // 橘黄描边：相当于 #C47A22，比填充深一档，轮廓依旧清楚
  // 当前定位的那一组再往饱和里走一点：仍是橘黄一族，只是更实在，与其余结果分得开
  searchLitActiveFill: { h: 30, s: 96, l: 60 },   // 定位组的填充：更饱和的橙
  searchLitActiveStroke: { h: 24, s: 88, l: 38 }, // 定位组的描边：更深一档，轮廓更实
  // 闪两下时朝浅橙走：只在橘黄族内提亮，不会和蓝色底色混成一锅灰
  searchLitFlashFill: { h: 34, s: 94, l: 72 },    // 闪光峰值时的填充：只比常态亮一小截，不照成白
  searchLitFlashStroke: { h: 27, s: 86, l: 45 },  // 闪光峰值时的描边：跟着提亮但仍比填充深
  hintText: "#5B6B7B",    // 底栏提示文字：中性次要灰，不参与强调
  // 画布上标签与文本块的字色：近黑但不是纯黑（纯黑压在浅蓝上会显得生硬、也容易被读成没调过的默认值）
  // 往蓝偏一点点（约 hsl(214, 26%, 14%)），与整页的蓝色系同源，压在最浅那档蓝底上仍然很清楚
  labelText: "#1A222C"
};

// 画布上文字的字体族：与页面正文同族的 MiSans，底栏提示和以后画布上的其它文字都用它，避免各处各写一串
// 后面几项是字体尚未到位时的回退，与 css/style.css 里 html, body 那条保持一致
const UI_FONT = "\"MiSans\", -apple-system, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"; // string：画布文字字体族

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
  selectStroke: hslToRgb(selectLitHSL.stroke),
  searchFill: hslToRgb(COLOR.searchLitFill),    // 查找高亮的填充目标色：与其它端点一样先换算好，混合时只做乘加
  searchStroke: hslToRgb(COLOR.searchLitStroke), // 查找高亮的描边目标色
  searchActiveFill: hslToRgb(COLOR.searchLitActiveFill),    // 当前定位那一组的填充
  searchActiveStroke: hslToRgb(COLOR.searchLitActiveStroke), // 当前定位那一组的描边
  searchFlashFill: hslToRgb(COLOR.searchLitFlashFill),      // 闪光峰值时的填充
  searchFlashStroke: hslToRgb(COLOR.searchLitFlashStroke)   // 闪光峰值时的描边
};

// 设置齿轮与它所在槽的实际配色：画面取这里，是真正的颜色来源
const settingsHSL = {
  gearFill: { h: 207, s: 89, l: 55 },    // 齿轮填充：初值同元件填充
  gearStroke: { h: 210, s: 80, l: 42 },  // 齿轮描边：初值同元件描边
  slotFill: { h: 207, s: 70, l: 90 },   // 按钮点亮底板：很浅的蓝，与白底按钮分得开
  slotStroke: { h: 207, s: 78, l: 53 }   // 按钮点亮描边：强调蓝，点亮时一眼可见
};

// 元件选择面板各槽放的类型：下标即类型下标，第一个元件槽放的就是第 0 个类型
const PANEL_SLOT_TYPES = ["deflector", "transmitter", "light", "inverter", "lamp"];

// 「选中」工具槽的序号：插在所有元件槽的最左侧，所以是 0
// 它和元件槽一样占一个槽位、一样走悬停与按下的动画，但不是元件槽，不参与放置类型和简介
const SELECT_SLOT_INDEX = 0;

// 第一个元件槽的序号：紧跟在选中槽右边
// 元件槽的序号一律由它推算，以后还想在最左边再加工具槽，只改这一个数即可
const ELEMENT_SLOT_BASE = SELECT_SLOT_INDEX + 1;

// 「文本」工具槽的序号：紧跟在五个元件槽之后，正好落在面板末尾那一个预留位上
// 它和元件槽一样占一个槽、一样走悬停与按下的动画，但它不是元件槽：手指上不拿元件，虚影也不显示
// 序号由元件槽的数量推算，以后再加元件类型它会自动往后挪，不必回来改这里
const TEXT_SLOT_INDEX = ELEMENT_SLOT_BASE + PANEL_SLOT_TYPES.length;

// 设置按钮在槽动画数组里的下标：排在所有元件槽之后
// 给它一个正式序号，悬停与按下就自动走元件槽那同一套，不必再维护第二份状态，手感也不会走样
const SETTINGS_SLOT_INDEX = CONFIG.panelSlotCount;

// 教程按钮在槽动画数组里的下标：紧挨着设置按钮的左边，所以序号再往后一位
// 同样给正式序号，悬停与按下复用元件槽那套动画，两个按钮手感完全一致
const TUTORIAL_SLOT_INDEX = SETTINGS_SLOT_INDEX + 1;

// 判断某个槽序号是不是「元件槽」：元件槽才响应放置类型与简介，选中槽和两个按钮槽都不算
// 以后再加按钮时，只要它的序号排在元件槽之后，这里不必改
function isElementSlot(i) {
  return i >= ELEMENT_SLOT_BASE && i < ELEMENT_SLOT_BASE + PANEL_SLOT_TYPES.length;
}

// 判断某个槽序号是不是「可选中的槽」：选中槽、元件槽与文本槽都能点中并高亮，三个按钮槽不能
// 按钮槽有自己的开关状态，不参与选中，所以不能拿 isElementSlot 反过来当「不可选」
function isPickableSlot(i) {
  return i === SELECT_SLOT_INDEX || isElementSlot(i) || i === TEXT_SLOT_INDEX;
}

// WASD 对应的朝向索引：与元件的朝向索引同一套编号（0 上 1 右 2 下 3 左）
// 按键直接拨到目标朝向，只走最近的一条路，转多少交给旋转动画去补
const DIR_KEYS = { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 };

// 镜像时的朝向换算表：下标是原朝向，值是翻过之后的朝向（与上面同一套编号：0 上 1 右 2 下 3 左）
// 左右镜像只互换左右，上下镜像只互换上下；元件的形状在它自己的本地方位里左右对称，
// 所以「翻个面」只要把位置与朝向一起换掉，图形本身不必再做镜像
const MIRROR_DIR_H = [0, 3, 2, 1];   // Array<number>：左右镜像（H）
const MIRROR_DIR_V = [2, 1, 0, 3];   // Array<number>：上下镜像（V）

/* SVG 相关常量 */
const SVG_NS = "http://www.w3.org/2000/svg";

/* 元件类型表 */
