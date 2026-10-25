#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-dist.py —— 把根目录的源码铺成 dist/，顺手把要上传的体积压到最小。

为什么单独有这一步：源码目录改完就能直接双击打开，本身不需要任何构建；
但线上要的是「越小越好」，于是铺 dist 的时候顺带做三件事：
  一、每页的脚本按页面自己的加载顺序拼成一份，交给 terser 去掉注释与空白，并把名字改短；
  二、两个页面与整站样式表里的注释、多余空白一并去掉；
  三、清掉 macOS 自动生成的 .DS_Store。
源码一个字都不动：压缩只发生在 dist 里的副本上，根目录仍然是可读的那一份。

产物：dist/index.html、dist/editor.html、dist/css/（样式表与两档字体）、
      dist/js/home.min.js（首页那一份）、dist/js/editor.min.js（编辑器那一份）

为什么必须拼成一份才能改名：27 个脚本是一段段各自执行的普通脚本，靠顶层的函数名互相调用。
单个文件里改名字，这些跨文件的名字就对不上了；拼成一份之后，跨文件调用变成同一份文件内部的调用，
改名才是安全的。拼接顺序直接从页面 HTML 的 script 标签里读，不再另抄一份，顺序不会与页面漂移。

不做什么：不改对象属性名（不传 --mangle-props）。属性名一改，DOM 上那些同名属性也会被波及
（比如 elem.name、node.children），收益不大而风险很高；字符串里的中文一律照原样保留。

依赖：Python 3（只用标准库）、Node 与 npx（用来下载并运行 terser 5，首次运行需要联网）。

用法（在项目根目录执行）：
    python3 tools/build-dist.py              # 正常打包：拼脚本、压缩、清 .DS_Store
    python3 tools/build-dist.py --no-minify  # 只铺不压：脚本仍是 27 份，用来对照排查问题
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

# 项目根目录（本脚本在 tools/ 下，往上一层就是根目录）
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

# 要铺进 dist 的东西：两个页面、样式目录、脚本目录
# 源码文档、旧版本文件、字体原稿都刻意不在其中，它们不进发布
SYNC_ITEMS = ["index.html", "editor.html", "favicon.svg", "css", "js"]

# 要处理的页面：路径与压缩产物名。产物名取页面自己的名字，一眼看得出哪份是哪页的
PAGES = [("index.html", "js/home.min.js"), ("editor.html", "js/editor.min.js")]

# terser 的大版本写死：哪天上游出了不兼容的变动，线上的产物不至于跟着一起变
TERSER_SPEC = "terser@5"

# terser 的参数：压缩跑两遍、按顶层可见来算；改名只改顶层；语法目标定在 ES2020
# ES2020 是这套代码用到的上限（可选链、空值合并），再高的目标没有意义，再低会把 const 反编译成 var
TERSER_ARGS = ["-c", "passes=2,toplevel=true", "-m", "toplevel=true", "--ecma", "2020"]

# 离线缓存脚本：模板在 tools/ 下，打包时把版本号填进去，写成 dist/sw.js
# 版本号必须写进这份脚本本身：浏览器判定有没有新版，比的就是 sw.js 的字节
SW_TEMPLATE = os.path.join(ROOT, "tools", "sw-template.js")
SW_PLACEHOLDER = "__APP_VERSION__"

# 页面里一条脚本标签的完整形态：本项目里所有脚本都是外链、都不带其它属性，所以匹配得很死
SCRIPT_TAG_RE = re.compile(r'<script\s+src="(js/[^"]+\.js)"\s*></script>')


def node_env():
    """把常见的 Node 安装位置提到 PATH 最前面：本机 PATH 上可能先撞到其它版本的 node。"""
    env = os.environ.copy()
    env["PATH"] = "/usr/local/bin:/opt/homebrew/bin:" + env.get("PATH", "")
    return env


def check_terser():
    """先确认 npx 能跑起 terser；拿不到就直接退出，别等铺到一半才发现。"""
    try:
        subprocess.run(["npx", "--yes", TERSER_SPEC, "--version"], check=True,
                       env=node_env(), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except FileNotFoundError:
        sys.exit("找不到 npx：这台机器上没有可用的 Node，请先安装 Node。")
    except subprocess.CalledProcessError as err:
        detail = err.stderr.decode("utf-8", "ignore").strip()
        sys.exit("npx 跑 terser 失败（首次运行需要联网把它下载下来）：" + detail)


def sync_dist():
    """按清单重建 dist：整个删掉再拷，保证 dist 里只会有这一次铺进去的东西。"""
    shutil.rmtree(DIST, ignore_errors=True)
    os.makedirs(DIST)
    for name in SYNC_ITEMS:
        src = os.path.join(ROOT, name)
        dst = os.path.join(DIST, name)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)


def find_scripts(html):
    """按出现顺序取出页面引用的脚本路径；这份顺序就是拼接顺序。"""
    return SCRIPT_TAG_RE.findall(html)


def read_text(path):
    """统一按 UTF-8 读源码，出错直接报文件名，别把问题藏到最后。"""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_text(path, text):
    """统一的写文件口子：结尾补一个换行，产物在任何编辑器里都是正常文本。"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(text if text.endswith("\n") else text + "\n")


def bundle_js(scripts, page_name, tmp_dir):
    """把一页的脚本按顺序拼成一份，交给 terser 压缩，返回压缩产物的文本。"""
    parts = []
    for rel in scripts:
        src = os.path.join(ROOT, rel)
        if not os.path.isfile(src):
            sys.exit("页面里引用了 " + rel + "，但源码目录里没有这个文件。")
        # 每份之间插一个分号再换行：上一份若以 } 结尾、下一份若以 ( 开头，
        # 直接首尾相接会被解析成「调用上一个函数」，插一个分号就切得干干净净
        parts.append(read_text(src))
    joined = "\n;\n".join(parts)

    raw_path = os.path.join(tmp_dir, page_name + ".raw.js")
    min_path = os.path.join(tmp_dir, page_name + ".min.js")
    write_text(raw_path, joined)
    subprocess.run(["npx", "--yes", TERSER_SPEC, raw_path] + TERSER_ARGS + ["-o", min_path],
                   check=True, env=node_env())
    return read_text(min_path)


def strip_page_html(html, bundle_name):
    """页面收尾：一串脚本标签换成一条压缩产物，再去掉注释与多余空白。"""
    tags = list(SCRIPT_TAG_RE.finditer(html))
    if not tags:
        sys.exit("页面里没找到脚本标签，打包脚本可能已经和页面结构对不上了。")
    # 从后往前删掉多余的标签，前面记下的位置才不会因为删除而错位
    out = html
    for m in reversed(tags[1:]):
        out = out[:m.start()] + out[m.end():]
    first = tags[0]
    new_tag = '<script src="' + bundle_name + '"></script>'
    out = out[:first.start()] + new_tag + out[first.end():]
    # 注释整段扔掉；剩下的连续空白折成一个空格，中文正文在 HTML 里本来就按一个空格排版
    out = re.sub(r"<!--.*?-->", "", out, flags=re.S)
    out = re.sub(r"[ \t\r\n]+", " ", out)
    return out.strip()


def minify_css(text):
    """去掉样式表里的注释与多余空白：逐字符走，字符串内部的斜杠星号不动。"""
    out = []
    i = 0
    n = len(text)
    quote = None
    pending_space = False
    while i < n:
        ch = text[i]
        if quote is not None:
            # 引号内部照原样搬：url("...") 与字体名里的内容一个字符都不改
            out.append(ch)
            if ch == "\\" and i + 1 < n:      # 转义序列：把下一个字符一起带走，免得误判收尾引号
                out.append(text[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in "\"'":
            if pending_space and out:
                out.append(" ")
            pending_space = False
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == "/" and text[i + 1:i + 2] == "*":
            end = text.find("*/", i + 2)      # 注释当空白处理：两侧可能因此连成一个记号
            i = n if end < 0 else end + 2
            pending_space = True
            continue
        if ch in " \t\r\n\f":
            pending_space = True
            i += 1
            continue
        if ch in "{};,":
            while out and out[-1] == " ":     # 结构符号两侧的空格一律不要
                out.pop()
            pending_space = False
            out.append(ch)
            i += 1
            continue
        if pending_space and out:
            out.append(" ")
        pending_space = False
        out.append(ch)
        i += 1
    return "".join(out).strip().replace(";}", "}")


def clean_ds_store():
    """清掉 macOS 自动生成的 .DS_Store：它在每个进过的目录里都会冒出来，传上去没有任何用。"""
    removed = 0
    for cur, _dirs, files in os.walk(DIST):
        for name in files:
            if name == ".DS_Store":
                os.remove(os.path.join(cur, name))
                removed += 1
    return removed


def check_assets():
    """核对页面与样式表引用的本地文件是否都真的在 dist 里，少一个线上就会有一条静默失效的请求。"""
    problems = []
    for page, _bundle in PAGES:
        html = read_text(os.path.join(DIST, page))
        refs = re.findall(r'(?:src|href)="([^"]+)"', html)
        for ref in refs:
            if ref.startswith(("http://", "https://", "#", "data:")):
                continue
            if not os.path.isfile(os.path.join(DIST, ref)):
                problems.append(page + " 引用了 " + ref + "，dist 里没有")
    css_path = os.path.join(DIST, "css", "style.css")
    for ref in re.findall(r'url\("([^"]+)"\)', read_text(css_path)):
        if not os.path.isfile(os.path.join(os.path.dirname(css_path), ref)):
            problems.append("style.css 引用了 " + ref + "，dist 里没有")
    return problems


def report(before_total):
    """打印逐项体积与合计，顺带给出与上一次相比省下多少。"""
    rows = []
    for cur, _dirs, files in os.walk(DIST):
        for name in files:
            p = os.path.join(cur, name)
            rows.append((os.path.relpath(p, DIST), os.path.getsize(p)))
    rows.sort(key=lambda r: -r[1])
    print("--- dist 逐项体积 ---")
    for rel, size in rows:
        print("  {:>9.1f} KB  {}".format(size / 1024.0, rel))
    total = sum(size for _rel, size in rows)
    print("  合计 {:.1f} KB，共 {} 个文件".format(total / 1024.0, len(rows)))
    if before_total:
        saved = before_total - total
        print("  比上一次（{:.1f} KB）省下 {:.1f} KB，约 {:.0f}%".format(
            before_total / 1024.0, saved / 1024.0, 100.0 * saved / before_total))


def read_app_version():
    """从 js/config.js 读出应用版本号：全站只此一处定义，首页副标题与离线缓存都跟它走。"""
    match = re.search(r'appVersion:\s*"([^"]+)"', read_text(os.path.join(ROOT, "js", "config.js")))
    if not match:
        sys.exit("js/config.js 里没找到 appVersion，离线缓存不知道填哪个版本号。")
    return match.group(1)


def write_sw(version):
    """按模板生成 dist/sw.js，把版本号填进去；版本一变，浏览器才会认出新版并重新下载。"""
    template = read_text(SW_TEMPLATE)
    if SW_PLACEHOLDER not in template:
        sys.exit("sw 模板里没有 " + SW_PLACEHOLDER + " 占位符，产出的脚本不会随版本更新。")
    write_text(os.path.join(DIST, "sw.js"), template.replace(SW_PLACEHOLDER, version))


def main():
    no_minify = "--no-minify" in sys.argv[1:]
    # 先量一下现在 dist 的体积，好在收尾时报出这一次省了多少；没有 dist 就按 0 算
    before = 0
    for cur, _dirs, files in os.walk(DIST):
        for name in files:
            before += os.path.getsize(os.path.join(cur, name))

    if not os.path.isdir(os.path.join(ROOT, "js")):
        sys.exit("当前目录看起来不是项目根目录：请在本项目的根目录下运行这个脚本。")

    if not no_minify:
        print("第一步：确认 terser 可用")
        check_terser()

    print("第二步：重建 dist")
    sync_dist()
    app_version = read_app_version()
    write_sw(app_version)
    print("  生成 sw.js（版本 {}）".format(app_version))

    if no_minify:
        # 只铺不压：脚本仍是 27 份，页面也保持原样，用来和压缩版对照
        print("第三步：跳过压缩（--no-minify），dist 里是未压缩的副本")
    else:
        print("第三步：逐页拼脚本、压缩改名、收尾页面")
        # 拼接与压缩的中间文件放在系统临时目录：项目目录里不留任何过程产物
        tmp_dir = tempfile.mkdtemp(prefix="laser-gate-build-")
        try:
            to_remove = set()   # 两页共用的脚本（util.js 等）会重复出现，攒到最后一起删
            for page, bundle in PAGES:
                html = read_text(os.path.join(DIST, page))
                scripts = find_scripts(html)
                print("  {} 拼 {} 个脚本 -> {}".format(page, len(scripts), bundle))
                minified = bundle_js(scripts, os.path.splitext(page)[0], tmp_dir)
                write_text(os.path.join(DIST, bundle), minified)
                write_text(os.path.join(DIST, page), strip_page_html(html, bundle))
                to_remove.update(scripts)
            # 拼进去的脚本在 dist 里已经没有用了，只留两份压缩产物
            for rel in sorted(to_remove):
                os.remove(os.path.join(DIST, rel))
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        print("第四步：压缩样式表")
        css_path = os.path.join(DIST, "css", "style.css")
        css_src = read_text(css_path)
        css_min = minify_css(css_src)
        # 自查：括号必须成对，字体路径必须还在，否则宁可不压也不交付坏样式
        if css_min.count("{") != css_src.count("{") or css_min.count("}") != css_src.count("}"):
            sys.exit("样式表压缩后括号数目对不上，已中止，dist 里还是未压缩的那一份。")
        if css_min.count("url(") != css_src.count("url("):
            sys.exit("样式表压缩后字体路径数目对不上，已中止。")
        write_text(css_path, css_min)
        print("  style.css {:.1f} KB -> {:.1f} KB".format(
            len(css_src.encode("utf-8")) / 1024.0, len(css_min.encode("utf-8")) / 1024.0))

    print("第五步：清掉 .DS_Store")
    removed = clean_ds_store()
    print("  清掉 {} 个".format(removed))

    print("第六步：核对引用")
    problems = check_assets()
    if problems:
        for p in problems:
            print("  [缺] " + p)
        sys.exit("dist 里有引用落空，已中止，不要就这样部署。")
    print("  页面与样式表引用的文件都在 dist 里")

    print("第七步：完成")
    report(before)
    return 0


if __name__ == "__main__":
    sys.exit(main())
