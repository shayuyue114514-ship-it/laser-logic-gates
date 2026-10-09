// util.js：通用工具：缓动曲线、数值钳制、世界坐标与屏幕坐标互转。
"use strict";

/* ========== 工具函数 ========== */

// 把 v 限制在 [lo, hi] 区间，用于钳制缩放范围
function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

// 指数缓出曲线：起步最快、越接近终点越慢；t = 0.1 时输出正好 0.5，即位移走完一半
function easeOutExpo(t) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// 三次缓出曲线：起步快、收尾慢；删除动画用它就是先迅速收缩、再收干净，反馈跟手
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// 三次缓入缓出曲线：两端慢、中间快；简介浮层用它，出现和收起都不生硬
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// 建一个已停稳的缓动标量：cur 是当前值，from→to 在固定时长内按缓出曲线推进，t 到 1 表示停稳
function newEased(value) {
  return { cur: value, from: value, to: value, t: 1 };
}

// 把缓动标量朝目标推进：目标一变就从当前值重新起步，所以动画中途改目标也不会跳变
// easing 可指定曲线，缺省是三次缓出；传 easeInOutCubic 就得到两端都慢的柔和动画
function stepEased(a, to, dt, duration, easing) {
  const ease = easing || easeOutCubic;
  if (a.to !== to) {
    a.from = a.cur;
    a.to = to;
    a.t = 0;
  }
  if (a.t >= 1) return;
  a.t = Math.min(1, a.t + dt / duration);
  a.cur = a.from + (a.to - a.from) * ease(a.t);
}

/* ========== 坐标变换 ========== */

// 屏幕位置 = 参考点屏幕位置 + 世界偏移 × 缩放；用参考点表示，缩放时只有缩放量在变，位移天然单调
function worldToScreenX(wx) {
  return state.anchorSX + (wx - state.anchorWX) * state.scale;
}

// 世界 Y → 屏幕 Y：屏幕 Y 向下、世界 Y 向上，所以取负号
function worldToScreenY(wy) {
  return state.anchorSY - (wy - state.anchorWY) * state.scale;
}

// 屏幕 X → 世界 X，用于把鼠标位置换算成世界坐标
function screenToWorldX(sx) {
  return state.anchorWX + (sx - state.anchorSX) / state.scale;
}

// 屏幕 Y → 世界 Y
function screenToWorldY(sy) {
  return state.anchorWY - (sy - state.anchorSY) / state.scale;
}

// 世界 X 所在格子的格心 X：格子是 [i, i+1]，格心即 i+0.5；floor 对负数同样正确
function cellCenterX(wx) {
  return Math.floor(wx) + 0.5;
}

// 世界 Y 所在格子的格心 Y
function cellCenterY(wy) {
  return Math.floor(wy) + 0.5;
}

/* ========== 颜色换算 ========== */

// 这一组函数原本放在 debug.js 里，但 config.js 在加载时就要用 hslToRgb 把常态色、亮起色、选中色
// 预先换算成 RGB 端点，而 config.js 是第一个加载的脚本，debug.js 排在第十七位，于是加载时必然报错。
// 颜色换算属于通用工具，与调试面板无关，所以整体搬到 util.js，并把 util.js 提到最前面加载。

// 把 HSL 三元组转成 CSS 颜色字符串；SVG 的 fill/stroke 直接接受 hsl() 写法
function hslCss(c) {
  return "hsl(" + c.h + ", " + c.s + "%, " + c.l + "%)";
}

// 两个 HSL 三元组按 k 线性混合（0 取 a，1 取 b），返回 CSS 的 hsl() 写法
// 供选中缓动使用：逐通道插值，色相只在本体与选中之间小幅平移，不会跨越 0 度而绕远路
function mixHsl(a, b, k) {
  return "hsl(" + (a.h + (b.h - a.h) * k) + ", " +
    (a.s + (b.s - a.s) * k) + "%, " +
    (a.l + (b.l - a.l) * k) + "%)";
}

// 同上的混合，但返回三元组本身而不是 CSS 写法：需要连着混两次（先按亮起、再按选中）时用它
// k 为 0 时返回的是 a 的副本，逐通道都加了 0，数值与 a 完全一致，不会给没参与混合的元件带来偏差
function mixHslTriple(a, b, k) {
  return {
    h: a.h + (b.h - a.h) * k,
    s: a.s + (b.s - a.s) * k,
    l: a.l + (b.l - a.l) * k
  };
}

// 把 HSL 三元组换算成 0-255 的 RGB：灯的亮起改用 RGB 逐通道混合，先把两端颜色取成 RGB 备用
// 标准换算：先由饱和度与亮度定出色度，再按色相落到六个扇区之一取出三分量，最后按亮度补正
function hslToRgb(c) {
  const s = c.s / 100;
  const l = c.l / 100;
  const k = (1 - Math.abs(2 * l - 1)) * s;        // 色度：饱和度越高、越远离全黑全白就越大
  const hp = (((c.h % 360) + 360) % 360) / 60;    // 色相归一化到 0-6，落在哪个扇区就取哪组分量
  const x = k * (1 - Math.abs((hp % 2) - 1));     // 扇区内的过渡分量
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = k; g = x; }
  else if (hp < 2) { r = x; g = k; }
  else if (hp < 3) { g = k; b = x; }
  else if (hp < 4) { g = x; b = k; }
  else if (hp < 5) { r = x; b = k; }
  else { r = k; b = x; }
  const m = l - k / 2;                            // 亮度补正：把算出的分量整体抬到目标亮度
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// 两个 RGB 颜色按 k 线性混合（0 取 a，1 取 b）：逐通道插值，不经过色相环，所以不会串出无关颜色
// 灯的亮起就等于「在灯上盖一层淡红遮罩并把遮罩的不透明度从 0 拉到 1」，这个式子正是那层遮罩的混合结果
function mixRgb(a, b, k) {
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k
  };
}

// RGB 三元组转成 CSS 颜色字符串；在这里统一取整，混合过程保留小数，避免连续过渡时逐帧累积误差
function rgbCss(c) {
  return "rgb(" + Math.round(c.r) + ", " + Math.round(c.g) + ", " + Math.round(c.b) + ")";
}

