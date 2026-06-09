"""字体管理模块 — 本地字体 + 系统字体查找、插入、子集化保存"""

import re
import os
import tempfile
import fitz
from pathlib import Path
from typing import Optional

# ────────────────────────────────────────────────────────────
# 系统字体映射
# ────────────────────────────────────────────────────────────
_SYSTEM_FONT_DIR = Path(
    __import__("os").environ.get("SystemRoot", r"C:\Windows")
) / "Fonts"

_SYSTEM_FONT_MAP = {
    "SimHei": "simhei.ttf",
    "SimSun": "simsun.ttc",
    "NSimSun": "simsun.ttc",
    "MicrosoftYaHei": "msyh.ttc",
    "Microsoft YaHe": "msyh.ttc",
    "MicrosoftYaHeiBold": "msyhbd.ttc",
    "KaiTi": "simkai.ttf",
    "FangSong": "simfang.ttf",
    "STSong": "STSONG.TTF",
    "STHeiti": "STHEITI.TTF",
    "STKaiti": "STKAITI.TTF",
    "STFangsong": "STFANGSO.TTF",
    "Heiti SC": "STHEITI.TTF",
    "Songti SC": "STSONG.TTF",
    "PingFang SC": "msyh.ttc",
    "Hiragino Sans GB": "msyh.ttc",
    "WenQuanYi Micro Hei": "msyh.ttc",
    "DengXian": "DENG.TTF",
    "Arial": "arial.ttf",
    "Arial Bold": "arialbd.ttf",
    "Times New Roman": "times.ttf",
    "Times New Roman Bold": "timesbd.ttf",
    "Courier New": "cour.ttf",
    "Calibri": "calibri.ttf",
}

_DISPLAY_NAMES = {
    "SimHei": "SimHei (黑体)",
    "Arimo": "Arimo",
    "Caladea": "Caladea",
    "Carlito": "Carlito",
    "Cousine": "Cousine",
    "Liberation_Serif": "Liberation Serif",
    "Open_Sans": "Open Sans",
    "Roboto": "Roboto",
    "Roboto_Mono": "Roboto Mono",
    "Tinos": "Tinos",
}

_VARIANT_PATTERNS = [
    ("bolditalic", "bolditalic"),
    ("bold", "bold"),
    ("italic", "italic"),
]


def find_system_font(font_name: str) -> Optional[str]:
    """查找系统字体文件路径。自动去掉 PDF 子集前缀 (AAAAAA+) 和变体后缀 (-0)。"""
    clean = font_name.split("+", 1)[-1] if "+" in font_name else font_name
    base = re.sub(r"-\d+$", "", clean)
    filename = (
        _SYSTEM_FONT_MAP.get(clean)
        or _SYSTEM_FONT_MAP.get(base)
        or _SYSTEM_FONT_MAP.get(font_name)
    )
    if not filename:
        return None
    path = _SYSTEM_FONT_DIR / filename
    return str(path) if path.exists() else None


def _extract_ttc_font(ttc_path: str) -> Optional[str]:
    """从 TTC 文件提取单个字体为临时 TTF 文件。"""
    try:
        from fontTools.ttLib import TTFont
        font = TTFont(ttc_path, fontNumber=0)
        tmp = tempfile.mktemp(suffix=".ttf")
        font.save(tmp)
        font.close()
        return tmp
    except Exception:
        return None


class FontManager:
    """统一管理本地字体 + 系统字体 + 文字插入 + 子集化保存。

    查找优先级：
    1. localFont 目录（项目自带字体）
    2. 系统字体（Windows Fonts）
    3. PyMuPDF 内置字体（china-s / helv）
    """

    def __init__(self, local_font_dir=None):
        self._font_id = 0
        self._tmp_files = []
        self._font_file_to_name = {}
        self._local_font_dir = Path(local_font_dir) if local_font_dir else None

    # ── 字体查找 ────────────────────────────────────────────

    def scan_local_fonts(self) -> list:
        """扫描 localFont 目录，返回字体族列表及变体信息。"""
        if not self._local_font_dir or not self._local_font_dir.exists():
            return []

        results = []
        for family_dir in sorted(self._local_font_dir.iterdir()):
            if not family_dir.is_dir():
                continue
            family = family_dir.name
            ttf_files = list(family_dir.glob("*.ttf"))
            if not ttf_files:
                continue

            variants = ["regular"]
            for ttf in ttf_files:
                name_lower = ttf.stem.lower()
                for pattern, variant_name in _VARIANT_PATTERNS:
                    if pattern in name_lower:
                        if variant_name not in variants:
                            variants.append(variant_name)
                        break

            results.append({
                "family": family,
                "display_name": _DISPLAY_NAMES.get(family, family),
                "variants": sorted(variants),
            })
        return results

    def find_local_font(self, family: str, weight: str = "normal", style: str = "normal") -> Optional[str]:
        """在 localFont 目录中查找指定字体族的变体文件。

        支持多种命名格式：
        - LiberationSerif → Liberation_Serif
        - Liberation_Serif → Liberation_Serif
        - liberationserif → Liberation_Serif
        """
        if not self._local_font_dir:
            return None

        # 尝试多种目录名格式
        possible_names = [
            family,                           # 原始名称
            family.replace("_", ""),          # 去掉下划线后的反向匹配
            family.replace(" ", "_"),         # 空格转下划线
        ]

        # 生成可能的下划线分隔格式：LiberationSerif → Liberation_Serif
        import re
        if "_" not in family:
            # 在大写字母前插入下划线（首字母除外）
            snake_case = re.sub(r'(?<!^)(?=[A-Z])', '_', family)
            possible_names.append(snake_case)

        family_dir = None
        for name in possible_names:
            candidate = self._local_font_dir / name
            if candidate.exists():
                family_dir = candidate
                break

        if not family_dir:
            return None

        need_bold = weight == "bold"
        need_italic = style == "italic"

        variant_files = {}
        for ttf in family_dir.glob("*.ttf"):
            name_lower = ttf.stem.lower()
            has_bold = "bold" in name_lower
            has_italic = "italic" in name_lower

            if has_bold and has_italic:
                key = "bolditalic"
            elif has_bold:
                key = "bold"
            elif has_italic:
                key = "italic"
            else:
                key = "regular"

            existing = variant_files.get(key)
            if existing is None:
                variant_files[key] = ttf
            elif key == "regular":
                if "regular" in name_lower and "regular" not in existing.stem.lower():
                    variant_files[key] = ttf
            elif len(ttf.stem) < len(existing.stem):
                variant_files[key] = ttf

        if need_bold and need_italic:
            result = variant_files.get("bolditalic") or variant_files.get("bold") or variant_files.get("regular")
        elif need_bold:
            result = variant_files.get("bold") or variant_files.get("regular")
        elif need_italic:
            result = variant_files.get("italic") or variant_files.get("regular")
        else:
            result = variant_files.get("regular")

        return str(result) if result else None

    # ── 字体名注册 ──────────────────────────────────────────

    def _get_or_create_fontname(self, fontfile_path: str) -> str:
        if fontfile_path in self._font_file_to_name:
            return self._font_file_to_name[fontfile_path]
        self._font_id += 1
        name = f"_XF{self._font_id}"
        self._font_file_to_name[fontfile_path] = name
        return name

    # ── 统一插入方法 ────────────────────────────────────────

    def _resolve_font(self, font_file=None, font_name=None):
        """统一解析字体：返回 (fontname, fontfile_or_None)。"""
        # 1. 指定的字体文件（localFont）
        if font_file:
            fname = self._get_or_create_fontname(font_file)
            return fname, font_file

        # 2. 系统字体
        if font_name:
            sys_font = find_system_font(font_name)
            if sys_font:
                fname = self._get_or_create_fontname(sys_font)
                return fname, sys_font

        return None, None

    def _try_insert(self, inserter, font_file, font_name):
        """尝试插入文字，依次走 localFont → 系统 TTF → TTC 提取 → 内置字体。"""
        # 1. 直接用 font_file
        if font_file:
            try:
                fname = self._get_or_create_fontname(font_file)
                inserter(fname, font_file)
                return True
            except Exception:
                pass

        # 2. 本地字体目录（localFont）
        if font_name and self._local_font_dir:
            local_font = self.find_local_font(font_name)
            if local_font:
                try:
                    fname = self._get_or_create_fontname(local_font)
                    inserter(fname, local_font)
                    return True
                except Exception:
                    pass

        # 3. 系统 TTF/TTC
        if font_name:
            sys_font = find_system_font(font_name)
            if sys_font:
                try:
                    fname = self._get_or_create_fontname(sys_font)
                    inserter(fname, sys_font)
                    return True
                except Exception:
                    pass

                if sys_font.lower().endswith(".ttc"):
                    tmp_ttf = _extract_ttc_font(sys_font)
                    if tmp_ttf:
                        try:
                            fname = self._get_or_create_fontname(sys_font + "#extracted")
                            inserter(fname, tmp_ttf)
                            self._tmp_files.append(tmp_ttf)
                            return True
                        except Exception:
                            try:
                                os.unlink(tmp_ttf)
                            except:
                                pass

        return False

    def insert_text_line(self, page, x, y, text, font_name, font_size, color):
        """插入一行文字（不自动换行）。"""
        def inserter(fname, ffile):
            page.insert_text((x, y), text, fontname=fname, fontfile=ffile,
                             fontsize=font_size, color=color)

        if self._try_insert(inserter, font_file=None, font_name=font_name):
            return

        builtin = "china-s" if re.search(r"[\u4e00-\u9fff]", text) else "helv"
        page.insert_text((x, y), text, fontname=builtin, fontsize=font_size, color=color)

    def insert_text_line_with_styles(self, page, x, y, text, base_font_name, base_font_size,
                                      base_color, inline_styles=None):
        """插入带内联样式的单行文字。

        Args:
            page: fitz.Page 对象
            x: 起始 X 坐标
            y: 基线 Y 坐标
            text: 文本内容
            base_font_name: 基础字体名称
            base_font_size: 基础字号
            base_color: 基础颜色 (r, g, b)
            inline_styles: 内联样式列表，每个样式包含:
                - start: 起始索引
                - end: 结束索引
                - bold: 是否加粗
                - italic: 是否斜体
                - underline: 是否下划线
                - color: 颜色覆盖 (r, g, b)
                - fontSize: 字号覆盖
        """
        if inline_styles is None or len(inline_styles) == 0:
            self.insert_text_line(page, x, y, text, base_font_name, base_font_size, base_color)
            return

        # 按起始位置排序样式
        sorted_styles = sorted(inline_styles, key=lambda s: s.get('start', 0))

        # 构建文本片段及其样式
        segments = []
        current_pos = 0

        for style in sorted_styles:
            start = style.get('start', 0)
            end = style.get('end', len(text))

            # 样式变化前的普通文本（使用基础样式）
            if start > current_pos:
                segments.append({
                    'text': text[current_pos:start],
                    'bold': False,
                    'italic': False,
                    'color': base_color,
                    'fontSize': base_font_size
                })

            # 样式覆盖的文本（使用内联样式，其他属性保持基础值）
            if end > start:
                seg_style = {
                    'text': text[start:end],
                    'bold': style.get('bold', False),
                    'italic': style.get('italic', False),
                    'color': tuple(style['color']) if style.get('color') else base_color,
                    'fontSize': style.get('fontSize', base_font_size),
                    'fontFamily': style.get('fontFamily', base_font_name)
                }
                segments.append(seg_style)

            current_pos = end

        # 剩余文本（使用基础样式）
        if current_pos < len(text):
            segments.append({
                'text': text[current_pos:],
                'bold': False,
                'italic': False,
                'color': base_color,
                'fontSize': base_font_size
            })

        # 逐段插入文本
        current_x = x
        underline_segments = []  # 记录需要下划线的片段

        for seg in segments:
            seg_text = seg['text']
            if not seg_text:
                continue

            font_size = seg['fontSize']
            color = seg['color']
            weight = "bold" if seg['bold'] else "normal"
            style = "italic" if seg['italic'] else "normal"
            # 使用内联字体系列或基础字体
            font_family = seg.get('fontFamily', base_font_name)

            # 查找对应字体文件
            font_file = self.find_local_font(font_family, weight, style)

            # 插入文本片段
            def inserter(fname, ffile):
                page.insert_text((current_x, y), seg_text, fontname=fname, fontfile=ffile,
                                 fontsize=font_size, color=color)

            inserted = False
            if font_file:
                try:
                    fname = self._get_or_create_fontname(font_file)
                    inserter(fname, font_file)
                    inserted = True
                except Exception:
                    pass

            if not inserted:
                # 尝试系统字体（使用内联字体系列）
                sys_font = find_system_font(font_family)
                if sys_font:
                    try:
                        fname = self._get_or_create_fontname(sys_font)
                        inserter(fname, sys_font)
                        inserted = True
                    except Exception:
                        pass

            if not inserted:
                # 回退到内置字体
                builtin = "china-s" if re.search(r"[\u4e00-\u9fff]", seg_text) else "helv"
                page.insert_text((current_x, y), seg_text, fontname=builtin,
                                 fontsize=font_size, color=color)

            # 计算文本宽度并更新 X 位置
            # 使用实际字体（内联 fontFamily 或 base_font_name）
            actual_font = font_family
            text_width = self._get_text_width(seg_text, actual_font, font_size, weight, style)
            current_x += text_width

        # 绘制下划线（在所有文本插入后）
        current_x = x
        current_pos = 0
        for style in sorted_styles:
            start = style.get('start', 0)
            end = style.get('end', len(text))

            if start > current_pos:
                # 普通文本宽度（使用基础字体）
                plain_text = text[current_pos:start]
                current_x += self._get_text_width(plain_text, base_font_name, base_font_size, "normal", "normal")

            if style.get('underline') and end > start:
                # 获取该片段的字号和文本
                seg_text = text[start:end]
                seg_font_size = style.get('fontSize', base_font_size)
                seg_font_family = style.get('fontFamily', base_font_name)

                # 计算下划线位置（使用内联 fontFamily）
                width = self._get_text_width(seg_text, seg_font_family, seg_font_size,
                                             "bold" if style.get('bold') else "normal",
                                             "italic" if style.get('italic') else "normal")

                # 绘制下划线（基线下方 1-2pt）
                underline_y = y + 1.5
                shape = page.new_shape()
                shape.draw_line((current_x, underline_y), (current_x + width, underline_y))
                shape.finish(width=0.5, color=style.get('color', base_color))
                shape.commit()
                current_x += width

            current_pos = end

    def _get_text_width(self, text, font_name, font_size, weight="normal", style="normal"):
        """精确计算文本宽度。"""
        # 查找字体文件
        font_file = self.find_local_font(font_name, weight, style)
        if not font_file:
            font_file = find_system_font(font_name)

        # 使用临时页面精确测量文本宽度
        try:
            tmp_doc = fitz.open()
            tmp_page = tmp_doc.new_page()
            fname = None
            if font_file:
                try:
                    fname = self._get_or_create_fontname(font_file)
                    # 插入文本并获取实际宽度
                    tmp_page.insert_text((0, font_size), text, fontname=fname, fontfile=font_file, fontsize=font_size)
                except:
                    pass
            if not fname:
                # 回退到内置字体
                builtin = "china-s" if re.search(r"[\u4e00-\u9fff]", text) else "helv"
                tmp_page.insert_text((0, font_size), text, fontname=builtin, fontsize=font_size)

            # 获取插入文本的边界框
            text_rect = tmp_page.get_text("dict")["blocks"][0]["bbox"]
            width = text_rect[2] - text_rect[0]
            tmp_doc.close()
            return width
        except:
            # 回退到估算
            has_chinese = bool(re.search(r"[\u4e00-\u9fff]", text))
            avg_width = 1.0 if has_chinese else 0.5
            return len(text) * font_size * avg_width

    def insert_textbox(self, page, rect, text, font_file=None, font_name=None,
                       font_size=12, color=(0, 0, 0), align=0, line_height=None):
        """在矩形区域内插入自动换行的文字（支持对齐和行高）。"""
        # 计算行高倍数（默认 1.2）
        if line_height is None:
            line_height = font_size * 1.2
        line_height_ratio = line_height / font_size if font_size > 0 else 1.2

        def inserter(fname, ffile):
            page.insert_textbox(rect, text, fontname=fname, fontfile=ffile,
                                fontsize=font_size, color=color, align=align,
                                lineheight=line_height_ratio)

        if self._try_insert(inserter, font_file, font_name):
            return

        builtin = "china-s" if re.search(r"[\u4e00-\u9fff]", text) else "helv"
        page.insert_textbox(rect, text, fontname=builtin, fontsize=font_size,
                            color=color, align=align, lineheight=line_height_ratio)

    # ── 保存 ────────────────────────────────────────────────

    def save_with_subset(self, doc: fitz.Document, output_path: str):
        """保存 PDF（子集化字体 + 压缩）。"""
        doc.subset_fonts(fallback=True)
        doc.save(output_path, garbage=4)
        for tmp in self._tmp_files:
            try:
                os.unlink(tmp)
            except:
                pass
        self._tmp_files.clear()
        self._font_file_to_name.clear()
