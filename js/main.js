// main.js：主循环与初始化入口。
"use strict";

/* ========== 主循环与入口 ========== */

// 主循环只负责算 dt、调用更新、调用渲染，不写具体逻辑
// 每个 t0 与紧随其后的 pe 是一对探针：探针关着时 pt() 返回 0、pe() 立刻返回，等于没这段代码
function frame(ts) {
  const scriptStart = performance.now();  // 脚本耗时起点：包住本帧全部更新与渲染，读数里的「脚本」就是它
  const dt = state.lastTs ? Math.min((ts - state.lastTs) / 1000, 0.1) : 0; // 钳制 dt，避免切回标签页时跳变
  state.lastTs = ts;
  let t0 = pt(); updateCamera(dt); updateSlotAnim(dt); updateSlotTip(dt); updateStackPanelTransform(); updateSearchFlash(dt); syncSearchPanel(); pe("相机与选项槽", t0);  // 堆叠设置框每帧按相机重摆，平移缩放时才会跟着地图走；查找框钉在视口右上角，闪光按帧推进
  // 每帧只重建一次活跃表：这一帧里所有「还要推进、还要单独画」的元件都从这张小表上走
  // 判据读的是此刻的真实状态，所以上一帧的输入改了什么，这一帧立刻就照顾到
  t0 = pt(); rebuildActiveEls(); pe("重建活跃表", t0);
  t0 = pt(); updateDeletions(dt);
  // 有元件刚放完消失动画就统一压实一次：摘掉之后元件下标全变，活跃表要跟着重建
  if (S.pendingCompact) { compactElements(); rebuildActiveEls(); }
  pe("删除与压实", t0);
  t0 = pt(); updateElementRotations(dt); updateSelectionAnim(dt); updateLampAnim(dt); updateMoveAnim(dt); updateOrbit(dt);
  pe("元件动画推进", t0);
  // 列表上的未保存标记：每帧只做一次布尔比较，状态真变了才去动那一行
  t0 = pt(); syncSidebarDirty(); pe("侧栏未保存标记", t0);
  t0 = pt(); stepSimulation(dt); pe("电路结算", t0);  // 按固定步长推进微帧时钟，本帧结算几个微帧由它决定
  t0 = pt(); updateGhost(dt); updateGhostRotation(dt); pe("虚影", t0);
  // 静止判定放在全部更新之后：静止、上帧也静止、又没有待重绘的变更时，整帧跳过渲染
  // 动画收尾那一帧上帧还不是静止，所以最终状态一定会被画出来，不会卡在中间态
  t0 = pt(); const settled = isSceneSettled(); pe("静止判定", t0);
  if (S.sceneDirty || !settled || !S.prevSettled) { render(); pcount("渲染帧", 1); }
  else pcount("跳帧", 1);
  S.prevSettled = settled;
  S.sceneDirty = false;
  markBootFrame();   // 首帧到此画完，遮挡层可以走了；boot.js 只认第一次，之后每帧再报都立刻回头
  const scriptEnd = performance.now();
  accumulatePerf(ts, scriptEnd - scriptStart);  // 读数只统计脚本耗时，浏览器的合成与空闲时间不计在内
  profReport(ts, scriptEnd - scriptStart);  // 探针开启时按阶段输出明细；关闭时它只做一次布尔判断
  requestAnimationFrame(frame);
}

// 初始化：拿上下文 → 调尺寸 → 竖栏的外观与列表 → 复位视图 → 建元件层 → 注入简介浮层外观 → 绑事件 → 启动主循环
function init() {
  // 第一句就摆好遮挡层：它必须从第一帧起就在，晚了就盖不住「画布还空着、竖栏还没摆好」的那一瞬
  initBootScreen();
  S.canvas = document.getElementById("gridCanvas");
  S.ctx = S.canvas.getContext("2d");
  resizeCanvas();
  initSidebarDom();  // 先把竖栏的宽度定下来：复位视图时要按「让出竖栏之后」的视口居中
  setupSidebarTree();  // 再把存档列表画出来并接上开合；列表目前是一份示意结构，不接任何真实文件
  resetView();
  initElementLayer();
  initPanelDom();       // 顶部面板与底栏：建槽与按钮、注入配色变量、摆位置，交互与状态同步交给 slots.js
  initSlotTipDom();
  initToastDom();        // 屏幕中间的小提示框：外观只注入一次，之后由 showToast 负责写话与淡出
  initSettingsPanelDom();
  initTutorialPanelDom();
  initConfirmPanelDom();  // 确认弹窗的外观与两个作答按钮，与教程弹窗同一套底板，只做一次
  initStackPanelDom();    // 堆叠设置框：控件绑定与外观注入，只做一次，之后开关只改显隐
  initSearchDom();        // 查找设置框：外观与按钮绑定，只做一次，之后开关只改显隐
  initLabelEditorDom();   // 元件标签的输入框：外观与确认弹窗同一套，键盘与两个按钮都只在这一处绑定
  initTextField();        // 浮动文本的原地输入框：内容变化、输入法三段、两个按键与失焦都只在这一处绑定
  setupDebugPanel();
  setupInput();
  // 先把上次用过的文件句柄读回内存，读完再检查「是不是从首页接着打开一份存档」
  // 顺序不能颠倒：接着打开那一步要把这份句柄接成「当前文件」，句柄还没读回来就接不上
  // 不在首页跳过来时它只是照常把句柄读回内存，供系统选择器定起始目录，与启动流程没别的牵连
  // 存档接完再把上次的工作区句柄读回来并试着接着打开：两件事互不依赖，但都会重画竖栏，
  // 串起来跑读起来是「先接手上的文档、再接手边的文件夹」这样一条线，也不会出现列表被前后画两遍
  loadPickerHandle().then(resumePendingScene).then(loadWorkspaceHandle).then(resumeWorkspace);
  requestAnimationFrame(frame);
  // 自带的 MiSans 排在样式表之后取：@font-face 就登记在那份样式表里，它没到之前点名取字只会立刻返回空
  // 取到之后标一次脏，下一帧按 MiSans 重画首帧上那些字；顺带报一句「字体落定」给遮挡层
  // 取不到字体也不耽误页面先跑起来，遮挡层那边另有兜底时间
  whenBootCssReady().then(loadUIFonts).then(() => { S.sceneDirty = true; markBootFonts(); });
}

init();
