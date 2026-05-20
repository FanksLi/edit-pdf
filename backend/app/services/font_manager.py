"""字体管理模块 — 系统字体查找、插入、子集化保存"""

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
    "Microsoft YaHei": "msyh.ttc",
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


def find_system_font(font_name: str) -> Optional[str]:
    """查找系统字体文件路径。

    自动去掉 PDF 子集前缀 (AAAAAA+) 和变体后缀 (-0)。
    找不到返回 None。
    """
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


def scan_local_fonts(font_dir) -> list:
    """扫描 localFont 目录，返回字体族列表及变体信息。"""
    from pathlib import Path as _Path
    font_dir = _Path(font_dir)
    if not font_dir.exists():
        return []

    DISPLAY_NAMES = {
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

    VARIANT_PATTERNS = [
        ("bolditalic", "bolditalic"),
        ("bold", "bold"),
        ("italic", "italic"),
    ]

    results = []
    for family_dir in sorted(font_dir.iterdir()):
        if not family_dir.is_dir():
            continue
        family = family_dir.name
        ttf_files = list(family_dir.glob("*.ttf"))
        if not ttf_files:
            continue

        variants = ["regular"]
        for ttf in ttf_files:
            name_lower = ttf.stem.lower()
            for pattern, variant_name in VARIANT_PATTERNS:
                if pattern in name_lower:
                    if variant_name not in variants:
                        variants.append(variant_name)
                    break

        results.append({
            "family": family,
            "display_name": DISPLAY_NAMES.get(family, family),
            "variants": sorted(variants),
        })

    return results


def find_local_font(font_dir, family: str, weight: str = "normal", style: str = "normal") -> Optional[str]:
    """在 localFont 目录中查找指定字体族的变体文件。"""
    from pathlib import Path as _Path
    font_dir = _Path(font_dir)
    family_dir = font_dir / family
    if not family_dir.exists():
        return None

    need_bold = weight == "bold"
    need_italic = style == "italic"

    # Build a mapping from variant type to file, preferring exact matches
    variant_files = {}
    for ttf in family_dir.glob("*.ttf"):
        name_lower = ttf.stem.lower()
        # Determine what variant this file represents
        has_bold = "bold" in name_lower
        has_italic = "italic" in name_lower

        if has_bold and has_italic:
            key = "bolditalic"
        elif has_bold:
            key = "bold"
        elif has_italic:
            key = "italic"
        elif "regular" in name_lower:
            key = "regular"
        else:
            key = "regular"

        existing = variant_files.get(key)
        if existing is None:
            variant_files[key] = ttf
        elif key == "regular":
            # For regular: always prefer files with "regular" in name
            if "regular" in name_lower and "regular" not in existing.stem.lower():
                variant_files[key] = ttf
            # Don't let fallback overwrite a named regular
        elif len(ttf.stem) < len(existing.stem):
            # For other variants: prefer shorter stem (exact match)
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


def _extract_ttc_font(ttc_path: str) -> Optional[str]:
    """从 TTC 文件提取单个字体为临时 TTF 文件。

    解决 PyMuPDF insert_text 不支持 TTC 和字体名空格问题。
    返回临时文件路径，调用者负责删除。失败返回 None。
    """
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
    """管理文字插入与字体子集化保存。

    方案：
    1. insert_text_line — 用 insert_text(fontfile=系统字体) 直接插入，
       每次唯一命名避免 PyMuPDF 复用旧子集
    2. save_with_subset — 保存前 subset_fonts() 自动裁剪未用字形
    """

    def __init__(self):
        self._font_id = 0
        self._tmp_files = []  # 临时提取的 TTC 单体文件
        self._font_file_to_name = {}  # fontfile path → fontname 映射，同文件共享一个 name

    def _get_or_create_fontname(self, fontfile_path: str) -> str:
        """同一个字体文件共享一个 fontname，避免重复嵌入。
        使用 _XF 前缀避免与 PDF 已有字体名冲突。
        """
        if fontfile_path in self._font_file_to_name:
            return self._font_file_to_name[fontfile_path]
        self._font_id += 1
        name = f"_XF{self._font_id}"
        self._font_file_to_name[fontfile_path] = name
        return name

    def insert_text_line(self, page, x, y, text, font_name, font_size, color):
        """插入一行文字。

        优先级：
        1. TTF 系统字体直接插入
        2. TTC 系统字体提取单体后插入
        3. 内置 china-s/helv（兜底）
        """
        sys_font = find_system_font(font_name)
        if sys_font:
            # TTF / TTC 都直接用（PyMuPDF 原生支持）
            try:
                fname = self._get_or_create_fontname(sys_font)
                page.insert_text(
                    (x, y), text, fontname=fname, fontfile=sys_font,
                    fontsize=font_size, color=color,
                )
                return
            except Exception:
                pass

            # TTC 直接失败 → 尝试提取单体
            if sys_font.lower().endswith(".ttc"):
                tmp_ttf = _extract_ttc_font(sys_font)
                if tmp_ttf:
                    try:
                        fname = self._get_or_create_fontname(sys_font + "#extracted")
                        page.insert_text(
                            (x, y), text, fontname=fname, fontfile=tmp_ttf,
                            fontsize=font_size, color=color,
                        )
                        self._tmp_files.append(tmp_ttf)
                        return
                    except Exception:
                        try:
                            os.unlink(tmp_ttf)
                        except:
                            pass

        builtin = "china-s" if re.search(r"[\u4e00-\u9fff]", text) else "helv"
        page.insert_text((x, y), text, fontname=builtin, fontsize=font_size, color=color)

    def save_with_subset(self, doc: fitz.Document, output_path: str):
        """保存 PDF（子集化字体 + 压缩）。

        _XF 前缀确保新字体不与 PDF 已有字体冲突，
        subset_fonts(fallback=True) 安全地裁剪所有未用字形。
        """
        doc.subset_fonts(fallback=True)
        doc.save(output_path, garbage=4)
        # 清理临时 TTC 单体文件
        for tmp in self._tmp_files:
            try:
                os.unlink(tmp)
            except:
                pass
        self._tmp_files.clear()
        self._font_file_to_name.clear()
