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

    def modify_page(self, page_num: int, edits: List[Dict], dpi: int = 150) -> Dict:
        """修改页面文字

        流程：
        1. add_redact_annot(bbox) 标记要抹除的区域
        2. apply_redactions() 真正执行抹除（修改 content stream）
        3. insert_text() 写入新文字
        4. 保存渲染图片到文件，返回 image_url
        """
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]

        # Step 1: 标记所有抹除区域
        for edit in edits:
            bbox = fitz.Rect(edit["bbox"])
            page.add_redact_annot(bbox, fill=(1, 1, 1))  # 白色填充

        # Step 2: 执行所有抹除（一次性处理）
        page.apply_redactions()

        # Step 3: 写入新文字
        for edit in edits:
            bbox = fitz.Rect(edit["bbox"])
            new_text = edit["newText"]
            font_size = edit.get("fontSize", 12)
            origin = edit.get("origin", [bbox.x0, bbox.y1 - font_size * 0.2])

            page.insert_text(
                (origin[0], origin[1]),
                new_text,
                fontname="helv",  # Helvetica
                fontsize=font_size,
                color=(0, 0, 0),
            )

        # Step 4: 保存渲染图片到文件，返回 URL
        image_path = self.render_page_to_file(page_num, dpi)
        image_url = f"/renders/{Path(image_path).name}"
        text_data = self.get_page_text(page_num)

        return {
            "image_url": image_url,
            "text_data": text_data
        }

    def export_pdf(self) -> str:
        """导出修改后的 PDF，返回文件路径"""
        output_path = OUTPUT_DIR / f"{self.file_id}_edited.pdf"
        self.doc.save(str(output_path))
        return str(output_path)

    def close(self):
        """关闭文档，释放内存"""
        self.doc.close()