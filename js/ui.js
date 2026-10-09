// ui.js：DOM 层的初始化：工作区竖栏、弹出面板（设置 / 文件 / 教程）。
"use strict";

/* ========== 工作区竖栏 ========== */

// 初始化左侧工作区竖栏：宽度与配色从 CONFIG / COLOR 注入，样式表里不重复写一份宽度
// 左、上、下各内缩一个 panelGap，与上方面板和底栏用同一个间隙：几块框的位置因此是同一套规矩，都不贴窗口边
// 只做定位以外的外观；栏里的存档列表由 sidebar.js 生成，与这里分工不重叠
function initSidebarDom() {
  const gap = CONFIG.panelGap;
  sidebarDom.style.left = gap + "px";             // 左侧同样留出间隙，不贴到窗口最左沿
  sidebarDom.style.top = gap + "px";              // 顶边与上方面板的顶边齐平
  sidebarDom.style.bottom = gap + "px";           // 底边与底栏的底边齐平
  sidebarDom.style.width = CONFIG.sidebarWidth + "px";
  sidebarDom.style.background = COLOR.panelFill;  // 与上方面板、底栏同色：整页的框是同一套
  sidebarDom.style.borderColor = COLOR.border;    // 与视口、面板边框同色，整页外框仍是一个色系
  sidebarDom.style.color = COLOR.tipDesc;
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
  const rows = dom.children;
  for (let i = 0; i < rows.length; i++) rows[i].style.height = CONFIG.settingsPanelRowH + "px";
}

// 初始化设置弹窗：注入通用外观，再单独接上它自己的三个控件
function initSettingsPanelDom() {
  initPopupDom(settingsPanelDom);
  // 面板里的控件只在这一处绑定：init 只跑一次，监听器不会重复注册
  gridSwitchDom.addEventListener("click", toggleGridRender);
  advSwitchDom.addEventListener("click", toggleAdvancedRender);
  speedSliderDom.addEventListener("input", onSpeedSliderInput);
  // 滑块的范围与初始位置都由配置推出来：HTML 里不写死刻度，改配置就能整体挪动
  speedSliderDom.min = "0";
  speedSliderDom.max = String(CONFIG.speedSliderSteps);
  speedSliderDom.step = "1";
  speedSliderDom.value = String(dtToSpeedSlider(CONFIG.microframeDt));
  microDt = speedSliderToDt(Number(speedSliderDom.value));  // 以滑块为准反推一次，保证首帧速度与显示位置严格一致
  updateSpeedValueLabel();                                  // 首帧也把数值写出来，不然打开设置面板时数字是空白的
}

// 初始化文件弹窗：注入通用外观，接上三个按钮，并把本地文件读写能力的检测结果写进那一行
// 以后往文件弹窗里加控件，绑定也写在这一处，init 只跑一次，监听器不会重复注册
function initFilePanelDom() {
  initPopupDom(filePanelDom);
  btnOpenDom.addEventListener("click", onOpenFile);
  btnSaveDom.addEventListener("click", onSaveFile);
  btnSaveAsDom.addEventListener("click", onSaveFileAs);
  btnImportSelDom.addEventListener("click", onImportSelection);
  btnExportSelDom.addEventListener("click", onExportSelection);
  // 按下按钮时不让它抢走焦点：按钮一旦留着焦点，之后再按回车会被浏览器当成又点了一次，
  // 而画布要靠焦点才能响应键盘，焦点不该被按钮占着。拦掉按下时的默认行为即可，点击照常触发
  filePanelDom.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains("btn")) e.preventDefault();
  });
  refreshFileName();
}

// 教程正文：这里按最终版面写成带层级的 HTML（导语 / 过渡句 / 编号步骤 / 关键词 / 结尾），不再是一整段纯文本
// 用模板字符串整段保存而不是塞进 HTML 标签，是为了让文字与它的排版样式待在同一处，改文案不必翻回标签里
// 这段文案由使用者本人撰写，这里只做分档排版与关键词强调、一个字不增不减；正文里的「底栏提示」指随状态变化的 hintText
const TUTORIAL_TEXT = `
<p class="tut-lead">你好！这是一个你可以随意探索的世界。激光是这里永恒的主题。它可以在元件之间传递，创造出各种各样激动人心的机器，或者任何你想做的东西。</p>
<p class="tut-hint">如果你不知道该干什么，就往下看：</p>
<ol class="tut-steps">
<li class="tut-step"><span class="tut-step-text">首先，我们可以创建一个万物之源：<b class="tut-key">光源</b>。选中它，在图上点击放置，再点击它，就可以让它发出激光。</span></li>
<li class="tut-step"><span class="tut-step-text">然后，你就可以遵循下面底栏的提示，<b class="tut-key">旋转</b>、<b class="tut-key">选中</b>元件，或者<b class="tut-key">调整视野</b>。</span></li>
<li class="tut-step"><span class="tut-step-text">把鼠标<b class="tut-key">悬停</b>在元件上，就能看到它是做什么用的。</span></li>
<li class="tut-step"><span class="tut-step-text">你可以把各种元件朝向不同方向放到激光的路径上，看看会发生什么。也不妨把<b class="tut-key">各种按钮</b>都试一试，它们有很多用处。</span></li>
</ol>
<p class="tut-end">祝你好运！</p>`;

// 初始化教程弹窗：注入与设置、文件两个弹窗同款的底板外观，再摆好尺寸、接上取消按钮
// 它不锚在按钮下方而是浮在屏幕正中，定位交给 CSS 的居中规则，所以这里只写尺寸与外观
function initTutorialPanelDom() {
  tutorialPanelDom.style.width = CONFIG.tutorialPanelW + "px";
  tutorialPanelDom.style.height = CONFIG.tutorialPanelH + "px";
  tutorialPanelDom.style.padding = CONFIG.settingsPanelPadY + "px " + CONFIG.settingsPanelPadX + "px";
  tutorialPanelDom.style.borderRadius = CONFIG.settingsPanelRadius + "px";
  tutorialPanelDom.style.background = COLOR.tipFill;      // 与另外两个弹窗同色：都是浮在网格上的浅蓝底板
  tutorialPanelDom.style.borderColor = COLOR.tipBorder;   // 与面板、视口边框同色，整页仍是同一套外框
  tutorialPanelDom.style.color = COLOR.tipDesc;
  tutorialPanelDom.style.fontSize = CONFIG.settingsPanelFontSize + "px";
  // 内容区的取色不走 CSS：色值统一从 COLOR 取，同一个蓝不在样式表和脚本里各写一份，免得日后改一处漏一处
  // 底色特意取「未选中」那一档的蓝（slotFill，比窗口底板深一级）：本项目里白色代表选中，
  // 铺白底会把整块内容区误读成选中态；压暗一级反而正好读成凹进去的一块阅读区
  tutorialDocDom.style.background = COLOR.slotFill;
  tutorialDocDom.style.color = COLOR.tipDesc;  // 说明文字色，压在深一级的蓝上仍读得清
  // 把教程正文自己的那套排版样式也装上：导语、过渡句、编号步骤、关键词药丸、结尾各有一档
  initTutorialDocStyle();
  // 把教程正文填进内容区：正文现在是有层级的 HTML，所以走 innerHTML；内容是本文件里的常量，不含任何外部输入
  // 只在这里赋值一次，之后开关窗口都沿用这份内容，不必每次重开都重写
  tutorialDocDom.innerHTML = TUTORIAL_TEXT;
  // 左上角那个叉形关闭按钮只在这一处绑定：init 只跑一次，监听器不会重复注册
  btnTutorialCancelDom.addEventListener("click", function () {
    tutorialOpen = false;  // 关掉教程窗口；内容不清空，下次再打开还是原来那份教程
  });
  // 按下按钮时不让它抢走焦点：与文件弹窗同样的处理，按钮只负责关窗，不需要长期持有焦点圈
  // 叉是画在按钮里的 SVG，但它的指针事件已经在样式里关掉了，所以这里拿到的 target 一定是按钮本身
  tutorialPanelDom.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains("btn")) e.preventDefault();
  });
}

// 注入教程正文的排版样式：字号一律用 em，跟着弹窗字号一起缩放；颜色全部从 COLOR 取，避免同一个蓝在样式表里再写一份
// 序号圆标用深蓝底配浅蓝字（tipName / tipFill），关键词药丸反过来（tipFill / tipName）：
// 本项目里白色代表选中，这两处都不碰白色，读到什么颜色都不会被误认成选中态
function initTutorialDocStyle() {
  const css =
    '.popup.modal .doc .tut-lead { margin: 0 0 6px; font-size: 1.05em; font-weight: 600; color: ' + COLOR.tipName + '; }' +
    '.popup.modal .doc .tut-hint { margin: 0 0 12px; font-size: 0.92em; opacity: 0.8; }' +
    '.popup.modal .doc .tut-steps { margin: 0; padding: 0; list-style: none; counter-reset: tut; }' +
    '.popup.modal .doc .tut-step { position: relative; margin: 0 0 10px; padding-left: 30px; }' +
    '.popup.modal .doc .tut-step:last-child { margin-bottom: 0; }' +
    '.popup.modal .doc .tut-step::before { content: counter(tut); counter-increment: tut;' +
    ' position: absolute; left: 0; top: 1px; width: 20px; height: 20px; line-height: 20px;' +
    ' border-radius: 50%; text-align: center; font-size: 12px; font-weight: 700;' +
    ' color: ' + COLOR.tipFill + '; background: ' + COLOR.tipName + '; }' +
    '.popup.modal .doc .tut-key { padding: 0 4px; border-radius: 4px; font-weight: 700;' +
    ' color: ' + COLOR.tipName + '; background: ' + COLOR.tipFill + '; }' +
    '.popup.modal .doc .tut-end { margin: 14px 0 2px; text-align: center; font-size: 1.05em;' +
    ' font-weight: 700; letter-spacing: 2px; color: ' + COLOR.tipName + '; }';
  const styleDom = document.createElement("style");
  styleDom.textContent = css;
  document.head.appendChild(styleDom);
}

/* ========== 确认弹窗 ========== */

// 弹一次确认框，问完把答案交回给等在后面的那段流程；true 表示用户点了右边那个确认键
// 用 Promise 而不是回调：调用处写 await askConfirm(...) 就能按平常的顺序往下写，
// 点头之后要做的事不必整段缩进到一个回调里去
function askConfirm(text) {
  return new Promise(function (resolve) {
    confirmTextDom.textContent = text;   // 问话是数据，用 textContent 写入，不做任何转义或拼接
    confirmResolve = resolve;
    confirmOpen = true;                  // 显隐交给主循环里的缓动去推，这里只改状态
  });
}

// 收起确认弹窗，并把答案交给等在后面的那段流程
// 没人在等时（窗口已经收起后又收到一次作答）就只是把状态摆正，不会重复叫醒
function settleConfirm(agree) {
  confirmOpen = false;
  const resolve = confirmResolve;
  confirmResolve = null;   // 先摘掉再叫醒：万一那段流程里又弹一次确认框，不会被这一次作答当成自己的答案
  if (resolve !== null) resolve(agree);
}

// 初始化确认弹窗：底板与教程、设置两个弹窗同款，只是窄一些，内容只有一句问话和两个按钮
// 两个按钮各自作答：右边表示同意（继续做那件会丢东西的事），左边表示放弃
function initConfirmPanelDom() {
  confirmPanelDom.style.width = CONFIG.confirmPanelW + "px";
  confirmPanelDom.style.padding = CONFIG.settingsPanelPadY + "px " + CONFIG.settingsPanelPadX + "px";
  confirmPanelDom.style.borderRadius = CONFIG.settingsPanelRadius + "px";
  confirmPanelDom.style.background = COLOR.tipFill;      // 与另外三个弹窗同色：都是浮在网格上的浅蓝底板
  confirmPanelDom.style.borderColor = COLOR.tipBorder;   // 与面板、视口边框同色，整页仍是同一套外框
  confirmPanelDom.style.color = COLOR.tipDesc;
  confirmPanelDom.style.fontSize = CONFIG.settingsPanelFontSize + "px";
  confirmTextDom.style.color = COLOR.tipName;            // 问话用深一档的蓝，比次要说明更显眼
  btnConfirmOkDom.addEventListener("click", function () { settleConfirm(true); });
  btnConfirmCancelDom.addEventListener("click", function () { settleConfirm(false); });
  // 按下按钮时不让它抢走焦点：与另外三个弹窗同一套处理，键盘要始终留给画布
  confirmPanelDom.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains("btn")) e.preventDefault();
  });
}

