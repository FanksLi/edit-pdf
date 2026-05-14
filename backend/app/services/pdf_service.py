"""PyMuPDF 核心封装 - PDF 处理服务"""

import fitz
import uuid
import base64
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

from app.config import RENDER_DIR, OUTPUT_DIR


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

    def _gap_based_paragraphs(self, blocks: list) -> List[Dict[str, Any]]:
        """用行间距比值检测段落边界

        1. 打平所有 block/line → 行列表，按 y 排序
        2. 算相邻行间距 gap[i]
        3. 中位间距 = 正常行距
        4. gap > 中位间距 × 1.5 → 段落断点
        """
        # Step 1: 打平所有行为统一的行列表
        flat_lines = []
        for block in blocks:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                spans = sorted(line["spans"], key=lambda s: s["bbox"][0])
                if not spans:
                    continue
                # 行的代表信息取自第一个 span
                first = spans[0]
                color_int = first.get("color", 0)
                flat_lines.append({
                    "text": "".join(s["text"] for s in spans),
                    "y0": first["bbox"][1],
                    "fontSize": first["size"],
                    "fontName": first["font"],
                    "color": [
                        ((color_int >> 16) & 0xFF) / 255,
                        ((color_int >> 8) & 0xFF) / 255,
                        (color_int & 0xFF) / 255,
                    ],
                    "spans_bboxes": [s["bbox"] for s in spans],
                })

        if not flat_lines:
            return []

        # 按 y0 排序（PDF 坐标 y 向下递增）
        flat_lines.sort(key=lambda l: (l["y0"], l["spans_bboxes"][0][0]))

        # Step 2: 计算相邻行间距
        gaps = []
        for i in range(1, len(flat_lines)):
            gap = flat_lines[i]["y0"] - flat_lines[i - 1]["y0"]
            gaps.append(gap)

        # Step 3: 中位间距 = 正常行距
        if gaps:
            sorted_gaps = sorted(gaps)
            median_gap = sorted_gaps[len(sorted_gaps) // 2]
        else:
            median_gap = flat_lines[0]["fontSize"] * 1.2

        # 阈值：间距超过正常行距 1.5 倍 → 段落断点
        threshold = median_gap * 1.5
        # 保底：至少超过字号 1.5 倍才算断点（防全是单行段落）
        min_break = flat_lines[0]["fontSize"] * 1.5
        threshold = max(threshold, min_break)

        # Step 4: 按断点分组
        para_groups = []
        current = [flat_lines[0]]

        for i in range(1, len(flat_lines)):
            gap = flat_lines[i]["y0"] - flat_lines[i - 1]["y0"]
            # 字号突变也算断点
            font_changed = abs(flat_lines[i]["fontSize"] - flat_lines[i - 1]["fontSize"]) > 2

            if gap > threshold or font_changed:
                para_groups.append(current)
                current = [flat_lines[i]]
            else:
                current.append(flat_lines[i])

        para_groups.append(current)

        # Step 5: 构建段落数据
        result = []
        for group in para_groups:
            text = "\n".join(l["text"] for l in group)

            all_bb = [bb for l in group for bb in l["spans_bboxes"]]
            x0 = min(b[0] for b in all_bb)
            y0 = min(b[1] for b in all_bb)
            x1 = max(b[2] for b in all_bb)
            y1 = max(b[3] for b in all_bb)

            rep = group[0]
            y_tops = [l["y0"] for l in group]
            if len(y_tops) > 1:
                lh = sum(y_tops[i] - y_tops[i - 1] for i in range(1, len(y_tops))) / (len(y_tops) - 1)
            else:
                lh = rep["fontSize"] * 1.2

            result.append({
                "text": text,
                "bbox": [x0, y0, x1, y1],
                "fontSize": rep["fontSize"],
                "fontName": rep["fontName"],
                "color": rep["color"],
                "lineHeight": lh,
            })

        return result

    def get_page_text(self, page_num: int) -> List[Dict[str, Any]]:
        """提取页面文字，按行间距比值自动分段"""
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        blocks = page.get_text("dict")["blocks"]
        return self._gap_based_paragraphs(blocks)

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

                images.append({
                    "xref": xref,
                    "bbox": bbox,
                    "width": pix.width,
                    "height": pix.height,
                    "image_url": f"/renders/{filename}",
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
        """采样 bbox 四角外侧像素，自动检测背景色"""
        margin = 3
        expanded = fitz.Rect(
            max(0, bbox.x0 - margin),
            max(0, bbox.y0 - margin),
            min(page.rect.width, bbox.x1 + margin),
            min(page.rect.height, bbox.y1 + margin),
        )
        pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), clip=expanded, alpha=False)
        w, h = pix.width, pix.height

        # bbox 在 clip 中的像素位置
        bx0 = int(bbox.x0 - expanded.x0)
        by0 = int(bbox.y0 - expanded.y0)
        bx1 = int(bbox.x1 - expanded.x0)
        by1 = int(bbox.y1 - expanded.y0)

        # 采样四角外侧像素（尽量远离文字区域）
        colors = []
        corners = [
            (max(0, bx0 - 2), max(0, by0 - 2)),      # 左上外侧
            (min(w - 1, bx1 + 1), max(0, by0 - 2)),   # 右上外侧
            (max(0, bx0 - 2), min(h - 1, by1 + 1)),   # 左下外侧
            (min(w - 1, bx1 + 1), min(h - 1, by1 + 1)),  # 右下外侧
        ]
        for cx, cy in corners:
            if 0 <= cx < w and 0 <= cy < h:
                idx = (cy * w + cx) * 3
                colors.append((pix.samples[idx], pix.samples[idx + 1], pix.samples[idx + 2]))

        if not colors:
            return (1, 1, 1)

        r = sum(c[0] for c in colors) / len(colors) / 255
        g = sum(c[1] for c in colors) / len(colors) / 255
        b = sum(c[2] for c in colors) / len(colors) / 255
        return (r, g, b)

    def modify_page(self, page_num: int, paragraph_edits: List[Dict], image_edits: List[Dict] = None, dpi: int = 150) -> Dict:
        """修改页面段落和图片（支持自动下推）

        流程：
        1. 提取当前页面所有 span 和图片（在修改之前）
        2. 提取需要移动的图片 bytes + 标记 redaction
        3. 标记段落 redaction + 下方需要下推的内容 redaction
        4. apply_redactions()
        5. 构建字体缓存
        6. 插入段落新文字（insert_textbox）
        7. 插入下推后的文字和图片
        8. 插入移动后的图片
        9. 重新渲染
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

        # Step 2: 提取图片 bytes + 标记旧位置 redaction
        moved_images = []
        for img_edit in image_edits:
            try:
                xref = img_edit["xref"]
                img_info = self.doc.extract_image(xref)
                img_bytes = img_info["image"]
                old_bbox = fitz.Rect(img_edit["old_bbox"])
                bg = self._detect_bg_color(page, old_bbox)
                page.add_redact_annot(old_bbox, fill=bg)
                moved_images.append({
                    "bytes": img_bytes,
                    "new_bbox": img_edit["new_bbox"],
                })
            except Exception:
                continue

        # Step 3: 标记段落 redaction + 收集需要下推的内容
        shifted_spans = []   # (span_data, height_delta)
        shifted_images = []  # (img_info, height_delta)

        for p_edit in paragraph_edits:
            old_bbox = fitz.Rect(p_edit["bbox"])
            height_delta = p_edit.get("height_delta", 0)
            bg = self._detect_bg_color(page, old_bbox)
            page.add_redact_annot(old_bbox, fill=bg)

            if height_delta > 0:
                para_bottom = old_bbox.y1
                # 标记下方 span 的 redaction
                for span in current_spans:
                    s_bbox = fitz.Rect(span["bbox"])
                    if s_bbox.y0 >= para_bottom - 1:
                        bg_s = self._detect_bg_color(page, s_bbox)
                        page.add_redact_annot(s_bbox, fill=bg_s)
                        shifted_spans.append((span, height_delta))
                # 标记下方图片的 redaction
                for img_info in current_images_info:
                    ib = list(img_info.get("bbox", [0, 0, 0, 0]))
                    i_bbox = fitz.Rect(ib)
                    if i_bbox.y0 >= para_bottom - 1 and not i_bbox.is_empty:
                        bg_i = self._detect_bg_color(page, i_bbox)
                        page.add_redact_annot(i_bbox, fill=bg_i)
                        shifted_images.append((img_info, height_delta))

        # Step 4: 执行所有 redaction
        page.apply_redactions()

        # Step 5: 构建字体缓存
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

        # Step 6: 插入段落新文字（用 insert_textbox 自动换行）
        for p_edit in paragraph_edits:
            old_bbox = fitz.Rect(p_edit["bbox"])
            new_text = p_edit["newText"]
            font_size = p_edit.get("fontSize", 12)
            height_delta = p_edit.get("height_delta", 0)
            color = tuple(p_edit.get("color", (0, 0, 0)))

            # 新 bbox：宽度不变，高度可能增加
            new_rect = fitz.Rect(
                old_bbox.x0, old_bbox.y0,
                old_bbox.x1, old_bbox.y1 + height_delta,
            )

            original_font = p_edit.get("fontName", "")
            fontbuffer = font_cache.get(original_font)
            if fontbuffer:
                try:
                    page.insert_textbox(
                        new_rect, new_text,
                        fontname=original_font,
                        fontbuffer=fontbuffer,
                        fontsize=font_size,
                        color=color,
                        align=0,
                    )
                    continue
                except Exception:
                    pass

            fontname = "china-s" if re.search(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]', new_text) else "helv"
            page.insert_textbox(
                new_rect, new_text,
                fontname=fontname,
                fontsize=font_size,
                color=color,
                align=0,
            )

        # Step 7: 插入下推后的文字
        for span, delta in shifted_spans:
            old_s = fitz.Rect(span["bbox"])
            new_origin_y = span["origin"][1] + delta
            new_y0 = old_s.y0 + delta
            text = span["text"]

            fb = font_cache.get(span["fontName"])
            if fb:
                try:
                    page.insert_text(
                        (span["origin"][0], new_origin_y),
                        text,
                        fontname=span["fontName"],
                        fontbuffer=fb,
                        fontsize=span["fontSize"],
                        color=tuple(span["color"]),
                    )
                    continue
                except Exception:
                    pass

            fn = "china-s" if re.search(r'[\u4e00-\u9fff]', text) else "helv"
            page.insert_text(
                (span["origin"][0], new_origin_y),
                text,
                fontname=fn,
                fontsize=span["fontSize"],
                color=tuple(span["color"]),
            )

        # Step 8: 插入下推后的图片
        for img_info, delta in shifted_images:
            xref = img_info.get("xref", 0)
            if not xref:
                continue
            try:
                img_data = self.doc.extract_image(xref)
                ib = list(img_info.get("bbox", [0, 0, 0, 0]))
                old_r = fitz.Rect(ib)
                new_r = fitz.Rect(old_r.x0, old_r.y0 + delta, old_r.x1, old_r.y1 + delta)
                page.insert_image(new_r, stream=img_data["image"], keep_proportion=True)
            except Exception:
                pass

        # Step 9: 插入移动后的图片
        for moved in moved_images:
            new_rect = fitz.Rect(moved["new_bbox"])
            page.insert_image(new_rect, stream=moved["bytes"], keep_proportion=True)

        # Step 10: 重新渲染并提取更新数据
        image_path = self.render_page_to_file(page_num, dpi)
        image_url = f"/renders/{Path(image_path).name}"
        paragraphs = self.get_page_text(page_num)
        images = self.get_page_images(page_num)

        return {
            "image_url": image_url,
            "paragraphs": paragraphs,
            "images": images,
        }

    def export_pdf(self) -> str:
        """导出修改后的 PDF，返回文件路径"""
        output_path = OUTPUT_DIR / f"{self.file_id}_edited.pdf"
        self.doc.save(str(output_path))
        return str(output_path)

    def close(self):
        """关闭文档，释放内存"""
        self.doc.close()