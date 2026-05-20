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
        """在 localFont 目录中查找指定字体族的变体文件。"""
        if not self._local_font_dir:
            return None
        family_dir = self._local_font_dir / family
        if not family_dir.exists():
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
        """尝试插入文字，依次走 localFont → 系统 TTF → TTC 提取 → None。"""
        # 1. 直接用 font_file
        if font_file:
            try:
                fname = self._get_or_create_fontname(font_file)
                inserter(fname, font_file)
                return True
            except Exception:
                pass

        # 2. 系统 TTF/TTC
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

    def insert_textbox(self, page, rect, text, font_file=None, font_name=None,
                       font_size=12, color=(0, 0, 0), align=0):
        """在矩形区域内插入自动换行的文字（支持对齐）。"""
        def inserter(fname, ffile):
            page.insert_textbox(rect, text, fontname=fname, fontfile=ffile,
                                fontsize=font_size, color=color, align=align)

        if self._try_insert(inserter, font_file, font_name):
            return

        builtin = "china-s" if re.search(r"[\u4e00-\u9fff]", text) else "helv"
        page.insert_textbox(rect, text, fontname=builtin, fontsize=font_size,
                            color=color, align=align)

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
