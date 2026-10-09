// elements.js：网格上的元件：放置、查找、绘制到画布、删除动画。
// 已放置的元件不再挂 SVG 节点，一律由 renderElements 直接画到画布上；元件层这个 SVG 只剩虚影在用
"use strict";

/* ========== 元件（画布层） ========== */

// 同步元件层的尺寸与裁剪矩形：这一层现在只装虚影，但虚影同样只该出现在视口内，裁剪规则与元件一致
function resizeElementLayer() {
  const vp = getViewport();
  elemLayer.setAttribute("width", state.cssW);
  elemLayer.setAttribute("height", state.cssH);
  elemLayer.style.width = state.cssW + "px";
  elemLayer.style.height = state.cssH + "px";
  clipRect.setAttribute("x", vp.x);
  clipRect.setAttribute("y", vp.y);
  clipRect.setAttribute("width", vp.w);
  clipRect.setAttribute("height", vp.h);
}

// 给一个形状节点套上元件通用外观：填充、描边、圆角连接、先描边后填充、整体透明度
// 单独抽出来是为了虚影也能复用同一套外观：虚影固定是一个路径，不走带文字的组
function styleElementShape(node, opacity) {
  node.setAttribute("fill", hslCss(elementHSL.fill));
  node.setAttribute("stroke", hslCss(elementHSL.stroke));
  // 描边宽度用世界单位，随缩放一起放大，元件轮廓才始终跟着元件走
  node.setAttribute("stroke-width", CONFIG.elementStroke);
  // 圆角靠描边的圆角连接实现：拐角外侧按描边宽度的一半倒圆，不用改路径数据
  node.setAttribute("stroke-linejoin", "round");
  // 先描边后填充：描边内侧那半被填充盖住，只留外面一圈，外框和填充不再重叠
  node.setAttribute("paint-order", "stroke");
  // 用整节点透明度而不是 fill-opacity：后者会让填充透光、盖不住描边内侧，虚影的圈会粗一倍
  node.setAttribute("opacity", opacity);
}

// 建一个元件节点：已放置的元件一律直接画到画布上，不再建节点，所以这里现在只服务虚影
function createElementNode(typeId, opacity) {
  const node = document.createElementNS(SVG_NS, "path");
  node.setAttribute("d", elementPathD(typeId));
  styleElementShape(node, opacity);
  return node;
}

// 查找占据指定格心的元件；格心坐标是 floor 结果加 0.5，都是精确可表示的半整数，可以直接比较
// 同一格出现多个元件只是操作途中的临时状态（把选中的元件挪到了别人身上），
// 而「一格最多一个元件」是模型硬约束，所以这里必须给出唯一答案，交给下面的层级判定
function findElementAt(wx, wy) {
  return topElementAtCell(wx, wy);
}

// 某一格最上层的元件：正在手上（选中）的压在其他元件之上，正在消失的排在最下
// 这个顺序和绘制顺序完全一致（选中的会被挪到元件层末尾），所以「看到谁在最上面就命中谁」，
// 命中结果不会和画面矛盾；同层取数组里靠后的，也和绘制顺序对齐
function topElementAtCell(wx, wy) {
  let best = null;
  let bestRank = -1;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.wx !== wx || el.wy !== wy) continue;
    // 正在消失的排 0，普通元件排 1，选中元件排 2；这样正在消失的元件永远不会挡住真实元件
    const rank = el.deleting ? 0 : (el.selected ? 2 : 1);
    if (rank >= bestRank) { best = el; bestRank = rank; }  // 同层取靠后的，和绘制顺序一致
  }
  return best;
}

// 在指定格心点放置一个指定类型、朝 dir 方向的元件
// 元件不再建 SVG 节点：形状由渲染那一步直接画到画布上，这里只备好数据与几项绘制缓存
function placeElement(wx, wy, dir, typeId) {
  const el = {
    id: nextElementId++,  // 内部编号：只用来在历史差分里认人，不写进存档；换文档时随新元件重新发号
    wx: wx, wy: wy, dir: dir, typeId: typeId,
    angle: dir * 90, angleTarget: dir * 90,  // 初始角度就是放置时的朝向，动画从静止开始
    deleting: false, deleteP: 0,
    on: false,  // 光源的开关状态：由外部点击切换，默认关；只有光源类型会读它
    // 下面三项是配色缓存：填充色、描边色、描边宽度。只在选中进度或亮起进度变过时重算一次，
    // 大电路里绝大多数元件每一帧都命中缓存，不必每帧拼一遍颜色字符串
    fillCss: "", strokeCss: "", strokeW: 0,
    selected: false, // 是否被选中：选中即离地，该元件退出电路模拟（不挡光也不发光），落位取消选中时才回到电路里
    litK: -1,        // number：上一次算配色时的选中进度（0 常态、1 全选中）；初值取 -1，逼第一帧先算一次
    litK2: -1,       // number：上一次算配色时的亮起进度；与 litK 一起当缓存键，灯以外的元件恒为 0
    litIn: false,    // boolean：本微帧有没有被激光照到；只由结算层写，灯以外的元件不读
    litP: newEased(0), // Object：灯的亮起缓动进度标量，0 不亮、1 全亮；只有灯会推进它
    selP: newEased(0), // Object：选中缓动进度标量，0 常态、1 全选中，在固定时长内走缓出曲线
    selBase: false,  // 拉框按下那一刻的选中快照：按住 Shift 框选时以它为基准做翻转，框动来动去也不会反复横跳
    orbitU0: null,   // number | null：公转起点格号 u；null 表示这个元件没在公转
    orbitV0: null,   // number | null：公转起点格号 v
    orbitAngle0: 0,  // number：公转开始时的角度，公转期间画的角度从它往上加
    orbitShiftU: 0,  // number：落位吸附量 u：动画途中按进度补上，收尾时正好落在格心上
    orbitShiftV: 0,  // number：落位吸附量 v
    mvOffU: 0,       // number：拖动缓动的视觉偏移 u（世界单位）：拖动时先让画面留在原地，再缓出追上目标格
    mvOffV: 0,       // number：拖动缓动的视觉偏移 v
    out: 0      // 本微帧要发射的掩码：偏转器与透射器由 scheduleOutputs 按上一微帧的接收结果写入
  };
  elements.push(el);
  rayGraph.dirty = true;  // 元件增删会打乱 elements 下标，阻挡图必须重建
  sceneDirty = true;      // 新元件要画出来，强制重绘一次
  return el;              // 交给调用方接着改字段（读档要还原光源开关），省得再回头查一遍
}

// 在屏幕位置处放置元件：吸附到所在格心，视口外不放置，同一格已有元件则忽略
function placeElementAtScreen(screenX, screenY) {
  if (!isInViewport(screenX, screenY)) return;
  const wx = cellCenterX(screenToWorldX(screenX));
  const wy = cellCenterY(screenToWorldY(screenY));
  // 一个格子最多一个元件，这是基本逻辑里的硬约束
  if (findElementAt(wx, wy) !== null) return;
  // 朝向取虚影当前的目标角度：目标角度永远是 90 的整数倍，取模得到 0 上 1 右 2 下 3 左
  const dir = ((Math.round(ghostAngleTarget / 90) % 4) + 4) % 4;
  // 类型取当前选中的槽：放下去的就是手上那个虚影，形状与预览完全一致
  // 手上拿的是选中工具时没有元件可放，回车直接不响应
  const typeId = selectedTypeId();
  if (typeId === null) return;
  placeElement(wx, wy, dir, typeId);
  commitHistory();  // 放置是直接改电路的动作，放下去这一刻就记一步
}

// 虚影的屏幕变换串：先把世界坐标换算成屏幕位置，再拼出「平移到屏幕位置 → 按角度旋转 → 按屏幕缩放放大」
// 等比缩放下旋转与缩放可交换，顺序不影响结果
// 参数直接收角度（度），因为虚影旋转动画中途会传入非 90 整数倍的值
// 缩放由调用方传进来：普通元件的虚影跟着相机缩放走，虚影本身不再自己算
// 已放置的元件不再用变换串，它们在 renderElements 里直接摆坐标系，所以这里只服务虚影
function elementTransform(wx, wy, angleDeg, scale) {
  return "translate(" + worldToScreenX(wx) + " " + worldToScreenY(wy) + ")" +
    " rotate(" + angleDeg + ")" +
    " scale(" + scale + ")";
}

// 每帧把所有元件直接画到画布上；删除中的元件同时被收缩和淡出
// 为什么不再用 SVG 节点承载：视野一动，屏上每个元件的坐标都要重算，而 SVG 每改一次坐标都要为那个节点
// 重算布局再重新描一遍，两千个元件叠起来就是几十毫秒；画到画布上只是描一次路径加填一次色，
// 开销同样与元件个数成正比，但每个元件的常数小得多，而且没有任何布局与样式计算
// 这里做两件省算的事，目的是让开销随「屏上元件数」走，而不是随「元件总数」走：
//   一、视口外的元件直接跳过：它们这一帧本来就不会出现在画面上，跳过之后连路径都不用建
//       画布不像 SVG 节点那样会留下上一次的坐标，所以跳过永远是安全的，不存在重影
//   二、配色只在选中进度或亮起进度真的变过时才重算，静止元件每帧都命中缓存，不拼颜色字符串
function renderElements() {
  const vp = getViewport();
  // 剔除余量：形状的原点就在格心，离格心最远的一点是三角形底角或反相器顶点上那颗气泡
  // 统一按「元件长度的一半再乘 √2」估：任何形状都落在这个半径之内，比逐个类型算更省事也更保险
  // 描边只露外侧一半，这里按整宽加进去，再留 2px 富余：余量偏大只会多画几个视口外的元件，漏画才是错的
  // 缩放每帧都可能变，余量必须每帧现算，不能缓存
  const cullMargin = (CONFIG.elementLen * Math.SQRT2 / 2 + CONFIG.elementStroke) * state.scale + 2;
  const cullL = vp.x - cullMargin;
  const cullR = vp.x + vp.w + cullMargin;
  const cullT = vp.y - cullMargin;
  const cullB = vp.y + vp.h + cullMargin;
  let drawn = 0;   // number：本帧真正画出来的元件数，渲染完写进全局供性能读数显示
  let culled = 0;  // number：本帧被剔除跳过的元件数，同上

  ctx.save();
  // 裁剪到视口：元件和网格一样只出现在视口内，不会压到上方面板或底部栏上
  ctx.beginPath();
  ctx.rect(vp.x, vp.y, vp.w, vp.h);
  ctx.clip();
  ctx.lineJoin = "round";  // 圆角靠描边的圆角连接实现：拐角外侧按描边宽度的一半倒圆，不用改路径数据

  // 分三档画：正在消失的排最下、普通元件居中、正在手上的压在最上
  // 这个顺序与按格查元件的层级判定完全一致，用户看到谁在最上面就能选到谁，画面与判定不会矛盾
  // 分三档而不是重排数组：数组下标被接收掩码引用着，动不得；三档只多两遍极廉价的布尔判断
  for (let rank = 0; rank <= 2; rank++) {
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if ((el.deleting ? 0 : (el.selected ? 2 : 1)) !== rank) continue;  // 不属于这一档，跳过
      // 删除动画的缓动值同时驱动缩放和透明度；没在删除时恒为 0，等于原样绘制
      const e = el.deleting ? easeOutCubic(el.deleteP) : 0;
      // 公转中的元件画的是弧线上的插值位置：数据要等落位才改，所以此刻画面和数据是有意分开的
      let wx = el.wx, wy = el.wy, angle = el.angle;
      if (orbitActive && el.orbitU0 !== null) {
        const t = easeOutCubic(orbitP);
        const total = orbitTurns * 90;
        const rad = total * t * Math.PI / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        const du = el.orbitU0 - orbitPivotU;
        const dv = el.orbitV0 - orbitPivotV;
        // 吸附量随进度线性补上：走到头时画面位置正好等于落位后的格心，不会在收尾时跳半格
        wx = orbitPivotU + du * c + dv * s + el.orbitShiftU * t + 0.5;
        wy = orbitPivotV - du * s + dv * c + el.orbitShiftV * t + 0.5;
        angle = el.orbitAngle0 + total * t;
      }
      // 拖动缓动的视觉偏移叠在数据位置之上：数据已经跳到目标格，画面还差一点点，缓出追上后偏移归零
      // 偏移只影响画面，不参与模拟与占位判定，所以拖动途中激光立刻按新格重算，手感是「跟手但不硬跳」
      wx += el.mvOffU;
      wy += el.mvOffV;
      // 屏幕位置先算出来：剔除判定和摆位都要用它，算一次供两处使用
      const sx = worldToScreenX(wx);
      const sy = worldToScreenY(wy);
      // 视口剔除：这一帧它根本不会出现在画面上，跳过之后连路径都不用建
      if (sx < cullL || sx > cullR || sy < cullT || sy > cullB) {
        culled++;
        continue;
      }
      drawn++;
      // 选中走「内亮外深」：填充提亮、描边加深加粗，浅底配深边把轮廓扣出来，不额外套框
      // 灯另走一套：亮起时在 RGB 里把常态色逐通道混向淡红，等价于盖一层淡红遮罩淡入，中间不会绕色环
      // 其它元件亮起进度恒为 0，仍按原来的 HSL 路径在常态色与选中色之间过渡，行为与改动前完全一致
      // 两个进度任一变过就重算一次配色，结果留在元件上，下一帧直接取用
      const kSel = el.selP.cur;
      const kLit = el.litP.cur;
      if (el.litK !== kSel || el.litK2 !== kLit) {
        el.litK = kSel;
        el.litK2 = kLit;
        if (el.typeId === "lamp") {
          // 先按亮起进度混向淡红，再按选中进度混向选中色；两级都逐通道做，蓝到红之间只有一段偏灰的紫
          const fill = mixRgb(mixRgb(RGB.elementFill, RGB.lampFill, kLit), RGB.selectFill, kSel);
          const stroke = mixRgb(mixRgb(RGB.elementStroke, RGB.lampStroke, kLit), RGB.selectStroke, kSel);
          el.fillCss = rgbCss(fill);
          el.strokeCss = rgbCss(stroke);
        } else {
          const fill = mixHslTriple(elementHSL.fill, selectLitHSL.fill, kSel);
          const stroke = mixHslTriple(elementHSL.stroke, selectLitHSL.stroke, kSel);
          el.fillCss = hslCss(fill);
          el.strokeCss = hslCss(stroke);
        }
        // 描边宽度跟着选中进度一起从常态加粗到选中值，取消选中时原样退回
        el.strokeW = CONFIG.elementStroke + (CONFIG.elementStrokeSelected - CONFIG.elementStroke) * kSel;
      }
      // 把坐标系搬到这一格：先平移到屏幕位置，再按角度旋转，最后按屏幕缩放放大
      // 之后的形状与文字都按元件本地坐标画，与 SVG 侧那串变换完全等价
      // 等比缩放下旋转与缩放可交换，顺序不影响结果
      const kScale = state.scale * (1 - e);
      ctx.save();
      ctx.globalAlpha = 1 - e;  // 删除动画的淡出：整节点透明度，底板与文字一起淡
      ctx.translate(sx, sy);
      ctx.rotate(angle * Math.PI / 180);
      ctx.scale(kScale, kScale);
      ctx.fillStyle = el.fillCss;
      ctx.strokeStyle = el.strokeCss;
      ctx.lineWidth = el.strokeW;
      // 路径由类型点列生成：和面板槽里的预览是同一份形状定义，两处不会各自漂移
      traceElementPath(el.typeId);
      // 先描边后填充：描边内侧那半被填充盖住，只留外面一圈，外框和填充不再重叠
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
  // 本帧两个计数写回全局：调试面板的读数直接读它们，不必再数一遍
  // 整帧被跳过时这两个值保持上一次渲染的结果，读数因此读的是「最近一次真实渲染的规模」
  drawnElementCount = drawn;
  culledElementCount = culled;
}

// 找出指针当前所指格子里的元件：视口外或格内没有元件都返回 null
function findElementAtPointer() {
  if (!isInViewport(pointerSX, pointerSY)) return null;
  return findElementAt(cellCenterX(screenToWorldX(pointerSX)), cellCenterY(screenToWorldY(pointerSY)));
}

// 切换指针所在格光源的开关：只在指针下是存活的光源时生效，空格、其他类型、删除动画中的都忽略
// 开关一变，发射掩码随之改变，结算层下一微帧就会重算激光场
function toggleLightAtPointer() {
  const el = findElementAtPointer();
  if (el === null || el.deleting || el.typeId !== "light") return;
  el.on = !el.on;
  commitHistory();  // 开关本身也是电路状态的一部分，跟着一起可撤销
}

// 删除屏幕位置所在格的元件：视口外、格内没有元件、或该元件已在删除动画中，都直接忽略
function deleteElementAtScreen(screenX, screenY) {
  if (!isInViewport(screenX, screenY)) return;
  const el = findElementAt(cellCenterX(screenToWorldX(screenX)), cellCenterY(screenToWorldY(screenY)));
  if (el === null || el.deleting) return;
  el.deleting = true;
  el.deleteP = 0;
  rayGraph.dirty = true;  // 删除动画一开始就把它从模拟里摘掉，不等动画放完
  commitHistory();  // 标记成「正在消失」这一刻它就已经不算电路里的人了，所以在这里记步
}

// 删除整个选区：选中的元件一起进入消失动画，压在下面的其他元件不受影响
// 顺序有讲究：先把它们逐个标成「正在删除」，再走选区总入口清空选中
// 删除中的元件不会被算作「离开选区」，所以不会像正常落位那样把落点上的其他元件一并顶掉
// 返回 true 表示这次按键已由选区接手，调用方不必再去删指针所在格
function deleteSelection() {
  let any = false;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el.selected || el.deleting) continue;
    el.deleting = true;
    el.deleteP = 0;
    any = true;
  }
  if (!any) return false;
  applySelection(function () { return false; }, false);
  return true;
}

// 每帧推进所有删除中的元件动画；动画走完才真正移除数据
function updateDeletions(dt) {
  // 倒序遍历：移除元素用的是 splice，倒着走不会漏掉还没处理的项
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el.deleting) continue;
    el.deleteP = Math.min(1, el.deleteP + dt / CONFIG.elementDeleteDuration);
    if (el.deleteP >= 1) {
      // 动画期间这一格仍算被占用，虚影不会提前淡入；走完才腾出格子
      elements.splice(i, 1);
      rayGraph.dirty = true;  // splice 让后面所有下标前移，阻挡图里存的下标随之失效
    }
  }
}

