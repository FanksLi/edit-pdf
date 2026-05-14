"""模拟 _detect_bg_color 的检测过程"""
import fitz

original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
edited_path = r"C:\Users\Fan\Downloads\edited (24).pdf"

doc_orig = fitz.open(original_path)
doc_edit = fitz.open(edited_path)

page_orig = doc_orig[0]
page_edit = doc_edit[0]

print("=" * 60)
print("模拟 _detect_bg_color 检测过程")
print("=" * 60)

# "注册地址"行 bbox
bbox = fitz.Rect(62.69, 278.17, 314.69, 288.67)

margin = 3
expanded = fitz.Rect(
    max(0, bbox.x0 - margin),
    max(0, bbox.y0 - margin),
    min(page_orig.rect.width, bbox.x1 + margin),
    min(page_orig.rect.height, bbox.y1 + margin),
)

print(f"\nOriginal bbox: {bbox}")
print(f"Expanded clip: {expanded}")

# 原始页面渲染
pix_orig = page_orig.get_pixmap(matrix=fitz.Matrix(1, 1), clip=expanded, alpha=False)
w, h = pix_orig.width, pix_orig.height
print(f"Pixmap size: {w}x{h}")

# bbox 在 clip 中的像素位置
bx0 = int(bbox.x0 - expanded.x0)
by0 = int(bbox.y0 - expanded.y0)
bx1 = int(bbox.x1 - expanded.x0)
by1 = int(bbox.y1 - expanded.y0)

print(f"bbox in clip: x={bx0}-{bx1}, y={by0}-{by1}")

# 采样四角外侧像素
corners = [
    ("左上外侧", max(0, bx0 - 2), max(0, by0 - 2)),
    ("右上外侧", min(w - 1, bx1 + 1), max(0, by0 - 2)),
    ("左下外侧", max(0, bx0 - 2), min(h - 1, by1 + 1)),
    ("右下外侧", min(w - 1, bx1 + 1), min(h - 1, by1 + 1)),
]

print("\n原始 PDF 采样:")
for name, cx, cy in corners:
    if 0 <= cx < w and 0 <= cy < h:
        idx = (cy * w + cx) * 3
        r, g, b = pix_orig.samples[idx], pix_orig.samples[idx+1], pix_orig.samples[idx+2]
        print(f"  {name} ({cx}, {cy}): RGB=({r}, {g}, {b})")

# 编辑页面渲染
pix_edit = page_edit.get_pixmap(matrix=fitz.Matrix(1, 1), clip=expanded, alpha=False)

print("\n编辑 PDF 采样:")
for name, cx, cy in corners:
    if 0 <= cx < w and 0 <= cy < h:
        idx = (cy * w + cx) * 3
        r, g, b = pix_edit.samples[idx], pix_edit.samples[idx+1], pix_edit.samples[idx+2]
        print(f"  {name} ({cx}, {cy}): RGB=({r}, {g}, {b})")

# 检查采样点附近是否在水印图片区域
print("\n" + "=" * 60)
print("检查采样点与图片区域的关系")
print("=" * 60)

imgs = page_orig.get_image_info(xrefs=True)
for img in imgs:
    img_bbox = fitz.Rect(img.get("bbox", [0, 0, 0, 0]))
    print(f"Image xref={img.get('xref', 0)}: bbox={img_bbox}")

    # 检查 corners 是否在图片内
    for name, cx, cy in corners:
        # 转换回 PDF 坐标
        pdf_x = expanded.x0 + cx
        pdf_y = expanded.y0 + cy
        pdf_point = fitz.Point(pdf_x, pdf_y)

        if img_bbox.contains(pdf_point):
            print(f"  -> {name} 在图片内!")

# 检查是否有文字在采样点附近
print("\n" + "=" * 60)
print("检查采样点附近的文字")
print("=" * 60)

blocks = page_orig.get_text("dict")["blocks"]
for block in blocks:
    if block["type"] != 0:
        continue
    for line in block["lines"]:
        for span in line["spans"]:
            span_bbox = fitz.Rect(span["bbox"])
            # 检查是否与 corners 区域重叠
            for name, cx, cy in corners:
                pdf_x = expanded.x0 + cx
                pdf_y = expanded.y0 + cy
                # 创建一个小矩形检查重叠
                check_rect = fitz.Rect(pdf_x - 2, pdf_y - 2, pdf_x + 2, pdf_y + 2)
                if span_bbox.intersects(check_rect):
                    print(f"  {name}: 与文字 '{span['text'][:20]}' 重叠")

doc_orig.close()
doc_edit.close()
print("\nDone.")