// tutorial-content.js：教程正文与它的排版样式：编辑器与首页共用这一份，两页的教程一字不差。
// 只依赖 COLOR（配色）与 document，不依赖任何编辑器的状态，所以首页可以单独加载它。
"use strict";

/* ========== 教程正文 ========== */

// 教程正文：按最终版面写成带层级的 HTML（导语 / 过渡句 / 编号步骤 / 关键词 / 结尾），不是一整段纯文本
// 用模板字符串整段保存而不是塞进 HTML 标签，是为了让文字与它的排版样式待在同一处，改文案不必翻回标签里
// 这段文案由使用者本人撰写，这里只做分档排版与关键词强调、一个字不增不减；正文里的「底栏提示」指随状态变化的提示条
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

/* ========== 教程正文的排版样式 ========== */

// 是否已经注入过样式：编辑器与首页各自只调用一次，这里再兜一道，重复调用不会往 head 里塞第二份
let tutorialDocStyleDone = false;

// 注入教程正文的排版样式：字号一律用 em，跟着弹窗字号一起缩放；颜色全部从 COLOR 取，避免同一个蓝在样式表里再写一份
// 序号圆标用深蓝底配浅蓝字（tipName / tipFill），关键词药丸反过来（tipFill / tipName）：
// 本项目里白色代表选中，这两处都不碰白色，读到什么颜色都不会被误认成选中态
function initTutorialDocStyle() {
  if (tutorialDocStyleDone) return;
  tutorialDocStyleDone = true;
  const css =
    '.popup.modal .doc .tut-lead { margin: 0 0 6px; font-size: 1.05em; font-weight: 700; color: ' + COLOR.tipName + '; }' +
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