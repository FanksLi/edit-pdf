"""PyMuPDF 核心封装 - PDF 处理服务"""

import fitz
import uuid
import base64
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

    def get_page_text(self, page_num: int) -> List[Dict[str, Any]]:
        """提取页面所有文字块坐标（精确到 span 级别）"""
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        blocks = page.get_text("dict")["blocks"]
        spans = []

        for block in blocks:
            if block["type"] != 0:  # 只处理文字块 (type=0)
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    # span["bbox"] = (x0, y0, x1, y1) PDF坐标系（左下原点）
                    # span["color"] 是整数，需要转换为 RGB
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

    def get_page_images(self, page_num: int) -> List[Dict[str, Any]]:
        """提取页面中的图片块"""
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        images = []

        # 使用 get_image_info 获取图片信息（包含 xref）
        image_list = page.get_image_info(xrefs=True)
        for item in image_list:
            xref = item.get("xref", 0)
            if not xref:
                continue

            try:
                img_info = self.doc.extract_image(xref)
                if not img_info or not img_info.get("image"):
                    continue

                img_bytes = img_info["image"]
                ext = img_info.get("ext", "png")
                width = img_info.get("width", 0)
                height = img_info.get("height", 0)
                bbox = list(item.get("bbox", [0, 0, 0, 0]))

                # 保存到 RENDER_DIR
                filename = f"{self.file_id}_img_{xref}.{ext}"
                filepath = RENDER_DIR / filename
                with open(filepath, "wb") as f:
                    f.write(img_bytes)

                images.append({
                    "xref": xref,
                    "bbox": bbox,
                    "width": width,
                    "height": height,
                    "image_url": f"/renders/{filename}",
                })
            except Exception:
                continue

        return images

    def modify_page(self, page_num: int, text_edits: List[Dict], image_edits: List[Dict] = None, dpi: int = 150) -> Dict:
        """修改页面文字和图片

        流程：
        1. 提取需要移动的图片 bytes（在 redaction 之前）
        2. 标记所有抹除区域（图片 old_bbox + 文字 bbox）
        3. apply_redactions() 一次性执行
        4. 插入移动后的图片
        5. 插入新文字
        6. 重新渲染
        """
        if image_edits is None:
            image_edits = []

        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]

        # Step 1: 提取需要移动的图片 bytes（在 redaction 之前）
        moved_images = []
        for img_edit in image_edits:
            try:
                xref = img_edit["xref"]
                img_info = self.doc.extract_image(xref)
                img_bytes = img_info["image"]
                moved_images.append({
                    "bytes": img_bytes,
                    "new_bbox": img_edit["new_bbox"],
                })
                # 标记旧位置 redaction
                old_bbox = fitz.Rect(img_edit["old_bbox"])
                page.add_redact_annot(old_bbox, fill=(1, 1, 1))
            except Exception:
                continue

        # Step 2: 标记文字 redaction
        for edit in text_edits:
            bbox = fitz.Rect(edit["bbox"])
            page.add_redact_annot(bbox, fill=(1, 1, 1))

        # Step 3: 统一执行所有 redaction
        page.apply_redactions()

        # Step 4: 插入移动后的图片
        for moved in moved_images:
            new_rect = fitz.Rect(moved["new_bbox"])
            page.insert_image(new_rect, stream=moved["bytes"], keep_proportion=True)

        # Step 5: 插入新文字
        for edit in text_edits:
            bbox = fitz.Rect(edit["bbox"])
            new_text = edit["newText"]
            font_size = edit.get("fontSize", 12)
            origin = edit.get("origin", [bbox.x0, bbox.y1 - font_size * 0.2])

            page.insert_text(
                (origin[0], origin[1]),
                new_text,
                fontname="helv",
                fontsize=font_size,
                color=(0, 0, 0),
            )

        # Step 6: 重新渲染并提取更新数据
        image_path = self.render_page_to_file(page_num, dpi)
        image_url = f"/renders/{Path(image_path).name}"
        text_data = self.get_page_text(page_num)
        images = self.get_page_images(page_num)

        return {
            "image_url": image_url,
            "text_data": text_data,
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