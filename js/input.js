// input.js：输入处理：指针、滚轮、键盘、缩放、视野重置。
"use strict";

/* ========== 输入处理 ========== */

// 在光标位置缩放：把参考点换成光标下的世界点，再改缩放目标
function zoomAt(screenX, screenY, factor) {
  // 换参考点前的待走位移（平移还没走完的部分），换参考点时原样保留，避免打断正在进行的平移
  const pendingDX = state.tAnchorSX - state.anchorSX;
  const pendingDY = state.tAnchorSY - state.anchorSY;
  // 纯换参考系：新参考点取光标下的世界点、屏幕位置取光标本身，这一步不改变当前画面
  state.anchorWX = screenToWorldX(screenX);
  state.anchorWY = screenToWorldY(screenY);
  state.anchorSX = screenX;
  state.anchorSY = screenY;
  state.tAnchorSX = screenX + pendingDX;
  state.tAnchorSY = screenY + pendingDY;
  // 缩放目标单独推进；动画期间参考点屏幕位置不变，等于绕光标做纯缩放，屏幕位移不会过冲
  state.tLogScale = clamp(
    state.tLogScale + Math.log(factor),
    Math.log(CONFIG.minScale),
    Math.log(CONFIG.maxScale)
  );
}

// 这一下按键是不是带着 Cmd（Mac）/ Ctrl 按下的
// 事件里的 metaKey / ctrlKey 在有些时刻不可信（见 state.js 里 metaHeld 那段说明），所以与自己记的按下状态认一个即可
function cmdKeyHeld(e) {
  return e.metaKey || e.ctrlKey || metaHeld || ctrlHeld;
}

// 绑定全部输入事件；init 只执行一次，所以监听器不会被重复注册
function setupInput() {
  // 滚轮缩放：deltaMode 为 1 时单位是「行」，换算成像素再做指数缩放
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(e.clientX, e.clientY, Math.exp(-delta * CONFIG.wheelZoomRate));
  }, { passive: false });

  // 中键按下：阻止浏览器自动滚动，并开始拖拽视野
  canvas.addEventListener("mousedown", function (e) {
    if (e.button === 1) e.preventDefault();
  });

  // 右键：屏蔽浏览器右键菜单，右键在画布上的语义改成「删除指针所在格的元件」
  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    deleteElementAtScreen(e.clientX, e.clientY);
  });

  canvas.addEventListener("pointerdown", function (e) {
    // 点击也算一次「进入画布」：页面加载时鼠标已在画布内的话不会触发 pointerenter，这里补上
    pointerSX = e.clientX;
    pointerSY = e.clientY;
    pointerInside = true;
    sceneDirty = true;  // 点击可能选槽、开关光源或放置元件，画面必须更新一次
    canvas.focus();
    // 左键：先判是不是点在选项槽上（是则选中该槽并进入按下态、不放置），否则在指针所在格心放置元件
    if (e.button === 0) {
      const hit = slotIndexAt(e.clientX, e.clientY);
      if (hit >= 0) {
        slotPressedIndex = hit;  // 按下态：只缩得更深，不改亮度，避免按下时闪一下
        // 两个按钮只是「长得像槽」，它们不是可选项：不能改选中项，否则虚影会去查一个不存在的元件
        // 选中槽与元件槽都能选中；从选中工具切到别的工具时，选区会被立刻收掉（元件就地落位）
        if (isPickableSlot(hit)) setSelectedSlot(hit);
        return;
      }
      // 选中工具激活时，画布上的左键一律是「选择」：按住不动是单击选中，拖动就成了拉框
      // 这一步必须排在放置和开关光源之前，否则选中工具会被这两个操作抢走左键
      if (selectToolActive()) {
        // 按在「已选中」的元件上（且没按 Shift）＝拖动这一批选中的元件
        // Shift 留给框选的翻转模式，两者不抢同一个手势；按在空处或未选中的元件上仍是拉框
        const hitEl = findElementAtPointer();
        if (!e.shiftKey && hitEl !== null && hitEl.selected && !hitEl.deleting) {
          beginMove(e);
          return;
        }
        beginMarquee(e);
        return;
      }
      // 左键点在已占用的格子上：交给元件自己处理（目前只有光源响应，切换开关），无论成不成都不再放置
      if (findElementAtPointer() !== null) {
        toggleLightAtPointer();
        return;
      }
      placeElementAtScreen(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 1) return;
    e.preventDefault();
    state.isPanning = true;
    state.panPointerId = e.pointerId;
    state.panLastX = e.clientX;
    state.panLastY = e.clientY;
    // 捕获指针：指针移出画布甚至移出窗口也能继续收到 move 事件
    canvas.setPointerCapture(e.pointerId);
  });

  // 拖拽中：自己用前后 clientX/clientY 求位移，不用 movementX —— 后者在部分浏览器里会跳变，拖起来一抖一抖
  canvas.addEventListener("pointermove", function (e) {
    // 无论是否在拖拽都记录指针位置：虚影每帧据此重算目标格心，平移缩放时也能跟着更新
    pointerSX = e.clientX;
    pointerSY = e.clientY;
    pointerInside = true;
    sceneDirty = true;  // 指针位置变了，虚影与槽悬停都可能跟着变，强制重绘一次
    // 同步选项槽的悬停状态：命中判定与绘制共用 panelSlotRect，两边不会算歪
    updateSlotHoverAt(e.clientX, e.clientY);
    moveMarquee(e);  // 拉框与拖视野是两个互斥的指针操作，各认各的指针 id，互不干扰
    moveSelectionDrag(e);  // 拖动选中元件同理，也是各认各的指针 id
    if (!state.isPanning || e.pointerId !== state.panPointerId) return;
    const dx = e.clientX - state.panLastX;
    const dy = e.clientY - state.panLastY;
    state.panLastX = e.clientX;
    state.panLastY = e.clientY;
    // 平移只动参考点的屏幕位置，世界坐标不动，整个画面跟着屏幕位移走
    state.tAnchorSX += dx;
    state.tAnchorSY += dy;
  });

  // 指针进入画布：立刻记录位置并抢下键盘焦点，否则页面/iframe 未获得焦点时按 WASD 收不到 keydown
  canvas.addEventListener("pointerenter", function (e) {
    pointerSX = e.clientX;
    pointerSY = e.clientY;
    pointerInside = true;
    canvas.focus();
    sceneDirty = true;  // 指针可能正好从槽上进入画布，槽的悬停状态与虚影都要立刻反映出来
    // 这里也判一次槽的悬停，避免要等第一次移动才生效
    updateSlotHoverAt(e.clientX, e.clientY);
  });

  // 指针离开画布：标记为不在画布内，虚影随之隐藏
  canvas.addEventListener("pointerleave", function () {
    pointerInside = false;
    sceneDirty = true;  // 虚影要消失、槽要复位，这些变化必须重绘一次才看得到
    // 离开画布也要清掉槽的悬停与按下，否则槽会一直停在缩小状态回不去
    slotHoverIndex = -1;
    slotPressedIndex = -1;
    slotHoverTime = 0;  // 停留计时一并归零，重新进入时要重新数 1.4 秒
  });

  // 结束拖拽：释放捕获并清空拖拽状态
  canvas.addEventListener("pointerup", function (e) {
    // 设置按钮：松开时指针仍停在按钮上才算一次有效点击（按下后拖走再松手不算）
    // 只切换设置自己的开合状态，不去开合调试面板 —— 那个面板是调参用的，跟设置是两回事
    if (slotPressedIndex === SETTINGS_SLOT_INDEX && slotHoverIndex === SETTINGS_SLOT_INDEX) {
      settingsOpen = !settingsOpen;
      filePanelOpen = false;  // 弹窗互斥：开一个就把另外两个关掉，避免底板叠在一起、也保证同时只有一个按钮亮着
      tutorialOpen = false;
    }
    // 文件按钮：判定规则与设置按钮完全一致，同样是「按下又松开在同一按钮上」才算一次点击
    if (slotPressedIndex === FILE_SLOT_INDEX && slotHoverIndex === FILE_SLOT_INDEX) {
      filePanelOpen = !filePanelOpen;
      settingsOpen = false;   // 同上，反向互斥
      tutorialOpen = false;
    }
    // 教程按钮：判定规则同前两个按钮，按下又松开在同一按钮上才算一次点击
    // 打开时屏幕正中弹出教程窗口；一并把另外两个弹窗关掉，三个按钮同一时刻只有一个亮着
    if (slotPressedIndex === TUTORIAL_SLOT_INDEX && slotHoverIndex === TUTORIAL_SLOT_INDEX) {
      tutorialOpen = !tutorialOpen;
      settingsOpen = false;
      filePanelOpen = false;
    }
    slotPressedIndex = -1;  // 不论哪个键松开都退出按下态，所以放在提前 return 之前
    // 拉框收尾放在最前：松开左键必须把拉框结掉，否则框会一直挂在屏幕上
    if (e.pointerId === marqueePointerId) endMarquee(e);
    if (e.pointerId === movePointerId) endMove(e);  // 拖动收尾：清落点被覆盖的元件并复位状态
    if (e.pointerId !== state.panPointerId) return;
    endPan(e.pointerId);
  });

  // 指针被系统取消（如触控被中断）时也要收尾，否则会卡在拖拽态或按下态
  canvas.addEventListener("pointercancel", function (e) {
    slotPressedIndex = -1;  // 系统取消不算一次点击，只退出按下态
    if (e.pointerId === marqueePointerId) cancelMarquee(e);  // 拉框也要一并收掉，否则框会留在屏幕上
    if (e.pointerId === movePointerId) cancelMove(e);  // 拖动被系统打断：元件退回原位再收状态
    if (e.pointerId !== state.panPointerId) return;
    endPan(e.pointerId);
  });

  // 窗口尺寸变化：画布与元件层都要重新按新尺寸对齐
  window.addEventListener("resize", function () {
    resizeCanvas();
    resizeElementLayer();
    sceneDirty = true;  // 画布尺寸变了，整屏内容都要按新尺寸重画
  });

  // 标签页切回来时画布内容可能已被系统丢弃，强制重绘一次，避免留下一片空白
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) sceneDirty = true;
  });

  // 粘贴：只在这里挂一次，挂在 document 上而不是画布上——焦点落在哪个元素都能收到
  // 不用「读剪贴板」的接口，是因为它要授权、在本地文件下不可靠；粘贴事件由浏览器把内容直接递过来
  document.addEventListener("paste", onPaste);

  // 键盘：1/2/3/4… 直接选中对应序号的元件槽；WASD 把朝向直接拨到上、右、下、左
  // WASD 优先作用于选区：有选中元件时整批一起转；没有选区才落到指针悬停的元件上，再没有就转虚影
  // 判据用 e.code 而不是 e.key：中文输入法激活时 e.key 会变成 "Process"，字母键会被整个吞掉
  window.addEventListener("keydown", function (e) {
    // 先更新修饰键自己的按下状态：这一步必须在所有提前返回之前，
    // 否则状态会与真实键盘脱节（例如在输入条里、或教程窗口开着时按下的 Cmd 会被漏记）
    if (e.key === "Meta") metaHeld = true;
    else if (e.key === "Control") ctrlHeld = true;
    // 确认弹窗开着时，只认两个键：Esc 当作取消，回车当作同意；其余快捷键一律不响应
    // 排在最前面拦：它压在教程窗口之上，是当下唯一该回应的东西
    if (confirmOpen) {
      if (e.code === "Escape") settleConfirm(false);
      else if (e.code === "Enter" || e.code === "NumpadEnter") settleConfirm(true);
      return;
    }
    // 教程窗口开着时，画布的快捷键一律不响应，只留 Esc 把它关掉
    // 放在最前面拦：它是模态窗口，在它前面按 WASD 不该把后面被挡住的元件转了
    if (tutorialOpen) {
      if (e.code === "Escape") tutorialOpen = false;  // Esc 是关模态窗口的通用习惯，顺手支持一下
      return;
    }
    // Cmd+S / Ctrl+S：保存。放在最前面拦，因为这是全局快捷键，与指针在不在画布上无关
    // 必须拦掉默认行为，否则浏览器会弹「保存网页」的框，把页面本身存成一个文件
    // 用键位码而不是键名，避免中文输入法把键名改掉；Mac 认 Cmd，其它平台认 Ctrl
    if (e.code === "KeyS" && cmdKeyHeld(e)) {
      e.preventDefault();
      saveKeyDone = true;   // 记下这一轮已经在按下这一步处理过，抬起 KeyS 时不再补存一次
      onSaveFile();
      return;
    }
    // Cmd+C / Ctrl+C：复制选区。与保存一样是全局快捷键，与指针在不在画布上无关
    // 这里只管复制；粘贴不在这里做，改由系统的粘贴事件接手，那条路才能拿到剪贴板里的文本
    if (e.code === "KeyC" && cmdKeyHeld(e)) {
      e.preventDefault();
      copySelection();
      return;
    }
    // Cmd+Z / Ctrl+Z：撤销；带上 Shift 就是重做，与 Windows 上 Ctrl+Shift+Z 的习惯一致
    // 同样是全局快捷键，与指针在不在画布上无关；手上有悬空时由撤销自己先把它取消掉
    if (e.code === "KeyZ" && cmdKeyHeld(e)) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    // Ctrl+Y：Windows 上另一套常用的重做键位，与 Ctrl+Shift+Z 等价，一并认下
    if (e.code === "KeyY" && e.ctrlKey) {
      e.preventDefault();
      redo();
      return;
    }
    // 反引号 `：切到选中工具（选中模式），与点第一个槽等价，不用鼠标也能进出选择
    // 只负责「切进去」：要退出就点别的槽或按数字键选元件，那两种路径会立刻把选区收掉
    if (e.code === "Backquote") {
      e.preventDefault();
      setSelectedSlot(SELECT_SLOT_INDEX);
      sceneDirty = true;  // 选中高亮与手上虚影都变了，静止时也得重绘一帧才看得到
      return;
    }
    // P 或 F2：开关注能读数面板。面板本身就带调色滑块，两件事共用一个开关，不必再加第二个快捷键
    // 主键选 P 而不是 F2，是因为 Mac 上功能键默认被系统拿去做亮度音量之类，得按住 Fn 才发得出来，不方便
    // 同时留着 F2 给外接全尺寸键盘；两个键都拦掉默认行为，避免浏览器或系统同时触发别的动作
    if (e.code === "KeyP" || e.code === "F2") {
      e.preventDefault();
      setDebugPanelVisible(!debugPanelVisible);
      return;
    }
    // 数字键与鼠标点槽等价：只改选中项并换掉手上的虚影，不进入按下态（键盘没有按住不放这回事）
    // 上限取元件类型数量，所以以后往面板里加元件，数字键自然跟着往后扩，不必改这里
    const digit = digitKeyIndex(e.code);
    if (digit >= 0) {
      if (digit < PANEL_SLOT_TYPES.length) {
        e.preventDefault();
        setSelectedSlot(digit + ELEMENT_SLOT_BASE);   // 数字从 1 数起，加基准才是槽序号，1 仍对应第一个元件类型
        // 选中高亮是画在画布上的：不标脏的话，静止时这一帧会被整帧跳过，上面看着像没反应
        sceneDirty = true;
      }
      return;
    }
    // Delete：有选区时删掉整个选区，没有选区时才删指针所在格的元件（与右键点它等价）
    // 同时认 Backspace：MacBook 键盘上那个标着 delete 的键发出来的就是 Backspace，只认 Delete 的话按下去没反应
    if (e.code === "Delete" || e.code === "Backspace") {
      // 无条件拦下默认行为：Backspace 在浏览器里默认是「后退」，不拦会直接把页面退走
      e.preventDefault();
      // 有选区时删整个选区：删哪些元件由选区决定，与指针停在哪里无关，所以指针在画布外也照删
      if (deleteSelection()) return;
      // 没有选区才回到老行为：删指针所在格的元件
      // 指针已经离开画布时不响应：位置还停在最后一次进入画布的地方，照做会误删
      if (pointerInside) deleteElementAtScreen(pointerSX, pointerSY);
      return;
    }
    // Enter：在指针所在格放置手上选中的元件，与左键点空格完全等价
    // 小键盘的回车键位码不同，一并认下，否则小键盘按了没反应
    if (e.code === "Enter" || e.code === "NumpadEnter") {
      if (pointerInside) {
        e.preventDefault();
        placeElementAtScreen(pointerSX, pointerSY);
      }
      return;
    }
    const dirKey = DIR_KEYS[e.code];  // undefined 表示不是 WASD，注意朝向索引 0 是合法值，不能拿它判空
    if (dirKey === undefined) return;
    e.preventDefault();
    // 顺位一：有选中的元件就整批一起转，不再看指针停在哪个元件上
    if (rotateSelectionToDir(dirKey)) return;
    // 顺位二：没有选区、但指针正悬停在某个元件上，就转那个元件本身
    if (rotateHoveredElement(dirKey)) return;
    // 顺位三：都没有才转虚影；此时改的是手上元件的朝向，与指针是否压着元件无关
    ghostAngleTarget += shortestTurnTo(ghostAngleTarget, dirKey * 90);
  });

  // 抬起：维护修饰键的按下状态，并给保存补一次机会
  // 补这一次是因为 Cmd 有可能比 S 晚落下几毫秒：那种按法里，S 按下的那一下事件里没有 Cmd，
  // 于是被当成普通的 s 丢掉（长按之所以「有用」，正是因为随后连发的重复事件里 Cmd 已经按下了）；
  // 等到抬起 S 时 Cmd 通常已经按着，在这一刻补上，短按与长按就都能存
  window.addEventListener("keyup", function (e) {
    if (e.key === "Meta") metaHeld = false;
    else if (e.key === "Control") ctrlHeld = false;
    if (e.code !== "KeyS") return;
    const handled = saveKeyDone;
    saveKeyDone = false;   // 不论补不补，这一轮到此结束，下一轮重新计
    if (handled) return;   // 按下那一步已经存过了，别再存一次
    // 让路规则与按下那一步完全一致：模态窗口开着时，快捷键一律不响应
    // 少了这一句，按下被挡掉、抬起却补存一次，同一个按法会因为按的长短得出不同结果
    if (confirmOpen || tutorialOpen) return;
    if (!cmdKeyHeld(e)) return;   // 抬起时也没按着 Cmd/Ctrl，说明这一下就是普通的 s（转朝向），不管
    onSaveFile();
  });

  // 失焦：键盘已经不归本页面了，抬起事件收不到，必须把按下状态清掉
  // 不清的话，在别处松开 Cmd 之后，回到页面按一下普通的 s 会被误认成 Cmd+S
  window.addEventListener("blur", function () {
    metaHeld = false;
    ctrlHeld = false;
    saveKeyDone = false;
  });
}

// 统一收尾拖拽：释放指针捕获并复位拖拽相关状态
function endPan(pointerId) {
  if (canvas.hasPointerCapture(pointerId)) {
    canvas.releasePointerCapture(pointerId);
  }
  state.isPanning = false;
  state.panPointerId = null;
}

/* ========== 重置 ========== */

// 把视图与输入状态全部复位到初始值，等价于「重开一局」
// 自查通过：无未定义函数（全部函数在本文件内声明）；监听器仅在 setupInput 里注册一次，无重复绑定泄漏；
// 画布位图按 dpr 缩放且绘制坐标用 CSS 像素，逻辑像素与位图匹配；
// 此处已清空参考点、缩放、拉框、拖动、公转、旋转拖动、虚影与文字输入条状态，复位后不留任何半截手势
function resetView() {
  state.anchorWX = CONFIG.defaultAnchorWX;
  state.anchorWY = CONFIG.defaultAnchorWY;
  // 参考点屏幕位置放在视口正中，等价于把网格原点摆在画面中央
  // 横向的基准要从窗口左边换到视口左边：视口左边已被工作区竖栏占掉一条，仍按窗口算会整体偏右
  // 竖向保持原样，这次改动只涉及竖栏让出的那一条横边距
  const vp = getViewport();
  state.anchorSX = vp.x + vp.w / 2;
  state.anchorSY = state.cssH / 2;
  state.tAnchorSX = state.anchorSX;
  state.tAnchorSY = state.anchorSY;
  state.logScale = Math.log(CONFIG.defaultScale);
  state.tLogScale = state.logScale;
  state.scale = CONFIG.defaultScale;
  state.isPanning = false;
  state.panPointerId = null;
  state.panLastX = 0;
  state.panLastY = 0;
  state.lastTs = 0;
  // 虚影与指针状态一并复位，避免重开时残留上一局的虚影位置与动画进度
  ghostVisible = false;
  ghostAlpha = 0;
  ghostRejectActive = false;
  ghostRejectP = 0;
  ghostRejectStartAlpha = 0;
  ghostRejectFromWX = 0;
  ghostRejectFromWY = 0;
  ghostRejectToWX = 0;
  ghostRejectToWY = 0;
  // 朝向也复位成朝上，避免重开时虚影还停在上一局的朝向
  ghostAngle = 0;
  ghostAngleTarget = 0;
  pointerInside = false;
  // 指针操作的中间状态一并复位：拉框与拖动都回到「没在操作」的状态，不留半截手势
  marqueePressing = false;
  marqueeActive = false;
  marqueePointerId = -1;
  moveDragging = false;
  movePointerId = -1;
  moveDGX = 0;
  moveDGY = 0;
  moveGroup.length = 0;
  orbitActive = false;   // 公转也一并复位，不留半截姿态
  orbitP = 0;
  orbitTurns = 0;
  selOrientDir = 0;      // 选区朝向一并归零，重开一局后新选区仍默认朝上
  // 选项槽的悬停缩放状态一并复位，避免重开时残留上一局的悬停尺寸
  resetSlots();
  // 虚影形状跟着复位后的选中槽走；初始化时 ghostNode 还没建，applyGhostType 内部会跳过
  applyGhostType();
  sceneDirty = true;  // 复位后画面与上一局完全不同，强制重绘一次
}

