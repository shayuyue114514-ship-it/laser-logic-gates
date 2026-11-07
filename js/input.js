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
  return e.metaKey || e.ctrlKey || S.metaHeld || S.ctrlHeld;
}

/* ========== 触屏（本轮最小可用：单指平移、双指捏合缩放、轻点放置或选择、长按删除） ========== */

// 从记着的触点里找出某个指针编号对应的那一条，找不到返回 null
function touchFind(id) {
  for (let i = 0; i < state.touchPointers.length; i++) {
    if (state.touchPointers[i].id === id) return state.touchPointers[i];
  }
  return null;
}

// 撤掉长按计时：手指一动或抬起都要撤，否则会迟半秒删掉一个刚放下的元件
function touchClearLongPress() {
  if (state.touchLongTimer === 0) return;
  clearTimeout(state.touchLongTimer);
  state.touchLongTimer = 0;
}

// 手指按下：一根手指准备「轻点放置」或「长按删除」，两根手指进入平移加捏合
function touchDown(e) {
  state.touchPointers.push({ id: e.pointerId, x: e.clientX, y: e.clientY });
  S.canvas.setPointerCapture(e.pointerId);   // 手指移出画布也能继续收到移动
  if (state.touchPointers.length === 2) {
    touchClearLongPress();   // 第二根手指落下：这次触摸就是缩放平移，不再算轻点
    state.touchMoved = true; // 双指手势用过之后，抬手指不该顺手放下一个元件
    const a = state.touchPointers[0];
    const b = state.touchPointers[1];
    state.touchMidX = (a.x + b.x) / 2;
    state.touchMidY = (a.y + b.y) / 2;
    state.touchDist = Math.hypot(b.x - a.x, b.y - a.y);   // 两指间距，缩放按它的倍率走
    return;
  }
  if (state.touchPointers.length !== 1) return;  // 三根以上不处理
  state.touchMoved = false;
  state.touchLongTimer = setTimeout(function () {
    state.touchLongTimer = 0;
    if (state.touchMoved) return;   // 已经开始拖动，这不是长按
    // 长按删除：按「看到谁在最上面就删谁」的顺序，先文字后元件
    if (!deleteTextAtScreen(e.clientX, e.clientY)) deleteElementAtScreen(e.clientX, e.clientY);
    state.touchMoved = true;   // 这一下已经用掉，抬手指不再放置
  }, CONFIG.touchLongPressMs);
}

// 手指移动：单指平移，双指同时平移并缩放
function touchMove(e) {
  const p = touchFind(e.pointerId);
  if (p === null) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) state.touchMoved = true;   // 越过一点抖动才算拖动
  if (state.touchPointers.length === 1) {
    if (!state.touchMoved) return;   // 还在长按判定期，画面不动
    touchClearLongPress();
    state.tAnchorSX += dx;   // 单指平移：参考点的屏幕位置跟着手指走
    state.tAnchorSY += dy;
    S.sceneDirty = true;
    return;
  }
  if (state.touchPointers.length !== 2) return;
  const a = state.touchPointers[0];
  const b = state.touchPointers[1];
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  // 先按中点位移平移，再绕中点缩放：两步都只改参考点与缩放目标，平滑动画仍由相机自己追
  state.tAnchorSX += midX - state.touchMidX;
  state.tAnchorSY += midY - state.touchMidY;
  if (state.touchDist > 0) zoomAt(midX, midY, dist / state.touchDist);
  state.touchMidX = midX;
  state.touchMidY = midY;
  state.touchDist = dist;
}

// 手指抬起：没有挪动过就当作一次轻点，放元件或选中元件
function touchUp(e) {
  const p = touchFind(e.pointerId);
  if (p === null) return;
  state.touchPointers.splice(state.touchPointers.indexOf(p), 1);
  touchClearLongPress();
  if (state.touchPointers.length === 1) {
    // 双指变单指：接下来的单指移动只平移，不再触发长按；间距清零，免得下次两指用到旧值
    state.touchDist = 0;
    state.touchMoved = true;
    return;
  }
  if (state.touchPointers.length !== 0) return;
  if (state.touchMoved) return;   // 挪动过或长按过了：抬手指不再放置
  // 轻点：与鼠标左键在画布上的语义一致，先看工具，再按「点在谁上面就操作谁」
  S.pointerSX = e.clientX;
  S.pointerSY = e.clientY;
  if (selectToolActive()) { selectAtPointer(false); S.sceneDirty = true; return; }
  if (textToolActive()) { onTextToolClick(e.clientX, e.clientY); S.sceneDirty = true; return; }
  if (findElementAtPointer() !== null) toggleLightAtPointer();
  else placeElementAtScreen(e.clientX, e.clientY);
  S.sceneDirty = true;
}

// 触摸被系统打断：收掉触点与计时，重新回到「没碰画布」的状态
function touchCancel(e) {
  const p = touchFind(e.pointerId);
  if (p !== null) state.touchPointers.splice(state.touchPointers.indexOf(p), 1);
  touchClearLongPress();
  if (state.touchPointers.length === 0) {
    state.touchMoved = false;
    state.touchDist = 0;
  }
}

// 绑定全部输入事件；init 只执行一次，所以监听器不会被重复注册
function setupInput() {
  // 滚轮：默认缩放；设置里打开「滚轮平移」后改为平移画面
  // 触控板双指捏合会带上 ctrlKey，那一种永远按缩放走：没有中键的设备也能既平移又缩放
  S.canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : 1;   // 以「行」为单位时换算成像素，再按同一条曲线处理
    if (e.ctrlKey || !S.wheelPanOn) {
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * CONFIG.wheelZoomRate));
      return;
    }
    // 平移：滚动方向与画面移动方向相反，向下滚动时世界整体上移，于是看得到更下面的内容
    state.tAnchorSX -= e.deltaX * unit;
    state.tAnchorSY -= e.deltaY * unit;
    S.sceneDirty = true;
  }, { passive: false });

  // 中键按下：阻止浏览器自动滚动，并开始拖拽视野
  S.canvas.addEventListener("mousedown", function (e) {
    if (e.button === 1) e.preventDefault();
  });

  // 右键：屏蔽浏览器右键菜单，右键在画布上的语义改成「删除指针所在的东西」
  // 先问浮动文本：它画在元件之上，按「看到谁在最上面就删谁」的直觉，它在元件之前接手
  S.canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    if (deleteTextAtScreen(e.clientX, e.clientY)) return;
    deleteElementAtScreen(e.clientX, e.clientY);
  });

  // 双击：改文字。浮动文本在任何工具下都能改，元件标签只在选中工具下能改
  // 浮动文本不属于电路，不受「只有选中工具才操作画布上的东西」那条限制，所以它排在工具判断之前
  // 元件标签那一路：第一次点击本身已经把元件选中了（选中工具下点击就是选中），
  // 所以「先选中再快速点一下」自然就凑成一次双击；点在标签上就改那块标签，两处归到同一个输入框
  S.canvas.addEventListener("dblclick", function (e) {
    if (S.labelEditorOpen || S.textEditing) return;  // 正在输入中：这次双击的第一次点击已经把输入收掉了，不必再开一次
    S.pointerSX = e.clientX;
    S.pointerSY = e.clientY;
    const tx = textAtPointer(e.clientX, e.clientY);
    if (tx !== null) {
      beginTextEditing(tx, false);  // 浮动文本就地改，不弹窗：字就在眼前，改的时候要看得见上下文
      return;
    }
    if (!selectToolActive()) return;  // 别的工具下双击元件标签没有语义，让它落空好过让它改错东西
    beginLabelEditingAtPointer();
  });

  S.canvas.addEventListener("pointerdown", function (e) {
    // 点击也算一次「进入画布」：页面加载时鼠标已在画布内的话不会触发 pointerenter，这里补上
    S.pointerSX = e.clientX;
    S.pointerSY = e.clientY;
    S.pointerInside = true;
    S.sceneDirty = true;  // 点击可能选槽、开关光源或放置元件，画面必须更新一次
    // 记住这一下点进来之前是不是正在原地编辑文字，因为下面那句 canvas.focus() 会立刻把输入框的焦点抢走，
    // 输入框随即失焦并把这一次输入收下；等到再往下判时 textEditing 已经是假的了
    // 不在这里先记一笔的话，这一下就不会被吃掉，会接着去放置元件或拉框，变成「点一下收尾顺带又干了别的」
    const wasTextEditing = S.textEditing;
    S.canvas.focus();
    // 触屏走另一条路：单指拖是平移、双指是捏合缩放、轻点是放置或选择、长按是删除
    if (e.pointerType === "touch") { touchDown(e); return; }
    // 左键：画布上只剩「操作画面」这一种语义，选项槽与三个按钮已经不在这张画布上，各自收自己的点击
    if (e.button === 0) {
      // 画布上的其余位置：正在原地编辑浮动文本时，这一下只用来把输入收下，不再去拉框或放置
      // 用户点到别处，本意就是结束这次输入；收下而不是丢弃，是因为不小心点到空白会把刚敲的一段话弄丢
      // 上面那次失焦多半已经收过了，endTextEditing 内部会认出这种情况直接走开，不会重复写一遍
      if (wasTextEditing) {
        endTextEditing(true);
        return;  // 这一下已经被输入框吃掉，不再往下走
      }
      // 标签输入框还开着时同理：画布上的左键一律先当作「收起并把字存下」
      if (S.labelEditorOpen) {
        closeLabelEditor(true);
        return;  // 这一下已经被输入框吃掉，不再往下走
      }
      // 选中工具激活时，画布上的左键一律是「选择」：按住不动是单击选中，拖动就成了拉框
      // 这一步必须排在放置和开关光源之前，否则选中工具会被这两个操作抢走左键
      if (selectToolActive()) {
        // 按在浮动文本上：它是画在最上面的一层，判定排在最前，按「看到谁在最上面就抓到谁」来分
        // 按它也等于按它所在的那一块：选区随之变成只有它（没按 Shift 时），然后立刻进入拖动准备态，
        // 所以「按下去就能拖」这个手感与从前一样，只是顺手把它以及整批选区都带上了
        // 本来就是选中态、且没按 Shift 时直接拖整批：这一支要留在前面，否则拖一块已经在选区里的文字会先把别的选中项丢掉
        const hitText = textAtPointer(e.clientX, e.clientY);
        if (hitText !== null) {
          if (!e.shiftKey && hitText.selected) {
            beginMove(e);
            return;
          }
          applyTextSelection(function (tx) { return tx === hitText; }, e.shiftKey);
          // 走一次元件那个总入口：一次单击只该留下这一个对象，与点元件时的行为一致；
          // 它同时负责把上一批选中落位、刷新激光，以及把上面那次文字选中一起记成一步
          // 按住 Shift 时传下去，让元件那一批按翻转规则原样保留，不会被这一次点文字清掉
          applySelection(function () { return false; }, e.shiftKey);
          if (hitText.selected) beginMove(e);
          return;
        }
        // 按在标签上：标签是元件挂出来的一行字，它的判定排在元件本体之前，否则标签永远抓不住
        // 这一步也必须排在拖动选区与拉框之前；Shift 在这里是「吸附到 45° 的整数倍」，不再留给拉框翻转，
        // 因为一次拖动是从哪按下的就已经定了性质，从标签上按下就是拖标签
        const labelEl = labelAtPointer(e.clientX, e.clientY);
        if (labelEl !== null) {
          beginLabelDrag(e, labelEl);
          return;
        }
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
      // 文本工具：左键的语义是「放一段浮动文本」或「改指针下那一块」
      // 要排在下面那条「点在已占用的格子上就交给元件」之前，否则点在有元件的地方会被它截走去开关光源
      if (textToolActive()) {
        onTextToolClick(e.clientX, e.clientY);
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
    S.canvas.setPointerCapture(e.pointerId);
  });

  // 拖拽中：自己用前后 clientX/clientY 求位移，不用 movementX —— 后者在部分浏览器里会跳变，拖起来一抖一抖
  S.canvas.addEventListener("pointermove", function (e) {
    // 无论是否在拖拽都记录指针位置：虚影每帧据此重算目标格心，平移缩放时也能跟着更新
    S.pointerSX = e.clientX;
    S.pointerSY = e.clientY;
    S.pointerInside = true;
    S.sceneDirty = true;  // 指针位置变了，虚影可能跟着变，强制重绘一次
    if (e.pointerType === "touch") { touchMove(e); return; }   // 触屏：平移与捏合缩放走另一条路
    moveMarquee(e);  // 拉框与拖视野是两个互斥的指针操作，各认各的指针 id，互不干扰
    moveSelectionDrag(e);  // 拖动选中元件同理，也是各认各的指针 id
    moveLabelDrag(e);      // 拖标签同理：四种指针操作各认各的 id，同时只有一个能真的动起来
    moveTextDrag(e);       // 拖浮动文本同理
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
  S.canvas.addEventListener("pointerenter", function (e) {
    S.pointerSX = e.clientX;
    S.pointerSY = e.clientY;
    S.pointerInside = true;
    // 正在原地编辑浮动文本、或改标签的弹窗开着时不抢焦点：两者都会盖在画布上，
    // 鼠标从框里移出来落到画布上也会走到这里，这一抢会把焦点从输入框夺走，接着就打不进字了
    // 编辑期间本来也不需要画布的键盘：这一刻用户要敲的是字，不是 WASD
    if (!S.textEditing && !S.labelEditorOpen) S.canvas.focus();
    S.sceneDirty = true;  // 虚影要立刻反映指针位置，必须重绘一次
    // 槽的悬停由槽自己收事件：指针落在面板上时根本不会触发这里的进入
  });

  // 指针离开画布：标记为不在画布内，虚影随之隐藏
  // 槽的悬停由槽自己的离开事件清掉，这里不再越界去动面板的状态
  S.canvas.addEventListener("pointerleave", function () {
    S.pointerInside = false;
    S.sceneDirty = true;  // 虚影要消失，这个变化必须重绘一次才看得到
  });

  // 结束拖拽：释放捕获并清空拖拽状态
  S.canvas.addEventListener("pointerup", function (e) {
    if (e.pointerType === "touch") { touchUp(e); return; }   // 触屏抬手指：轻点才放置，挪动过就不放
    // 拉框收尾放在最前：松开左键必须把拉框结掉，否则框会一直挂在屏幕上
    if (e.pointerId === S.marqueePointerId) endMarquee(e);
    if (e.pointerId === S.movePointerId) endMove(e);  // 拖动收尾：清落点被覆盖的元件并复位状态
    if (e.pointerId === S.labelPointerId) endLabelDrag(e);  // 拖标签收尾：只收状态并记一步，标签留在松手处的方位
    if (e.pointerId === S.textPointerId) endTextDrag(e);    // 拖浮动文本收尾：只收状态并记一步，文字留在松手处
    if (e.pointerId !== state.panPointerId) return;
    endPan(e.pointerId);
  });

  // 指针被系统取消（如触控被中断）时也要收尾，否则会卡在拖拽态或按下态
  S.canvas.addEventListener("pointercancel", function (e) {
    if (e.pointerType === "touch") { touchCancel(e); return; }   // 触屏被打断：只收触点与计时
    if (e.pointerId === S.marqueePointerId) cancelMarquee(e);  // 拉框也要一并收掉，否则框会留在屏幕上
    if (e.pointerId === S.movePointerId) cancelMove(e);  // 拖动被系统打断：元件退回原位再收状态
    if (e.pointerId === S.labelPointerId) cancelLabelDrag(e);  // 拖标签被打断：标签退回按下时的方位
    if (e.pointerId === S.textPointerId) cancelTextDrag(e);    // 拖浮动文本被打断：文字退回按下时的位置
    if (e.pointerId !== state.panPointerId) return;
    endPan(e.pointerId);
  });

  // 窗口尺寸变化：画布与元件层都要重新按新尺寸对齐
  window.addEventListener("resize", function () {
    resizeCanvas();
    resizeElementLayer();
    S.sceneDirty = true;  // 画布尺寸变了，整屏内容都要按新尺寸重画
  });

  // 标签页切回来时画布内容可能已被系统丢弃，强制重绘一次，避免留下一片空白
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) S.sceneDirty = true;
  });

  // 从浏览器缓存里恢复页面时画布内容同样是旧快照甚至空白，这时也请一帧重画
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) S.sceneDirty = true;
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
    if (e.key === "Meta") S.metaHeld = true;
    else if (e.key === "Control") S.ctrlHeld = true;
    // 确认弹窗开着时，只认两个键：Esc 当作取消，回车当作同意；其余快捷键一律不响应
    // 排在最前面拦：它压在教程窗口之上，是当下唯一该回应的东西
    if (S.confirmOpen) {
      if (e.code === "Escape") settleConfirm(false);
      else if (e.code === "Enter" || e.code === "NumpadEnter") settleConfirm(true);
      return;
    }
    // 教程窗口开着时，画布的快捷键一律不响应，只留 Esc 把它关掉
    // 放在最前面拦：它是模态窗口，在它前面按 WASD 不该把后面被挡住的元件转了
    if (S.tutorialOpen) {
      if (e.code === "Escape") S.tutorialOpen = false;  // Esc 是关模态窗口的通用习惯，顺手支持一下
      return;
    }
    // 焦点在文本框里时整段让路：就地给存档起名的那一行，以及以后可能出现的任何输入框
    // 位置排在模态窗口之后、其余快捷键之前：先让模态窗口说了算，再轮到文本框
    // 少了这一句，框里打出的 w a s d 会被当成旋转、数字会被当成选槽、s 会被当成保存，
    // 而且是先拦掉默认行为再处理，字根本进不了框，看上去就像焦点压根没进去
    // 堆叠设置框开着时，只认 Esc 当作取消；其余键一律放行给输入框，不再走画布快捷键
    // 放在文本框判据之前：焦点正停在数字框里时，Esc 也要能把这个框关掉
    if (S.stackPanelOpen) {
      if (e.code === "Escape") {
        e.preventDefault();
        closeStackPanel();
      }
      return;
    }
    // 查找设置框不是模态：只接 Esc 把它收起来，其余键照常给画布
    if (S.searchPanelOpen && e.code === "Escape") {
      e.preventDefault();
      closeSearchPanel();
      return;
    }
    if (isTextEntry(e.target)) return;
    // Cmd+S / Ctrl+S：保存。放在最前面拦，因为这是全局快捷键，与指针在不在画布上无关
    // 必须拦掉默认行为，否则浏览器会弹「保存网页」的框，把页面本身存成一个文件
    // 用键位码而不是键名，避免中文输入法把键名改掉；Mac 认 Cmd，其它平台认 Ctrl
    if (e.code === "KeyS" && cmdKeyHeld(e)) {
      e.preventDefault();
      S.saveKeyDone = true;   // 记下这一轮已经在按下这一步处理过，抬起 KeyS 时不再补存一次
      // 按住不放会一路重复触发：不拦的话一次长按就能排出十几趟写盘，它们堵在同一把文件锁上等着，
      // 圆点会一口气呼吸很久，而真正写进去的只有最后那一趟
      if (e.repeat) return;
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
      // 按住不放会一路重复触发，一次长按就退回十几步，看起来像画面突然跳走；只管第一次按下
      if (e.repeat) return;
      if (e.shiftKey) redo(); else undo();
      return;
    }
    // Ctrl+Y：Windows 上另一套常用的重做键位，与 Ctrl+Shift+Z 等价，一并认下
    if (e.code === "KeyY" && e.ctrlKey) {
      e.preventDefault();
      if (e.repeat) return;   // 同上：长按不连续重做
      redo();
      return;
    }
    // 反引号 `：切到选中工具（选中模式），与点第一个槽等价，不用鼠标也能进出选择
    // 只负责「切进去」：要退出就点别的槽或按数字键选元件，那两种路径会立刻把选区收掉
    if (e.code === "Backquote") {
      e.preventDefault();
      setSelectedSlot(SELECT_SLOT_INDEX);
      S.sceneDirty = true;  // 选中高亮与手上虚影都变了，静止时也得重绘一帧才看得到
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
    // Shift+数字：与鼠标点右侧工具栏对应的格子等价，第 1 格是运行开关、第 2 格是前进一步，其余格子尚无功能
    // 不按 Shift 时数字选的是元件槽，所以这两组必须分开判断，Shift 在这里是唯一的区分依据
    // 带 Cmd / Ctrl 时不抢：那两个修饰键下的数字是浏览器的切换标签页
    const rightDigit = digitKeyIndex(e.code);
    if (rightDigit >= 0 && e.shiftKey && !cmdKeyHeld(e)) {
      const box = S.rightBarToolsDom.children[rightDigit];
      if (box) {
        e.preventDefault();
        pressRightBarBox(box);   // 键盘没有物理按住，先补一次按下态，收缩动画与鼠标点击完全一样
        box.click();   // 走与鼠标点击同一条处理路径，两边的行为不必各写一份
      }
      return;
    }
    // 数字键与鼠标点槽等价：只改选中项并换掉手上的虚影，不进入按住态
    // 判据用 isPickableSlot 而不是写死数量：1 到 5 落在元件槽上，6 落在末尾那个「文本」工具槽上，
    // 以后再加元件类型，数字键自然跟着往后扩，文本槽的位置也自动随之顺延，这里不必回来改
    // 越界的数字（7 及以上）落在三个按钮槽上，isPickableSlot 会把它挡掉，所以按了什么也不会发生
    const digit = digitKeyIndex(e.code);
    if (digit >= 0) {
      const slot = digit + ELEMENT_SLOT_BASE;  // 数字从 1 数起，加基准才是槽序号，1 仍对应第一个元件类型
      if (isPickableSlot(slot)) {
        e.preventDefault();
        setSelectedSlot(slot);
        // 补一次与鼠标点击同源的按下反馈：没有物理按住，由一段短计时把缩小再回弹演完
        pressSlotByKey(slot);
        // 选中高亮是画在画布上的：不标脏的话，静止时这一帧会被整帧跳过，上面看着像没反应
        S.sceneDirty = true;
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
      if (S.pointerInside) deleteElementAtScreen(S.pointerSX, S.pointerSY);
      return;
    }
    // Enter：在指针所在格放置手上选中的元件，与左键点空格完全等价
    // 小键盘的回车键位码不同，一并认下，否则小键盘按了没反应
    if (e.code === "Enter" || e.code === "NumpadEnter") {
      if (S.pointerInside) {
        e.preventDefault();
        placeElementAtScreen(S.pointerSX, S.pointerSY);
      }
      return;
    }
    // H / V：把选中的这一批照选区中线翻一次，H 是左右镜像、V 是上下镜像（算法在 selection.js 的 mirrorSelection）
    // 只作用于选区：什么都没选中时不响应；指针下那一个元件的翻转不在这里管，那属于 WASD 转朝向那一套
    // 必须排除带 Cmd / Ctrl 的情况：macOS 上 Cmd+H 是隐藏整个应用、Cmd+V 是粘贴，不能抢过来
    if ((e.code === "KeyH" || e.code === "KeyV") && !cmdKeyHeld(e)) {
      e.preventDefault();
      mirrorSelection(e.code === "KeyH" ? "h" : "v");
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
    S.ghostAngleTarget += shortestTurnTo(S.ghostAngleTarget, dirKey * 90);
  });

  // 抬起：维护修饰键的按下状态，并给保存补一次机会
  // 补这一次是因为 Cmd 有可能比 S 晚落下几毫秒：那种按法里，S 按下的那一下事件里没有 Cmd，
  // 于是被当成普通的 s 丢掉（长按之所以「有用」，正是因为随后连发的重复事件里 Cmd 已经按下了）；
  // 等到抬起 S 时 Cmd 通常已经按着，在这一刻补上，短按与长按就都能存
  window.addEventListener("keyup", function (e) {
    if (e.key === "Meta") S.metaHeld = false;
    else if (e.key === "Control") S.ctrlHeld = false;
    if (e.code !== "KeyS") return;
    const handled = S.saveKeyDone;
    S.saveKeyDone = false;   // 不论补不补，这一轮到此结束，下一轮重新计
    if (handled) return;   // 按下那一步已经存过了，别再存一次
    // 同一条让路规则里再补上文本框：焦点在框里时，这一下是在打字母 s，不是在按保存
    if (isTextEntry(e.target)) return;
    // 让路规则与按下那一步完全一致：模态窗口开着时，快捷键一律不响应
    // 少了这一句，按下被挡掉、抬起却补存一次，同一个按法会因为按的长短得出不同结果
    if (S.confirmOpen || S.tutorialOpen || S.stackPanelOpen) return;
    if (!cmdKeyHeld(e)) return;   // 抬起时也没按着 Cmd/Ctrl，说明这一下就是普通的 s（转朝向），不管
    onSaveFile();
  });

  // 失焦：键盘已经不归本页面了，抬起事件收不到，必须把按下状态清掉
  // 不清的话，在别处松开 Cmd 之后，回到页面按一下普通的 s 会被误认成 Cmd+S
  window.addEventListener("blur", function () {
    S.metaHeld = false;
    S.ctrlHeld = false;
    S.saveKeyDone = false;
  });

  // 关标签页、刷新、从地址栏跳走之前拦一道：有未保存的改动就弹浏览器自带的确认
  // 提示文字由浏览器统一决定（各家都固定了措辞，页面改不了），这里只能决定弹不弹
  // 保存刚交出去、收尾还没落地的那几秒也算：文件还没换成新的，此刻关掉等于丢掉这一趟
  window.addEventListener("beforeunload", function (e) {
    // 只有「还没写进内部工作区」才拦：已经写进工作区的那一份关掉页面也不会丢
    if (S.docDirty !== true) return;
    e.preventDefault();    // 现代浏览器：拦下默认动作，弹出确认框
    e.returnValue = true;  // 老浏览器只看这个返回值，赋一个真值就表示「要确认」
  });
}

// 统一收尾拖拽：释放指针捕获并复位拖拽相关状态
function endPan(pointerId) {
  if (S.canvas.hasPointerCapture(pointerId)) {
    S.canvas.releasePointerCapture(pointerId);
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
  S.ghostVisible = false;
  S.ghostAlpha = 0;
  S.ghostRejectActive = false;
  S.ghostRejectP = 0;
  S.ghostRejectStartAlpha = 0;
  S.ghostRejectFromWX = 0;
  S.ghostRejectFromWY = 0;
  S.ghostRejectToWX = 0;
  S.ghostRejectToWY = 0;
  // 朝向也复位成朝上，避免重开时虚影还停在上一局的朝向
  S.ghostAngle = 0;
  S.ghostAngleTarget = 0;
  S.pointerInside = false;
  // 指针操作的中间状态一并复位：拉框与拖动都回到「没在操作」的状态，不留半截手势
  S.marqueePressing = false;
  S.marqueeActive = false;
  S.marqueePointerId = -1;
  S.moveDragging = false;
  S.movePointerId = -1;
  S.moveDGX = 0;
  S.moveDGY = 0;
  S.moveGroup.length = 0;
  // 拖标签与拖浮动文本也一并收掉：两者都不会跨局延续，留着会让下一次拖动多认一个旧指针
  S.labelDragging = false;
  S.labelDragActive = false;
  S.labelPointerId = -1;
  S.labelDragEl = null;
  S.textDragging = false;
  S.textDragActive = false;
  S.textPointerId = -1;
  S.textDragEl = null;
  S.orbitActive = false;   // 公转也一并复位，不留半截姿态
  S.orbitP = 0;
  S.orbitTurns = 0;
  S.selOrientDir = 0;      // 选区朝向一并归零，重开一局后新选区仍默认朝上
  // 选项槽的悬停缩放状态一并复位，避免重开时残留上一局的悬停尺寸
  resetSlots();
  // 虚影形状跟着复位后的选中槽走；初始化时 ghostNode 还没建，applyGhostType 内部会跳过
  applyGhostType();
  S.sceneDirty = true;  // 复位后画面与上一局完全不同，强制重绘一次
}

