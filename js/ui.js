// ui.js：DOM 层的初始化：工作区竖栏、弹出面板（设置 / 文件 / 教程）。
"use strict";

/* ========== 工作区竖栏 ========== */

// 初始化左侧工作区竖栏：宽度与配色从 CONFIG / COLOR 注入，样式表里不重复写一份宽度
// 左、上、下各内缩一个 panelGap，与上方面板和底栏用同一个间隙：几块框的位置因此是同一套规矩，都不贴窗口边
// 只做定位以外的外观；栏里的存档列表由 sidebar.js 生成，与这里分工不重叠
function initSidebarDom() {
  const gap = CONFIG.panelGap;
  S.sidebarDom.style.left = gap + "px";             // 左侧同样留出间隙，不贴到窗口最左沿
  S.sidebarDom.style.top = gap + "px";              // 顶边与上方面板的顶边齐平
  S.sidebarDom.style.bottom = gap + "px";           // 底边与底栏的底边齐平
  S.sidebarDom.style.width = CONFIG.sidebarWidth + "px";
  S.sidebarDom.style.background = COLOR.panelFill;  // 与上方面板、底栏同色：整页的框是同一套
  S.sidebarDom.style.borderColor = COLOR.border;    // 与视口、面板边框同色，整页外框仍是一个色系
  S.sidebarDom.style.color = COLOR.tipDesc;
  // 右侧工具栏与左侧竖栏同一套规矩：上下右各内缩一个 gap，配色同源，只是宽度按自己那份配置取
  // 两栏左右对称，上方那条面板与底栏夹在它们中间，整页的框仍然是一个整体
  S.rightBarDom.style.right = gap + "px";
  S.rightBarDom.style.top = gap + "px";
  S.rightBarDom.style.bottom = gap + "px";
  S.rightBarDom.style.width = CONFIG.rightbarWidth + "px";
  S.rightBarDom.style.background = COLOR.panelFill;
  S.rightBarDom.style.borderColor = COLOR.border;
  initRightBarTools();
}

// 在右侧工具栏里摆出一列方框：图标先不做，先把格子与配色定下来
// 格子紧挨着排、中间不留缝，圆角交给样式表，配色从 COLOR 取，与上方元件槽是同一套
// 只在这里生成一次：格子数量是配置里的固定值，之后加图标时往格子里填即可，不必重建整列
function initRightBarTools() {
  // 四个颜色挂在栏上做成变量：默认态与选中态各一对，样式表按变量取色，JS 只管加类
  // 取值与元件槽同一套（未选中取槽的常态色，选中取槽的提亮色），所以两处的「被选中」看起来是一回事
  S.rightBarToolsDom.style.setProperty("--rb-fill", COLOR.rightToolFill);
  S.rightBarToolsDom.style.setProperty("--rb-border", COLOR.slotBorder);
  S.rightBarToolsDom.style.setProperty("--rb-fill-on", COLOR.slotFillSelected);
  S.rightBarToolsDom.style.setProperty("--rb-border-on", COLOR.slotBorderSelected);
  for (let i = 0; i < CONFIG.rightToolCount; i++) {
    const box = document.createElement("div");
    box.className = "rb-tool";
    // 名称挂在格子自身的数据上：悬停时直接读它，不必再回头按下标查配置
    if (CONFIG.rightToolNames[i]) box.dataset.toolName = CONFIG.rightToolNames[i];
    // 按下时不让它抢走焦点：画布要靠焦点才能响应键盘，与文件弹窗里的按钮同一套处理
    box.addEventListener("mousedown", function (e) { e.preventDefault(); });
    // 悬停时排一个延时：停够 0.5 秒才在左侧写出这一格是什么，扫过去不弹小窗
    box.addEventListener("mouseenter", function () { scheduleRightBarTip(box); });
    box.addEventListener("mouseleave", hideRightBarTip);
    if (i === 0) {
      // 第一格是状态槽：只在自己的两个状态之间来回切，不参与选中，也就不会把别的格子顶掉
      box.classList.add("rb-state");
      box.appendChild(buildRunIcon(COLOR.runIcon));       // 状态一：绿色朝右三角
      box.appendChild(buildPauseIcon(COLOR.pauseIcon));   // 状态二：红色暂停号
      box.addEventListener("click", function () { toggleRightState(box); });
    } else if (i === 1) {
      // 第二格是「前进一步」：按一下只结算一个微帧，按钮本身不保留选中态
      box.appendChild(buildStepIcon(COLOR.stepIcon));
      box.addEventListener("click", function () { stepRightForward(); });
    } else if (i === 2) {
      // 第三格是「清除激光」：把画面上现存的激光与灯的亮起一次抹掉，按钮本身不保留选中态
      box.appendChild(buildClearLaserIcon());
      box.addEventListener("click", function () {
        clearLaserField();
        showToast("已清除所有激光");   // 这一步画面上只少了光，用一句提示确认动作真的发生了
      });
    } else if (i === 3) {
      // 第四格是「堆叠」：选中一批元件后点它，浮出堆叠设置框；开着再点等于取消
      box.appendChild(buildStackIcon());
      box.addEventListener("click", function () { toggleStackPanel(); });
    } else if (i === 4) {
      // 第五格是「查找」：点它开或关视口右上角的查找设置框；框里按选区里的元件组合去整份电路里找同样的组合
      box.appendChild(buildSearchIcon(COLOR.tipName));
      box.addEventListener("click", function () { toggleSearchPanel(); });
    } else {
      // 点击落到第几格就选中第几格：闭包里的 i 是当次生成的值，不会随循环变化
      box.addEventListener("click", function () { selectRightTool(i); });
    }
    S.rightBarToolsDom.appendChild(box);
  }
  // 栏内滚动时名称小窗会留在原地，直接收起最省事：指针再停上去会重新算位置
  S.rightBarDom.addEventListener("scroll", hideRightBarTip);
}

// 排一个延时的名称显示：每次进入新格子都先把上一个待显示的任务取消，指针扫过去时一列里只会响最后一次
function scheduleRightBarTip(box) {
  clearTimeout(S.rightBarTipTimer);
  S.rightBarTipTimer = setTimeout(function () {
    S.rightBarTipTimer = 0;
    showRightBarTip(box);
  }, CONFIG.rightBarTipDelay * 1000);
}

// 在悬停格子的左侧弹出名称：先写入文字并显示，再量尺寸定位
// 右边缘与格子左边缘留 8px，垂直方向以格子中线对齐，读起来就是「这格叫什么」
function showRightBarTip(box) {
  const name = box.dataset.toolName;
  if (!name) return;   // 这一格还没功能，也就没有名字，不弹小窗
  S.rightBarTipDom.textContent = name;
  S.rightBarTipDom.style.display = "block";
  const r = box.getBoundingClientRect();
  const tw = S.rightBarTipDom.offsetWidth;
  const th = S.rightBarTipDom.offsetHeight;
  S.rightBarTipDom.style.left = (r.left - 8 - tw) + "px";
  S.rightBarTipDom.style.top = (r.top + (r.height - th) / 2) + "px";
}

// 收起名称小窗：顺手把待显示的延时也取消，指针离开后就不会再冒出来
function hideRightBarTip() {
  clearTimeout(S.rightBarTipTimer);
  S.rightBarTipTimer = 0;
  S.rightBarTipDom.style.display = "none";
}

// 状态槽的「运行中」图标：一个朝右的等边三角形
// 描边用同色并取圆角连接，把三个尖角稍微磨圆一点，与元件那套圆角风格一致，也免得小尺寸下发尖
function buildRunIcon(color) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("class", "rb-ico rb-ico-play");
  const tri = document.createElementNS(SVG_NS, "path");
  tri.setAttribute("d", "M6.6 4.4 L15.6 10 L6.6 15.6 Z");
  tri.setAttribute("fill", color);
  tri.setAttribute("stroke", color);
  tri.setAttribute("stroke-width", "2");
  tri.setAttribute("stroke-linejoin", "round");
  svg.appendChild(tri);
  return svg;
}

// 「清除激光」图标：一道淡蓝激光束被两道红斜杠划断，形状与配色照搬项目根目录那份图标原文件
// 原图是画在 A4 页面上的毫米坐标，这里整段抄用原坐标，再用一次变换把它摆进 20×20 的图标框：
// 先移到原图形的几何中心，再等比放大到约 13 像素宽，最后落到图标框中央；比例与层叠关系都不改动
function buildClearLaserIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("class", "rb-ico rb-ico-clear");
  // 原图范围：横向 106.634～118.777，纵向 139.352～149.386，中心 (112.706, 144.369)
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("transform", "translate(10 10) scale(1.4) translate(-112.706 -144.369)");
  // 光束外层：一条较粗的蓝长条
  const beam = document.createElementNS(SVG_NS, "rect");
  beam.setAttribute("x", "106.63428");
  beam.setAttribute("y", "142.39221");
  beam.setAttribute("width", "12.142752");
  beam.setAttribute("height", "3.9532723");
  beam.setAttribute("fill", COLOR.iconClearBeam);
  g.appendChild(beam);
  // 光束内芯：同宽、略矮、略深的一条，叠在外层上形成光带的中芯
  const core = document.createElementNS(SVG_NS, "rect");
  core.setAttribute("x", "106.63428");
  core.setAttribute("y", "143.00395");
  core.setAttribute("width", "12.142752");
  core.setAttribute("height", "2.7297897");
  core.setAttribute("fill", COLOR.iconClearBeamInner);
  g.appendChild(core);
  // 两道红色斜杠：原图的路径数据原样搬来，斜度与间距都不改
  const slash = document.createElementNS(SVG_NS, "path");
  slash.setAttribute("d", "m 115.64192,139.35184 -2.41484,2.69337 h 3.12332 l 2.41484,-2.69337 z" +
    " m -6.58151,7.34115 -2.41433,2.69286 h 3.12333 l 2.41432,-2.69286 z");
  slash.setAttribute("fill", COLOR.iconClearSlash);
  g.appendChild(slash);
  svg.appendChild(g);
  return svg;
}

// 「堆叠」图标：三枚同形的楔子朝右上错开叠在一起，形状、偏移与配色都照搬根目录那份图标文件
// 原图用毫米坐标：每枚是 0.45×0.61 的局部图形放大约 37 倍，相邻两枚错开 6、3 毫米
// 顶部那道圆弧走的是大弧，圆头整个探到 y≈-0.365 一带，三枚合起来是 33.2 宽、37.8 高的一道竖长形
// 这里保留内层的局部坐标与各自那份矩阵，只在外层用一次变换把整体等比摆进 20×20 的图标框
// 外层变换的中心按含描边的真实外框取 (102.532, 122.663)；缩放取 0.49 使整体约 18.5 高，框内四边都留出余量
// 绘制顺序也照搬原文件：由浅到深依次画，深色的最后落笔，压在最上面
function buildStackIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("class", "rb-ico rb-ico-stack");
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("transform", "translate(10 10) scale(0.49) translate(-102.532 -122.663)");
  // 一枚楔子的局部轮廓：底边在 y=0.365，顶点朝上，中间那段圆弧是顶部的圆头
  const d = "m -0.225,0.365 0.179354,-0.478277 a 0.13,0.13 0 1 1 0.091292,0 L 0.225,0.365 Z";
  const layers = [
    { tx: 108.53172, ty: 119.66293, fill: COLOR.iconStackLight },  // 最上一枚：配色最浅
    { tx: 102.532, ty: 122.66293, fill: COLOR.iconStackMid },      // 中间一枚
    { tx: 96.531745, ty: 125.66313, fill: COLOR.iconStackDeep }    // 最下一枚：配色最深，画在最后
  ];
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    // 每枚自己的缩放与位置：原图就是四个矩阵值，按同一份照抄
    const one = document.createElementNS(SVG_NS, "g");
    one.setAttribute("transform", "matrix(37.141677 0 0 37.435446 " + L.tx + " " + L.ty + ")");
    // 先画带描边的那份：描边露在轮廓外侧，把相邻两枚分开
    const outlined = document.createElementNS(SVG_NS, "path");
    outlined.setAttribute("d", d);
    outlined.setAttribute("fill", L.fill);
    outlined.setAttribute("stroke", COLOR.iconStackStroke);
    outlined.setAttribute("stroke-width", "0.12");
    outlined.setAttribute("stroke-linejoin", "round");
    one.appendChild(outlined);
    // 再叠一份纯填充的：盖住描边内侧那一半，只剩外面一圈，与原图的层叠效果一致
    const solid = document.createElementNS(SVG_NS, "path");
    solid.setAttribute("d", d);
    solid.setAttribute("fill", L.fill);
    one.appendChild(solid);
    g.appendChild(one);
  }
  svg.appendChild(g);
  return svg;
}

// 状态槽的「已暂停」图标：两条圆头竖杠，间距取一个杠宽左右，缩到 17px 也分得开
function buildPauseIcon(color) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("class", "rb-ico rb-ico-pause");
  const left = document.createElementNS(SVG_NS, "rect");
  left.setAttribute("x", "5.7");
  left.setAttribute("y", "4.4");
  left.setAttribute("width", "3.4");
  left.setAttribute("height", "11.2");
  left.setAttribute("rx", "1.4");
  left.setAttribute("fill", color);
  const right = document.createElementNS(SVG_NS, "rect");
  right.setAttribute("x", "10.9");
  right.setAttribute("y", "4.4");
  right.setAttribute("width", "3.4");
  right.setAttribute("height", "11.2");
  right.setAttribute("rx", "1.4");
  right.setAttribute("fill", color);
  svg.appendChild(left);
  svg.appendChild(right);
  return svg;
}

// 「前进一步」的图标：朝右三角加一条竖杠，含义是「走到下一帧就停」
// 与运行中的三角同一套画法（同色描边、圆角连接），两者摆在一起看得出是同一个家族的步进控制
function buildStepIcon(color) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("class", "rb-ico rb-ico-step");
  const tri = document.createElementNS(SVG_NS, "path");
  tri.setAttribute("d", "M4.6 4.6 L12.4 10 L4.6 15.4 Z");
  tri.setAttribute("fill", color);
  tri.setAttribute("stroke", color);
  tri.setAttribute("stroke-width", "2");
  tri.setAttribute("stroke-linejoin", "round");
  svg.appendChild(tri);
  // 右侧竖杠压在三角形尖上：左沿与三角描边的外沿相接，两笔看起来是一整块而不是分开的两段
  const bar = document.createElementNS(SVG_NS, "rect");
  bar.setAttribute("x", "13.2");
  bar.setAttribute("y", "4.2");
  bar.setAttribute("width", "2.6");
  bar.setAttribute("height", "11.6");
  bar.setAttribute("rx", "1.2");
  bar.setAttribute("fill", color);
  svg.appendChild(bar);
  return svg;
}

// 「查找」的图标：一枚放大镜，圆环加一根斜向手柄
// 圆环取描边不填充，手柄从圆环右下沿接出去并取圆头，两者粗细一致，缩到 21px 也看得出是一枚镜子
function buildSearchIcon(color) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("class", "rb-ico rb-ico-search");
  const ring = document.createElementNS(SVG_NS, "circle");
  ring.setAttribute("cx", "8.6");
  ring.setAttribute("cy", "8.6");
  ring.setAttribute("r", "5.2");
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke", color);
  ring.setAttribute("stroke-width", "2");
  svg.appendChild(ring);
  const handle = document.createElementNS(SVG_NS, "path");
  handle.setAttribute("d", "M12.4 12.4 L16.2 16.2");
  handle.setAttribute("fill", "none");
  handle.setAttribute("stroke", color);
  handle.setAttribute("stroke-width", "2.4");
  handle.setAttribute("stroke-linecap", "round");
  svg.appendChild(handle);
  return svg;
}

// 「前进一步」：只结算一个微帧，元件间那 1 微帧的延迟照旧，与正常运行走的是同一套逻辑
// 运行中点它先切到暂停，否则下一帧时钟立刻把这一步推走，单步的效果看不出来
// 余数一并清零：暂停期间攒下的时间若留着，恢复运行时会一次性补算成几十个微帧
function stepRightForward() {
  if (S.rightToolRunning) toggleRightState(S.rightBarToolsDom.children[0]);
  S.microAcc = 0;
  stepMicroframe();
  S.sceneDirty = true;   // 哪怕本微帧没有差异也重画一次，画面与刚走完的状态保持一致
}

// 切换状态槽：翻转运行状态与 paused 类，两个图标由样式表按类露出其一
// 这一刻同时接管电路结算的总闸：暂停后微帧时钟不再走，恢复后从当前状态接着算
// 恢复时清掉时间余数并按当前几何把激光场摆正，避免暂停期间改过的电路在恢复的第一帧出现旧光
function toggleRightState(box) {
  S.rightToolRunning = !S.rightToolRunning;
  box.classList.toggle("paused", !S.rightToolRunning);
  S.microAcc = 0;
  if (S.rightToolRunning) {
    refreshLightField();   // 按当前元件与朝向重算一遍光场，与恢复后的时钟从同一状态起步
    S.sceneDirty = true;
  }
}

// 键盘触发右侧工具栏格子时补一次反馈：缩放值与鼠标悬停完全相同，维持一小段后自动松开
// 时长与元件槽的键盘反馈一致，两种入口看到的收缩节奏不会一个快一个慢
function pressRightBarBox(box) {
  box.classList.add("press");
  clearTimeout(box.pressTimer);   // 连按同一格时重新计时，不会提前松开
  box.pressTimer = setTimeout(function () {
    box.classList.remove("press");
  }, CONFIG.panelSlotKeyPressDuration * 1000);
}

// 选中右侧工具栏的第几格：单选，点新的就把旧的取消掉；点已经选中的那一格不做动作
// 只改状态与类名，颜色与缩放的过渡都交给样式表，这里不逐帧推进任何动画
function selectRightTool(index) {
  if (S.rightToolSelected === index) return;
  S.rightToolSelected = index;
  const boxes = S.rightBarToolsDom.children;
  for (let i = 0; i < boxes.length; i++) {
    boxes[i].classList.toggle("on", i === index);
  }
}

/* ========== 中间提示 ========== */

// 提示框的外观一次性注入：底色、描边、文字色取与弹窗同一套，淡出时长与配置保持一处定义
function initToastDom() {
  S.toastDom.style.background = COLOR.tipFill;
  S.toastDom.style.borderColor = COLOR.tipBorder;
  S.toastDom.style.color = COLOR.tipName;
  S.toastDom.style.fontSize = CONFIG.toastFontSize + "px";
  S.toastDom.style.transitionDuration = CONFIG.toastFade + "s";
}

// 在网格视口正中报一句短话：停留三秒后自己淡出，淡完再把容器收起来
// 连着报几句时倒计时从最后一句重新数；已经在显示就直接换字，不重放淡入，免得多说一句就闪一下
function showToast(text) {
  const dom = S.toastDom;
  dom.textContent = text;
  // 每次弹出都按当前视口重新定位：窗口刚换过尺寸时，提示框仍落在网格区域的中心
  const vp = getViewport();
  dom.style.left = (vp.x + vp.w / 2) + "px";
  dom.style.top = (vp.y + vp.h / 2) + "px";
  if (!dom.classList.contains("show")) {
    dom.style.display = "block";
    // 先让浏览器把「刚显示、全透明」认作当前状态，下一帧再加可见类，淡入才会真的走过渡
    requestAnimationFrame(function () {
      dom.classList.add("show");
    });
  }
  clearTimeout(S.toastHoldTimer);
  clearTimeout(S.toastFadeTimer);
  // 停留倒计时：到点摘掉可见类，透明度按样式表里那条过渡落到 0，这就是「三秒后淡出」
  S.toastHoldTimer = setTimeout(function () {
    S.toastHoldTimer = 0;
    dom.classList.remove("show");
    // 淡完再收起来：留在画面上的透明空壳虽然不接点击，但不必一直挂着
    S.toastFadeTimer = setTimeout(function () {
      S.toastFadeTimer = 0;
      dom.style.display = "none";
    }, CONFIG.toastFade * 1000);
  }, CONFIG.toastHold * 1000);
}

/* ========== 弹出面板（设置 / 文件） ========== */

// 弹窗位置：右边缘与所锚定按钮槽的右内沿对齐，顶边贴在上方面板矩形下边缘之下
// 传哪个按钮的矩形就挂在哪个按钮正下方，两个弹窗共用这一条定位规则，宽度也保持一致
function popupPanelRect(vp, anchorRect) {
  return {
    x: anchorRect.x + anchorRect.w - CONFIG.settingsPanelWidth,
    y: vp.y - CONFIG.panelGap + CONFIG.settingsPanelGap,
    w: CONFIG.settingsPanelWidth
  };
}

// 把弹窗的通用外观一次性从 CONFIG / COLOR 注入到 DOM：与简介浮层同一套做法，样式不必每帧重写
// 两个弹窗都走它，底板色、圆角、内边距、字号因此天然一致，改一处两边同时生效
function initPopupDom(dom) {
  dom.style.padding = CONFIG.settingsPanelPadY + "px " + CONFIG.settingsPanelPadX + "px";
  dom.style.borderRadius = CONFIG.settingsPanelRadius + "px";
  dom.style.background = COLOR.tipFill;      // 与简介浮层同色：都是浮在网格上的浅蓝底板
  dom.style.borderColor = COLOR.tipBorder;   // 与面板、视口边框同色，整页仍是同一套外框
  dom.style.color = COLOR.tipDesc;
  dom.style.fontSize = CONFIG.settingsPanelFontSize + "px";
  // 行高逐行写死：以后往行里塞控件时高度不会因内容变化而抖
  // 只给行与按钮设，专栏标题那种分组的文字行不设高度，让它的上边距与下边距自己撑开
  const rows = dom.children;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.classList.contains("row") || r.classList.contains("btn")) {
      r.style.height = CONFIG.settingsPanelRowH + "px";
    }
  }
}

// 初始化设置弹窗：注入通用外观，再单独接上它自己的三个控件
function initSettingsPanelDom() {
  initPopupDom(S.settingsPanelDom);
  // 面板里的控件只在这一处绑定：init 只跑一次，监听器不会重复注册
  S.gridSwitchDom.addEventListener("click", toggleGridRender);
  S.advSwitchDom.addEventListener("click", toggleAdvancedRender);
  S.speedSliderDom.addEventListener("input", onSpeedSliderInput);
  S.renderPrecisionSliderDom.addEventListener("input", onRenderPrecisionInput);
  S.zoomRefreshSliderDom.addEventListener("input", onZoomRefreshInput);
  S.wheelSwitchDom.addEventListener("click", toggleWheelPan);
  // 滑块的范围与初始位置都由配置推出来：HTML 里不写死刻度，改配置就能整体挪动
  S.speedSliderDom.min = "0";
  S.speedSliderDom.max = String(CONFIG.speedSliderSteps);
  S.speedSliderDom.step = "1";
  S.speedSliderDom.value = String(dtToSpeedSlider(CONFIG.microframeDt));
  S.microDt = speedSliderToDt(Number(S.speedSliderDom.value));  // 以滑块为准反推一次，保证首帧速度与显示位置严格一致
  updateSpeedValueLabel();                                  // 首帧也把数值写出来，不然打开设置面板时数字是空白的
  // 渲染精度滑块：范围与步长都取自配置，步长取 0.1 让「连续」这件事真的连续，而不是只剩几个档位
  S.renderPrecisionSliderDom.min = String(CONFIG.renderPrecisionMin);
  S.renderPrecisionSliderDom.max = String(CONFIG.renderPrecisionMax);
  S.renderPrecisionSliderDom.step = "0.1";
  S.renderPrecisionSliderDom.value = String(CONFIG.renderPrecisionDefault);
  updateRenderPrecisionLabel();   // 首帧写出精度读数，与画布此刻用的像素比一致
  // 缩放刷新速度滑块：步长取 0.05，1.05 到 3 之间都能连续调
  S.zoomRefreshSliderDom.min = String(CONFIG.zoomRefreshMin);
  S.zoomRefreshSliderDom.max = String(CONFIG.zoomRefreshMax);
  S.zoomRefreshSliderDom.step = "0.05";
  S.zoomRefreshSliderDom.value = String(CONFIG.zoomRefreshDefault);
  updateZoomRefreshLabel();       // 首帧写出阈值读数
  // 全部控件都摆好之后才读回上次的设置：上面这几句定的是默认值，读回的那几项会覆盖掉它们
  loadSettings();
}

// 初始化教程弹窗：注入与设置弹窗同款的底板外观，再摆好尺寸、接上取消按钮
// 它不锚在按钮下方而是浮在屏幕正中，定位交给 CSS 的居中规则，所以这里只写尺寸与外观
function initTutorialPanelDom() {
  S.tutorialPanelDom.style.width = CONFIG.tutorialPanelW + "px";
  S.tutorialPanelDom.style.height = CONFIG.tutorialPanelH + "px";
  S.tutorialPanelDom.style.padding = CONFIG.settingsPanelPadY + "px " + CONFIG.settingsPanelPadX + "px";
  S.tutorialPanelDom.style.borderRadius = CONFIG.settingsPanelRadius + "px";
  S.tutorialPanelDom.style.background = COLOR.tipFill;      // 与另外两个弹窗同色：都是浮在网格上的浅蓝底板
  S.tutorialPanelDom.style.borderColor = COLOR.tipBorder;   // 与面板、视口边框同色，整页仍是同一套外框
  S.tutorialPanelDom.style.color = COLOR.tipDesc;
  S.tutorialPanelDom.style.fontSize = CONFIG.settingsPanelFontSize + "px";
  // 内容区的取色不走 CSS：色值统一从 COLOR 取，同一个蓝不在样式表和脚本里各写一份，免得日后改一处漏一处
  // 底色特意取「未选中」那一档的蓝（slotFill，比窗口底板深一级）：本项目里白色代表选中，
  // 铺白底会把整块内容区误读成选中态；压暗一级反而正好读成凹进去的一块阅读区
  S.tutorialDocDom.style.background = COLOR.slotFill;
  S.tutorialDocDom.style.color = COLOR.tipDesc;  // 说明文字色，压在深一级的蓝上仍读得清
  // 把教程正文自己的那套排版样式也装上：导语、过渡句、编号步骤、关键词药丸、结尾各有一档
  initTutorialDocStyle();
  // 把教程正文填进内容区：正文现在是有层级的 HTML，所以走 innerHTML；内容是本文件里的常量，不含任何外部输入
  // 只在这里赋值一次，之后开关窗口都沿用这份内容，不必每次重开都重写
  S.tutorialDocDom.innerHTML = TUTORIAL_TEXT;
  // 左上角那个叉形关闭按钮只在这一处绑定：init 只跑一次，监听器不会重复注册
  S.btnTutorialCancelDom.addEventListener("click", function () {
    S.tutorialOpen = false;  // 关掉教程窗口；内容不清空，下次再打开还是原来那份教程
  });
  // 按下按钮时不让它抢走焦点：与文件弹窗同样的处理，按钮只负责关窗，不需要长期持有焦点圈
  // 叉是画在按钮里的 SVG，但它的指针事件已经在样式里关掉了，所以这里拿到的 target 一定是按钮本身
  S.tutorialPanelDom.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains("btn")) e.preventDefault();
  });
}

// 注入教程正文的排版样式：正文与样式都放在 tutorial-content.js，编辑器与首页共用同一份
// 这样两页的教程一字不差，改文案或改排版只需改那一个文件
// （函数本体在 tutorial-content.js 里，这里不再重复一份）

/* ========== 确认弹窗 ========== */

// 弹一次确认框，问完把答案交回给等在后面的那段流程；true 表示用户点了右边那个确认键
// 用 Promise 而不是回调：调用处写 await askConfirm(...) 就能按平常的顺序往下写，
// 点头之后要做的事不必整段缩进到一个回调里去
// okLabel 是右边那个键上写什么字，不给就沿用「丢弃」：问话换了场合，那个键该说什么也跟着换，
// 删除时写成「删除」，用户才清楚按下去会发生什么，而不是对着一句「丢弃」猜
function askConfirm(text, okLabel) {
  return new Promise(function (resolve) {
    S.confirmTextDom.textContent = text;   // 问话是数据，用 textContent 写入，不做任何转义或拼接
    S.btnConfirmOkDom.textContent = okLabel === undefined ? "丢弃" : okLabel;
    S.confirmResolve = resolve;
    S.confirmOpen = true;                  // 显隐交给主循环里的缓动去推，这里只改状态
  });
}

// 收起确认弹窗，并把答案交给等在后面的那段流程
// 没人在等时（窗口已经收起后又收到一次作答）就只是把状态摆正，不会重复叫醒
function settleConfirm(agree) {
  S.confirmOpen = false;
  const resolve = S.confirmResolve;
  S.confirmResolve = null;   // 先摘掉再叫醒：万一那段流程里又弹一次确认框，不会被这一次作答当成自己的答案
  if (resolve !== null) resolve(agree);
}

// 初始化确认弹窗：底板与教程、设置两个弹窗同款，只是窄一些，内容只有一句问话和两个按钮
// 两个按钮各自作答：右边表示同意（继续做那件会丢东西的事），左边表示放弃
function initConfirmPanelDom() {
  S.confirmPanelDom.style.width = CONFIG.confirmPanelW + "px";
  S.confirmPanelDom.style.padding = CONFIG.settingsPanelPadY + "px " + CONFIG.settingsPanelPadX + "px";
  S.confirmPanelDom.style.borderRadius = CONFIG.settingsPanelRadius + "px";
  S.confirmPanelDom.style.background = COLOR.tipFill;      // 与另外三个弹窗同色：都是浮在网格上的浅蓝底板
  S.confirmPanelDom.style.borderColor = COLOR.tipBorder;   // 与面板、视口边框同色，整页仍是同一套外框
  S.confirmPanelDom.style.color = COLOR.tipDesc;
  S.confirmPanelDom.style.fontSize = CONFIG.settingsPanelFontSize + "px";
  S.confirmTextDom.style.color = COLOR.tipName;            // 问话用深一档的蓝，比次要说明更显眼
  S.btnConfirmOkDom.addEventListener("click", function () { settleConfirm(true); });
  S.btnConfirmCancelDom.addEventListener("click", function () { settleConfirm(false); });
  // 按下按钮时不让它抢走焦点：与另外三个弹窗同一套处理，键盘要始终留给画布
  S.confirmPanelDom.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains("btn")) e.preventDefault();
  });
}

/* ========== 控制台探针（仅测试用） ========== */

// __rbPress(i)：手动播一次右侧工具栏第 i 格的按下反馈，不必按 Shift
// 用来确认键盘这条路径的收缩动画是否真的在跑；返回 false 表示没有这一格
window.__rbPress = function (i) {
  const box = S.rightBarToolsDom.children[i | 0];
  if (!box) return false;
  pressRightBarBox(box);
  return true;
};

// __rbProbe()：读回每格此刻的 transform，0.93 表示正处于键盘反馈中、none 表示已回弹
window.__rbProbe = function () {
  return Array.prototype.map.call(S.rightBarToolsDom.children, function (b) {
    return getComputedStyle(b).transform;
  });
};

