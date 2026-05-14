"""PyMuPDF 核心封装 - PDF 处理服务"""

import fitz
import uuid
import base64
import re
import os
from pathlib import Path
from typing import List, Dict, Any, Optional

from app.config import RENDER_DIR, OUTPUT_DIR

# 系统字体映射：常见 PDF 字体名 → Windows 字体文件路径
_SYSTEM_FONT_DIR = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "Fonts"
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


def _find_system_font(font_name: str) -> Optional[str]:
    """查找系统字体文件路径，找不到返回 None"""
    # 去掉 PDF 字体名中的子集前缀 (如 "AAAAAA+SimHei")
    clean = font_name.split("+", 1)[-1] if "+" in font_name else font_name
    filename = _SYSTEM_FONT_MAP.get(clean) or _SYSTEM_FONT_MAP.get(font_name)
    if not filename:
        return None
    path = _SYSTEM_FONT_DIR / filename
    return str(path) if path.exists() else None


class PDFService:
    """PDF 处理服务类"""

    def __init__(self, file_path: str):
        self.doc = fitz.open(file_path)
        self.file_id = uuid.uuid4().hex
        self.page_sizes: List[tuple] = []
        for page in self.doc:
            self.page_sizes.append((page.rect.width, page.rect.height))

    def get_page_count(self) -> int:
        """获取总页数"""
        return len(self.doc)

    def get_page_size(self, page_num: int) -> tuple:
        """获取指定页面尺寸 (width, height)"""
        if page_num < 0 or page_num >= len(self.page_sizes):
            raise ValueError(f"Page {page_num} out of range")
        return self.page_sizes[page_num]

    def _extract_spans(self, page) -> List[Dict[str, Any]]:
        """提取页面所有 span（内部方法）"""
        blocks = page.get_text("dict")["blocks"]
        spans = []

        for block in blocks:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    color_int = span.get("color", 0)
                    r = (color_int >> 16) & 0xFF
                    g = (color_int >> 8) & 0xFF
                    b = color_int & 0xFF

                    spans.append({
                        "text": span["text"],
                        "bbox": list(span["bbox"]),
                        "fontSize": span["size"],
                        "fontName": span["font"],
                        "color": [r/255, g/255, b/255],
                        "origin": list(span.get("origin", [span["bbox"][0], span["bbox"][3]])),
                    })
        return spans

    def _dominant_font_size(self, spans: list) -> float:
        """取一行中多数 span 的字号（忽略行内少量特殊标记）"""
        if not spans:
            return 10
        from collections import Counter
        # 按 0.5pt 精度四舍五入后统计
        sizes = [round(s["size"] * 2) / 2 for s in spans]
        counts = Counter(sizes)
        return counts.most_common(1)[0][0]

    def _gap_based_paragraphs(self, blocks: list) -> List[Dict[str, Any]]:
        """行距聚类 + 字号段落检测

        断开信号：
        1. 行距跳变：当前 gap 明显大于段内参考间距
        2. 字号突变：相邻行字号差 > 2pt

        同行距 + 同字号 + 连续 → 合为一段
        行内不同字体字号不影响（整行为一个单位）
        """
        # Step 1: 打平所有行为统一的行列表
        flat_lines = []
        for block_idx, block in enumerate(blocks):
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                spans = sorted(line["spans"], key=lambda s: s["bbox"][0])
                if not spans:
                    continue
                first = spans[0]
                color_int = first.get("color", 0)
                flat_lines.append({
                    "text": "".join(s["text"] for s in spans),
                    "y0": first["bbox"][1],
                    "fontSize": self._dominant_font_size(spans),
                    "fontName": first["font"],
                    "color": [
                        ((color_int >> 16) & 0xFF) / 255,
                        ((color_int >> 8) & 0xFF) / 255,
                        (color_int & 0xFF) / 255,
                    ],
                    "spans_bboxes": [s["bbox"] for s in spans],
                    "block_idx": block_idx,
                })

        if not flat_lines:
            return []

        flat_lines.sort(key=lambda l: (l["y0"], l["spans_bboxes"][0][0]))

        if len(flat_lines) == 1:
            return self._build_paragraph_result([flat_lines])

        # Step 2: 计算所有相邻行间距
        gaps = []
        for i in range(1, len(flat_lines)):
            gaps.append(flat_lines[i]["y0"] - flat_lines[i - 1]["y0"])

        # Step 3: 局部行距跳变检测
        # 核心思路：跟踪"当前段落的参考间距"，如果 gap 跳变到更大值 → 断点
        # 参考间距 = 当前段落内最近的"正常"间距
        breaks = [False] * len(gaps)

        # 用页面中最常见的间距作为"正常行距"的初始参考
        normal_gaps = [g for g in gaps if g >= flat_lines[0]["fontSize"] * 0.5]
        if normal_gaps:
            sorted_normal = sorted(normal_gaps)
            base_gap = sorted_normal[len(sorted_normal) // 2]
        else:
            base_gap = flat_lines[0]["fontSize"] * 1.2

        # 当前段落的参考间距（随段落内行距动态更新）
        current_ref = base_gap

        for i in range(len(gaps)):
            gap = gaps[i]
            prev_line = flat_lines[i]
            curr_line = flat_lines[i + 1]

            # 信号 1: 字号突变（>2pt）
            font_size_changed = abs(curr_line["fontSize"] - prev_line["fontSize"]) > 2

            # 跳过异常小 gap（标题内部重叠等）
            if gap < flat_lines[i]["fontSize"] * 0.5:
                if font_size_changed:
                    breaks[i] = True
                    current_ref = base_gap
                continue

            # 信号 2: 行距跳变
            # gap > ref × 1.3 且 gap - ref > 字号 × 0.5
            relative_jump = gap / current_ref if current_ref > 0 else 1
            absolute_jump = gap - current_ref
            min_abs_jump = flat_lines[i]["fontSize"] * 0.5
            gap_jumped = relative_jump > 1.3 and absolute_jump > min_abs_jump

            if gap_jumped or font_size_changed:
                breaks[i] = True
                # 断开后重置参考间距
                current_ref = base_gap
            else:
                # 没断开 → 更新参考间距为当前 gap（跟踪段内行距变化）
                current_ref = gap

        # Step 4: 按断点分组
        para_groups = []
        current = [flat_lines[0]]

        for i in range(len(breaks)):
            if breaks[i]:
                para_groups.append(current)
                current = [flat_lines[i + 1]]
            else:
                current.append(flat_lines[i + 1])

        para_groups.append(current)

        return self._build_paragraph_result(para_groups)

    def _build_paragraph_result(self, para_groups: list) -> List[Dict[str, Any]]:
        """从分组构建段落数据，lineHeight 用组内实际间距，z_index 用原始 block 顺序"""
        all_gaps = []
        for group in para_groups:
            for i in range(1, len(group)):
                all_gaps.append(group[i]["y0"] - group[i - 1]["y0"])
        global_median = sorted(all_gaps)[len(all_gaps) // 2] if all_gaps else 12

        result = []
        for group in para_groups:
            text = "\n".join(l["text"] for l in group)

            all_bb = [bb for l in group for bb in l["spans_bboxes"]]
            x0 = min(b[0] for b in all_bb)
            y0 = min(b[1] for b in all_bb)
            x1 = max(b[2] for b in all_bb)
            y1 = max(b[3] for b in all_bb)

            rep = group[0]

            # lineHeight: 优先用组内实际间距，fallback 到全局 median
            if len(group) >= 2:
                group_gaps = [group[i]["y0"] - group[i - 1]["y0"] for i in range(1, len(group))]
                lh = sorted(group_gaps)[len(group_gaps) // 2]
            else:
                lh = global_median

            # z_index: 用组内第一行所在原始 block 的索引
            z_index = min(l.get("block_idx", 0) for l in group)

            result.append({
                "text": text,
                "bbox": [x0, y0, x1, y1],
                "fontSize": rep["fontSize"],
                "fontName": rep["fontName"],
                "color": rep["color"],
                "lineHeight": lh,
                "z_index": z_index,
            })

        return result

    def get_page_text(self, page_num: int) -> List[Dict[str, Any]]:
        """提取页面文字，按行间距比值自动分段"""
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        blocks = page.get_text("dict")["blocks"]
        return self._gap_based_paragraphs(blocks)

    def get_page_drawings(self, page_num: int) -> List[Dict[str, Any]]:
        """提取页面绘图元素（矩形、线条等），带 z_index

        z_index 基于内容流 xref 顺序：
        找到绘图所在的内容流 xref 位置，
        统计该位置之前所有内容流产生的 text/image block 数量。
        """
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        drawings = page.get_drawings()

        if not drawings:
            return []

        import re

        content_xrefs = page.get_contents()
        if not content_xrefs:
            return []

        # 获取 text/image blocks 总数作为最大 z_index
        blocks = page.get_text("dict")["blocks"]
        total_blocks = len(blocks)

        # 统计每个内容流 xref 产生的 block 数量
        xref_block_count = {}

        # 找出主要的 text xref（BT 最多的那个）
        text_xref = None
        max_bt = 0
        other_text_xrefs = []
        for xref in content_xrefs:
            stream = self.doc.xref_stream(xref)
            if not stream:
                continue
            bt_count = len(re.findall(rb'(?<=\s)BT(?=\s)', stream))
            if bt_count > 0:
                if bt_count > max_bt:
                    if text_xref and text_xref not in other_text_xrefs:
                        other_text_xrefs.append(text_xref)
                    text_xref = xref
                    max_bt = bt_count
                else:
                    other_text_xrefs.append(xref)

        # 主 text xref 产生的 block 数 = 总 text blocks - 其他 text xref 的 block 数
        text_block_count = sum(1 for b in blocks if b["type"] == 0)
        if text_xref:
            xref_block_count[text_xref] = max(text_block_count - len(other_text_xrefs), 0)
        # 每个 Do xref 产生 1 个 image block
        for xref in content_xrefs:
            stream = self.doc.xref_stream(xref)
            if not stream:
                continue
            do_count = len(re.findall(rb'(?<=\s)Do(?=\s)', stream))
            if do_count > 0:
                xref_block_count[xref] = do_count
        # 其他 text xref 各产生 1 个 block
        for xref in other_text_xrefs:
            xref_block_count[xref] = 1

        # 找到包含 re 操作符的内容流 xref
        drawing_xrefs = []
        for xref in content_xrefs:
            stream = self.doc.xref_stream(xref)
            if not stream:
                continue
            re_count = len(re.findall(rb'(?<=\s)re(?=\s)', stream))
            for _ in range(re_count):
                drawing_xrefs.append(xref)

        # 累计：色块 xref 之前的所有 block 数量
        xref_to_cumulative = {}
        running = 0
        for xref in content_xrefs:
            xref_to_cumulative[xref] = running
            running += xref_block_count.get(xref, 0)

        result = []
        for idx, d in enumerate(drawings):
            rect = d["rect"]
            if rect.is_empty or rect.width < 0.5 or rect.height < 0.5:
                continue

            fill = d.get("fill")
            stroke = d.get("color")
            if not fill and not stroke:
                continue

            if idx < len(drawing_xrefs):
                draw_xref = drawing_xrefs[idx]
                z_index = xref_to_cumulative.get(draw_xref, 0)
            else:
                z_index = 0

            fill_tuple = tuple(fill) if fill else None
            stroke_tuple = tuple(stroke) if stroke else None

            result.append({
                "rect": [rect.x0, rect.y0, rect.x1, rect.y1],
                "fill": fill_tuple,
                "stroke": stroke_tuple,
                "z_index": z_index,
            })

        return result

    def render_page(self, page_num: int, dpi: int = 150) -> str:
        """渲染页面为 PNG，返回 base64 编码"""
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        zoom = dpi / 72  # 72 是 PDF 的默认 DPI
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)

        # 返回 base64 编码
        img_bytes = pix.tobytes("png")
        return base64.b64encode(img_bytes).decode("utf-8")

    def render_page_to_file(self, page_num: int, dpi: int = 150) -> str:
        """渲染页面为 PNG 文件，返回文件路径"""
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        zoom = dpi / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)

        output_path = RENDER_DIR / f"{self.file_id}_page_{page_num}.png"
        pix.save(str(output_path))
        return str(output_path)

    def get_render_size(self, page_num: int, dpi: int = 150) -> tuple:
        """获取渲染后图片尺寸 (width, height)"""
        width, height = self.get_page_size(page_num)
        zoom = dpi / 72
        return (int(width * zoom), int(height * zoom))

    def _collect_smask_xrefs(self, page) -> set:
        """收集当前页面所有图片引用的 SMask xref（遮罩图片，不应单独显示）"""
        smask_xrefs = set()
        for item in page.get_image_info(xrefs=True):
            xref = item.get("xref", 0)
            if not xref:
                continue
            try:
                obj_str = self.doc.xref_object(xref)
                match = re.search(r'/SMask\s+(\d+)\s+0\s+R', obj_str)
                if match:
                    smask_xrefs.add(int(match.group(1)))
            except Exception:
                continue
        return smask_xrefs

    def _get_smask_xref(self, xref: int) -> Optional[int]:
        """获取图片的 SMask xref，无则返回 None"""
        try:
            obj_str = self.doc.xref_object(xref)
            match = re.search(r'/SMask\s+(\d+)\s+0\s+R', obj_str)
            if match:
                return int(match.group(1))
        except Exception:
            pass
        return None

    def _apply_smask(self, pix, smask_xref: int, page, bbox) -> 'fitz.Pixmap':
        """将 SMask 遮罩合成到图片的 alpha 通道"""
        try:
            mask_pix = fitz.Pixmap(self.doc, smask_xref)
        except Exception:
            return pix

        w, h = pix.width, pix.height

        # 尺寸不匹配时，用页面渲染方式回退（正确处理缩放遮罩）
        if mask_pix.width != w or mask_pix.height != h:
            rect = fitz.Rect(bbox)
            if not rect.is_empty and rect.width >= 1 and rect.height >= 1:
                zoom = 150 / 72
                mat = fitz.Matrix(zoom, zoom)
                return page.get_pixmap(matrix=mat, clip=rect, alpha=True)
            return pix

        # 色彩通道数（不含 alpha）
        color_n = pix.n - pix.alpha
        total = w * h
        samples = pix.samples
        mask_samples = mask_pix.samples
        mn = mask_pix.n

        # 构建 RGBA 字节数组
        rgba = bytearray(total * 4)
        for i in range(total):
            src = i * pix.n
            dst = i * 4

            if color_n == 1:  # 灰度 → RGB
                g = samples[src]
                rgba[dst] = g
                rgba[dst + 1] = g
                rgba[dst + 2] = g
            else:  # RGB 或已有 alpha 的 RGBA
                rgba[dst] = samples[src]
                rgba[dst + 1] = samples[src + 1]
                rgba[dst + 2] = samples[src + 2]

            # alpha 取自遮罩的第一个通道
            rgba[dst + 3] = mask_samples[i * mn]

        return fitz.Pixmap(fitz.csRGB, w, h, bytes(rgba), 1)

    def get_page_images(self, page_num: int) -> List[Dict[str, Any]]:
        """提取页面中的图片块（正确处理色彩空间和 SMask 遮罩透明度）"""
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        images = []
        seen_xrefs = set()

        # 收集所有 SMask xref，跳过它们
        smask_xrefs = self._collect_smask_xrefs(page)

        # 构建图片 bbox → z_index 映射（基于 get_text dict 中的 block 顺序）
        blocks = page.get_text("dict")["blocks"]
        img_bbox_to_zindex = {}
        for idx, block in enumerate(blocks):
            if block["type"] == 1:
                bbox = tuple(round(v, 1) for v in block["bbox"])
                img_bbox_to_zindex[bbox] = idx

        image_list = page.get_image_info(xrefs=True)
        for item in image_list:
            xref = item.get("xref", 0)
            if not xref or xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)

            # 跳过 SMask 遮罩图片
            if xref in smask_xrefs:
                continue

            try:
                bbox = list(item.get("bbox", [0, 0, 0, 0]))
                rect = fitz.Rect(bbox)

                # 跳过无效区域
                if rect.is_empty or rect.width < 1 or rect.height < 1:
                    continue

                pix = fitz.Pixmap(self.doc, xref)

                # CMYK 等色彩空间 → RGB
                if pix.colorspace and pix.colorspace.n > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)

                # 如果图片没有 alpha 且存在 SMask，手动合成遮罩
                if not pix.alpha:
                    smask_xref = self._get_smask_xref(xref)
                    if smask_xref is not None:
                        pix = self._apply_smask(pix, smask_xref, page, bbox)

                # 保存为 PNG（保留 alpha 通道）
                filename = f"{self.file_id}_img_{xref}.png"
                filepath = RENDER_DIR / filename
                pix.save(str(filepath))

                # 用 bbox 匹配 z_index
                bbox_key = tuple(round(v, 1) for v in bbox)
                z_index = img_bbox_to_zindex.get(bbox_key, 0)

                images.append({
                    "xref": xref,
                    "bbox": bbox,
                    "width": pix.width,
                    "height": pix.height,
                    "image_url": f"/renders/{filename}",
                    "z_index": z_index,
                })
            except Exception:
                continue
            finally:
                try:
                    pix = None
                except Exception:
                    pass

        return images

    def _detect_bg_color(self, page, bbox) -> tuple:
        """采样 bbox 四角外侧像素，自动检测背景色

        采样策略：扩大 clip 区域，采样更远的位置，避开文字
        """
        # 扩大采样范围，确保远离文字区域
        margin_x = 20  # 横向扩大
        margin_y = 10  # 纵向扩大

        expanded = fitz.Rect(
            max(0, bbox.x0 - margin_x),
            max(0, bbox.y0 - margin_y),
            min(page.rect.width, bbox.x1 + margin_x),
            min(page.rect.height, bbox.y1 + margin_y),
        )

        pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), clip=expanded, alpha=False)
        w, h = pix.width, pix.height

        # bbox 在 clip 中的像素位置
        bx0 = int(bbox.x0 - expanded.x0)
        by0 = int(bbox.y0 - expanded.y0)
        bx1 = int(bbox.x1 - expanded.x0)
        by1 = int(bbox.y1 - expanded.y0)

        # 采样四角外侧像素，距离 bbox 更远
        # 使用更大的偏移量，确保远离文字
        colors = []
        corners = [
            # 左上外侧 - 左边更远处
            (max(0, bx0 - margin_x), max(0, by0 - margin_y)),
            # 右上外侧 - 右边更远处（如果超出 clip，则用 clip 边缘）
            (min(w - 1, bx1 + min(10, margin_x)), max(0, by0 - margin_y)),
            # 左下外侧
            (max(0, bx0 - margin_x), min(h - 1, by1 + margin_y)),
            # 右下外侧
            (min(w - 1, bx1 + min(10, margin_x)), min(h - 1, by1 + margin_y)),
            # 增加 bbox 正上方和正下方的采样点（远离文字）
            (bx0 + (bx1 - bx0) // 2, max(0, by0 - margin_y)),  # 中间上方
            (bx0 + (bx1 - bx0) // 2, min(h - 1, by1 + margin_y)),  # 中间下方
        ]

        for cx, cy in corners:
            if 0 <= cx < w and 0 <= cy < h:
                idx = (cy * w + cx) * 3
                colors.append((pix.samples[idx], pix.samples[idx + 1], pix.samples[idx + 2]))

        if not colors:
            return (1, 1, 1)  # 默认白色

        # 计算平均值
        r = sum(c[0] for c in colors) / len(colors) / 255
        g = sum(c[1] for c in colors) / len(colors) / 255
        b = sum(c[2] for c in colors) / len(colors) / 255

        return (r, g, b)

    def _extract_image_rgba(self, page, xref: int, bbox) -> bytes:
        """提取图片为 RGBA PNG bytes（保留 SMask 透明度）"""
        pix = fitz.Pixmap(self.doc, xref)
        # CMYK → RGB
        if pix.colorspace and pix.colorspace.n > 3:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        # 如果没有 alpha 且存在 SMask，手动合成
        if not pix.alpha:
            smask_xref = self._get_smask_xref(xref)
            if smask_xref is not None:
                pix = self._apply_smask(pix, smask_xref, page, bbox)
        return pix.tobytes("png")

    def modify_page(self, page_num: int, paragraph_edits: List[Dict], image_edits: List[Dict] = None, dpi: int = 150) -> Dict:
        """修改页面段落和图片（支持自动下推）

        流程：
        1. 提取当前内容 + 预提取所有图片 RGBA 数据
        2. 构建字体缓存
        3. 标记图片移动 redaction
        4. 标记段落 redaction（span 级别，保留背景图形）+ 收集下推内容
        5. apply_redactions()
        6. 插入段落新文字
        7. 插入下推后的文字
        8. 插入下推后的图片（使用预提取的 RGBA 数据）
        9. 插入移动后的图片
        10. 重新渲染
        """
        if image_edits is None:
            image_edits = []

        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]

        # Step 1: 提取当前内容（修改前快照）
        current_spans = self._extract_spans(page)
        current_images_info = [
            item for item in page.get_image_info(xrefs=True)
            if item.get("xref", 0) > 0
        ]

        # Step 1.5: 预提取所有图片的 RGBA PNG 数据（在 redaction 之前，保留透明度）
        image_rgba_cache = {}
        for img_info in current_images_info:
            xref = img_info.get("xref", 0)
            if not xref:
                continue
            try:
                bbox = img_info.get("bbox", [0, 0, 0, 0])
                pix = fitz.Pixmap(self.doc, xref)
                if pix.colorspace and pix.colorspace.n > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                if not pix.alpha:
                    smask_xref = self._get_smask_xref(xref)
                    if smask_xref is not None:
                        pix = self._apply_smask(pix, smask_xref, page, bbox)
                image_rgba_cache[xref] = pix.tobytes("png")
            except Exception:
                pass

        # Step 2: 构建字体缓存
        font_cache = {}
        for font_info in page.get_fonts():
            try:
                xref = font_info[0]
                name = font_info[3]
                if not xref or not name:
                    continue
                font_data = self.doc.extract_font(xref)
                content = font_data.get("content")
                if content:
                    font_cache[name] = content
                    if "+" in name:
                        base = name.split("+", 1)[1]
                        font_cache[base] = content
            except Exception:
                continue

        # Step 3: 标记图片移动 redaction + 收集图片数据
        moved_images = []
        for img_edit in image_edits:
            try:
                xref = img_edit["xref"]
                img_bytes = image_rgba_cache.get(xref)
                if not img_bytes:
                    img_bytes = self._extract_image_rgba(page, xref, img_edit["old_bbox"])
                old_bbox = fitz.Rect(img_edit["old_bbox"])
                bg = self._detect_bg_color(page, old_bbox)
                page.add_redact_annot(old_bbox, fill=bg)
                moved_images.append({
                    "bytes": img_bytes,
                    "new_bbox": img_edit["new_bbox"],
                })
            except Exception:
                continue

        # Step 4: 标记段落 redaction（span 级别）+ 收集下推内容
        shifted_spans = []
        shifted_images = []
        edited_para_bboxes = []  # 记录已编辑的段落 bbox，下推时跳过

        for p_edit in paragraph_edits:
            old_bbox = fitz.Rect(p_edit["bbox"])
            height_delta = p_edit.get("height_delta", 0)
            edited_para_bboxes.append(old_bbox)

            # 用 span 级别 redaction 代替整段 bbox，保留背景图形（装饰矩形等）
            spans_found = []
            for span in current_spans:
                s_bbox = fitz.Rect(span["bbox"])
                # span 在段落范围内
                if (old_bbox.y0 - 2 <= s_bbox.y0 and
                        s_bbox.y1 <= old_bbox.y1 + 2 and
                        s_bbox.x0 >= old_bbox.x0 - 2):
                    spans_found.append(span)

            if spans_found:
                for span in spans_found:
                    s_bbox = fitz.Rect(span["bbox"])
                    # 与图片重叠的 span 不填充背景色，避免白色矩形盖住水印
                    overlaps_image = any(
                        not fitz.Rect(img_info.get("bbox", [0, 0, 0, 0])).is_empty
                        and s_bbox.intersects(fitz.Rect(img_info.get("bbox", [0, 0, 0, 0])))
                        for img_info in current_images_info
                    )
                    if overlaps_image:
                        page.add_redact_annot(s_bbox)
                    else:
                        bg_s = self._detect_bg_color(page, s_bbox)
                        page.add_redact_annot(s_bbox, fill=bg_s)
            else:
                bg = self._detect_bg_color(page, old_bbox)
                page.add_redact_annot(old_bbox, fill=bg)

            if height_delta > 2:
                para_bottom = old_bbox.y1
                # 标记下方 span 的 redaction
                for span in current_spans:
                    s_bbox = fitz.Rect(span["bbox"])
                    if s_bbox.y0 >= para_bottom - 1:
                        # 跳过已在其他编辑段落中的 span
                        in_other_para = any(
                            pb.y0 - 2 <= s_bbox.y0 and s_bbox.y1 <= pb.y1 + 2
                            for pb in edited_para_bboxes
                            if pb != old_bbox
                        )
                        if not in_other_para:
                            overlaps_image = any(
                                not fitz.Rect(img_info.get("bbox", [0, 0, 0, 0])).is_empty
                                and s_bbox.intersects(fitz.Rect(img_info.get("bbox", [0, 0, 0, 0])))
                                for img_info in current_images_info
                            )
                            if overlaps_image:
                                page.add_redact_annot(s_bbox)
                            else:
                                bg_s = self._detect_bg_color(page, s_bbox)
                                page.add_redact_annot(s_bbox, fill=bg_s)
                            shifted_spans.append((span, height_delta))
                # 收集需要位移的图片（不在 redaction 中标记，改用 replace_image 删除）
                for img_info in current_images_info:
                    ib = list(img_info.get("bbox", [0, 0, 0, 0]))
                    i_bbox = fitz.Rect(ib)
                    if i_bbox.y0 >= para_bottom - 1 and not i_bbox.is_empty:
                        shifted_images.append((img_info, height_delta))

        # Step 5: 执行 redaction（images=0 不修改图片，防止水印/图片数据被篡改）
        page.apply_redactions(images=0)

        # Step 5.5: 删除需要位移的图片（用透明 1x1 像素替换原图片对象）
        for img_info, _ in shifted_images:
            xref = img_info.get("xref", 0)
            if not xref:
                continue
            try:
                transparent_pix = fitz.Pixmap(fitz.csRGB, 1, 1, b'\x00\x00\x00\x00', 1)
                page.replace_image(xref, pixmap=transparent_pix)
            except Exception:
                pass

        # Step 6: 插入段落新文字（逐行 insert_text）
        for p_edit in paragraph_edits:
            old_bbox = fitz.Rect(p_edit["bbox"])
            new_text = p_edit["newText"]
            font_size = p_edit.get("fontSize", 12)
            color = tuple(p_edit.get("color", (0, 0, 0)))
            line_height = p_edit.get("lineHeight", font_size * 1.2)
            original_font = p_edit.get("fontName", "")

            # 从原始 span 数据获取精确基线位置
            first_baseline_y = None
            for span in current_spans:
                s_bbox = fitz.Rect(span["bbox"])
                if (old_bbox.y0 - 1 <= s_bbox.y0 <= old_bbox.y0 + font_size + 1 and
                        s_bbox.x0 >= old_bbox.x0 - 2):
                    first_baseline_y = span["origin"][1]
                    break
            if first_baseline_y is None:
                first_baseline_y = old_bbox.y0 + font_size * 0.85

            lines = new_text.split('\n')
            for i, line in enumerate(lines):
                if not line:
                    continue
                y = first_baseline_y + i * line_height

                # 1) PDF 嵌入字体（fontbuffer）
                fb = font_cache.get(original_font)
                if fb:
                    try:
                        page.insert_text(
                            (old_bbox.x0, y), line,
                            fontname=original_font, fontbuffer=fb,
                            fontsize=font_size, color=color,
                        )
                        continue
                    except Exception:
                        pass

                # 2) 系统字体（fontfile）
                sys_font = _find_system_font(original_font)
                if sys_font:
                    try:
                        page.insert_text(
                            (old_bbox.x0, y), line,
                            fontname=original_font, fontfile=sys_font,
                            fontsize=font_size, color=color,
                        )
                        continue
                    except Exception:
                        pass

                # 3) 内置字体兜底
                fn = "china-s" if re.search(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]', line) else "helv"
                page.insert_text(
                    (old_bbox.x0, y), line,
                    fontname=fn, fontsize=font_size, color=color,
                )

        # Step 7: 插入下推后的文字
        for span, delta in shifted_spans:
            new_origin_y = span["origin"][1] + delta
            text = span["text"]

            # 同样三级字体回退
            orig_fn = span.get("fontName", "")
            fb = font_cache.get(orig_fn)
            if fb:
                try:
                    page.insert_text(
                        (span["origin"][0], new_origin_y), text,
                        fontname=orig_fn, fontbuffer=fb,
                        fontsize=span["fontSize"], color=tuple(span["color"]),
                    )
                    continue
                except Exception:
                    pass

            sys_font = _find_system_font(orig_fn)
            if sys_font:
                try:
                    page.insert_text(
                        (span["origin"][0], new_origin_y), text,
                        fontname=orig_fn, fontfile=sys_font,
                        fontsize=span["fontSize"], color=tuple(span["color"]),
                    )
                    continue
                except Exception:
                    pass

            fn = "china-s" if re.search(r'[\u4e00-\u9fff]', text) else "helv"
            page.insert_text(
                (span["origin"][0], new_origin_y), text,
                fontname=fn, fontsize=span["fontSize"], color=tuple(span["color"]),
            )

        # Step 8: 插入下推后的图片（使用预提取的 RGBA PNG）
        for img_info, delta in shifted_images:
            xref = img_info.get("xref", 0)
            if not xref:
                continue
            img_bytes = image_rgba_cache.get(xref)
            if not img_bytes:
                continue
            ib = list(img_info.get("bbox", [0, 0, 0, 0]))
            old_r = fitz.Rect(ib)
            new_r = fitz.Rect(old_r.x0, old_r.y0 + delta, old_r.x1, old_r.y1 + delta)
            page.insert_image(new_r, stream=img_bytes, keep_proportion=True)

        # Step 9: 插入移动后的图片
        for moved in moved_images:
            new_rect = fitz.Rect(moved["new_bbox"])
            page.insert_image(new_rect, stream=moved["bytes"], keep_proportion=True)

        # Step 10: 重新渲染并提取更新数据
        image_path = self.render_page_to_file(page_num, dpi)
        image_url = f"/renders/{Path(image_path).name}"
        paragraphs = self.get_page_text(page_num)
        images = self.get_page_images(page_num)
        drawings = self.get_page_drawings(page_num)

        return {
            "image_url": image_url,
            "paragraphs": paragraphs,
            "images": images,
            "drawings": drawings,
        }

    def export_pdf(self) -> str:
        """导出修改后的 PDF，返回文件路径"""
        output_path = OUTPUT_DIR / f"{self.file_id}_edited.pdf"
        self.doc.save(str(output_path))
        return str(output_path)

    def close(self):
        """关闭文档，释放内存"""
        self.doc.close()