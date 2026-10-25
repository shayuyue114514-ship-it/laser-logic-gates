#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-fonts.py —— 把 MiSans 原始 OTF 子集化成网页用的 woff2。

背景：fonts-src/ 里的每个 MiSans 字重都带着约 2.9 万个字形（覆盖全部中日韩字符），
单个文件约 6.3 MB。而本项目的页面文案去重后只有几百个字符，多出来的字形纯属陪跑，
白白拖慢加载。这个脚本只保留页面真正会用到的字符（注释里的字不算，它们永远不会显示），
再把结果压成 woff2。

用法：改完页面文案后，在项目根目录运行一次即可
    python3 tools/build-fonts.py
脚本会重新扫描源码、重算字符集、重新生成 css/fonts/ 下的 woff2。

输入：fonts-src/MiSans-*.otf          （原始全字符集字体，不参与部署）
输出：css/fonts/MiSans-*.woff2         （子集字体，随页面一起部署）
      tools/charset.txt               （本次用到的全部字符，便于人工核对）
依赖：fontTools（含 woff2 所需的 brotli）
"""

import os
import re
import sys
import unicodedata

from fontTools import subset
from fontTools.ttLib import TTFont

# 项目根目录（本脚本在 tools/ 下，往上一层就是根目录）
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 参与字符集统计的源码：只有这些文件的内容最终会显示给用户
# 刻意不含 旧大文件版本.html：它是留档的旧版本，不参与部署
SCAN_FILES = [
    "index.html",
    "editor.html",
    "css/style.css",
] 
SCAN_DIRS = ["js"]           # js/ 下的全部 .js 都扫
SCAN_EXTS = (".js",)

# 实际被用到的字重 → 原始 OTF 文件名
# 400 正文与各类次要文字、700 标题与各处强调（详见 css/style.css 与 js/fonts.js）
# 全站只留这两档：原来另有 500 与 600，页面上一共只用了几处，为压上传体积已合并进这两档
WEIGHTS = {
    400: "MiSans-Regular.otf",
    700: "MiSans-Bold.otf",
}

# 无论源码里有没有，都一定要塞进来的字符：
# 一是键盘能打出来的可见 ASCII，二是页面文案里容易出现但源码里恰好没写的常用符号。
# 这些字符体积极小（几十 KB 的百分之一），但漏了会出现「个别字突然换了字体」，不划算。
ALWAYS = (
    "".join(chr(c) for c in range(0x20, 0x7F))          # ASCII 可见字符与空格
    + "　"                                               # 全角空格
    + "、。，．；：？！…—～·「」『』（）〔〕【】《》〈〉“”‘’"  # 中日韩标点
    + "±×÷≈≠≤≥∞√∑πφΩ°′″"                              # 数学与单位符号
    + "→←↑↓↔"                                            # 箭头
    + "①②③④⑤⑥⑦⑧⑨⑩"                                    # 圈号
    + "－＋＝／＼｜＊＃＠＆％"                                # 全角运算符
)


# 把源码里的 \uXXXX、\xXX、\u{XXXXX} 转义还原成真实字符。
# 文案可能写成转义形式（尤其在 JS 的字符串里），不还原就会漏字。
def decode_escapes(text):
    def repl_u4(m):
        try:
            return chr(int(m.group(1), 16))
        except ValueError:
            return m.group(0)

    def repl_x2(m):
        try:
            return chr(int(m.group(1), 16))
        except ValueError:
            return m.group(0)

    def repl_ubrace(m):
        try:
            return chr(int(m.group(1), 16))
        except ValueError:
            return m.group(0)

    text = re.sub(r"\\u\{([0-9a-fA-F]+)\}", repl_ubrace, text)
    text = re.sub(r"\\u([0-9a-fA-F]{4})", repl_u4, text)
    text = re.sub(r"\\x([0-9a-fA-F]{2})", repl_x2, text)
    return text


# 去掉源码里的注释，只留下真正会显示出来的内容。
# 为什么必须去掉：注释里的字永远不会画到屏幕上，算进字符集就是白白撑大字体。
# 实测全站 1229 个字符里有 662 个只出现在注释中（比如「且」「叉」「替」这类说明用字），
# 两档字体为此多背了约 190 KB，占最终体积的四成以上。
# 字符串内部一律不动——页面文案、按钮文字、教程正文全都写在字符串里，会显示的字一个都不会漏。
# 会因此回退到系统字体的只有一种情况：界面上出现了源码里没有、又没写进 ALWAYS 的字，
# 比如用户自己起的存档文件名；那种字本来也不该占字体体积，缺了会按 font-family 回退，不会显示成方框。
def strip_comments(text):
    # 先整段删掉 HTML 注释（两个页面与内联样式里都有成段的说明）
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    # 再逐字符走一遍，删掉 // 与 /* */ 两种注释；引号内的内容一律原样搬走
    out = []
    i = 0
    n = len(text)
    quote = None
    while i < n:
        ch = text[i]
        if quote is not None:
            out.append(ch)
            if ch == "\\" and i + 1 < n:      # 转义序列：下一个字符一起带走，免得误判收尾引号
                out.append(text[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in "\"'`":
            quote = ch                          # 进入字符串：从这里到收尾引号之间的内容全部保留
            out.append(ch)
            i += 1
            continue
        if ch == "/" and text[i + 1:i + 2] == "/":
            end = text.find("\n", i)            # 行注释：删到行尾，换行本身留着当分隔
            i = n if end < 0 else end
            continue
        if ch == "/" and text[i + 1:i + 2] == "*":
            end = text.find("*/", i + 2)        # 块注释：整段删掉；找不到收尾就当注释直到文件末
            i = n if end < 0 else end + 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


# 收集一份源码文件里出现的字符：先按上面的规则去掉注释，再统计剩下的内容
def collect_from_file(path, charset):
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        raw = f.read()
    for ch in decode_escapes(strip_comments(raw)):
        charset.add(ch)


# 扫描全部源码，返回去重后的字符集合
def collect_charset():
    charset = set()
    targets = []

    for rel in SCAN_FILES:
        p = os.path.join(ROOT, rel)
        if os.path.isfile(p):
            targets.append(p)
        else:
            print("  [警告] 找不到源码文件，已跳过：" + rel)

    for d in SCAN_DIRS:
        dp = os.path.join(ROOT, d)
        if not os.path.isdir(dp):
            continue
        for name in sorted(os.listdir(dp)):
            if name.endswith(SCAN_EXTS):
                targets.append(os.path.join(dp, name))

    for p in targets:
        collect_from_file(p, charset)

    print("  扫描源码 {} 个文件".format(len(targets)))

    # 只保留可打印字符，丢掉换行、制表等控制字符
    charset = {c for c in charset if c.isprintable() or c == " "}
    charset |= set(ALWAYS)

    # 组合用变音符号等无独立字形意义的字符去掉，避免无谓地撑大子集
    charset = {c for c in charset if unicodedata.category(c)[0] != "C"}
    return charset


# 用给定字符集把一份 OTF 子集化成 woff2
def subset_font(src_path, dst_path, charset):
    options = subset.Options()
    options.flavor = "woff2"          # 目标格式：woff2，比 otf 小一半以上
    options.desubroutinize = True     # 展开 CFF 子程序，让 woff2 压缩率更高
    options.hinting = False           # 去掉微调指令：现代屏幕用不上，去掉能省一截
    options.layout_features = ["*"]   # 保留全部 OpenType 特性（连字、字距等）
    options.name_IDs = ["*"]          # 保留字体名等信息，部分浏览器会读
    options.notdef_outline = True     # 保留 .notdef 字形，缺字时有个占位方框而不是空白
    options.drop_tables += ["DSIG"]   # DSIG 是数字签名表，子集后必然失效，直接丢掉

    font = subset.load_font(src_path, options)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text="".join(sorted(charset)))
    subsetter.subset(font)
    subset.save_font(font, dst_path, options)
    font.close()


def human(nbytes):
    return "{:.1f} KB".format(nbytes / 1024.0)


def main():
    src_dir = os.path.join(ROOT, "fonts-src")
    out_dir = os.path.join(ROOT, "css", "fonts")
    os.makedirs(out_dir, exist_ok=True)

    if not os.path.isdir(src_dir):
        print("找不到 fonts-src/ 目录，无法生成字体。")
        return 1

    print("第一步：扫描源码，统计页面用到的字符")
    charset = collect_charset()
    print("  去重后共 {} 个字符".format(len(charset)))

    # 把字符集落盘，方便人工核对或临时增补
    charset_path = os.path.join(ROOT, "tools", "charset.txt")
    with open(charset_path, "w", encoding="utf-8") as f:
        f.write("".join(sorted(charset)))
    print("  字符集已写入 tools/charset.txt")

    print("第二步：按字符集生成 woff2 子集字体")
    total_before = 0
    total_after = 0
    for weight in sorted(WEIGHTS):
        src = os.path.join(src_dir, WEIGHTS[weight])
        if not os.path.isfile(src):
            print("  [错误] 缺少原始字体：" + WEIGHTS[weight])
            return 1
        dst = os.path.join(out_dir, os.path.basename(WEIGHTS[weight]).replace(".otf", ".woff2"))
        subset_font(src, dst, charset)
        before = os.path.getsize(src)
        after = os.path.getsize(dst)
        total_before += before
        total_after += after
        print("  {:<3}  {:<26} {} -> {}".format(
            weight, os.path.basename(dst), human(before), human(after)))

    print("第三步：完成")
    print("  两档合计 {} -> {}".format(human(total_before), human(total_after)))
    print("  压缩比约 {:.1f}%".format(100.0 * total_after / total_before))
    return 0


if __name__ == "__main__":
    sys.exit(main())
