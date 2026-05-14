"""分析 edited (24).pdf 的背景色问题"""
import fitz

original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
edited_path = r"C:\Users\Fan\Downloads\edited (24).pdf"

doc_orig = fitz.open(original_path)
doc_edited = fitz.open(edited_path)

page_orig = doc_orig[0]
page_edited = doc_edited[0]

print("=" * 60)
print("查找'注册地址'相关文字")
print("=" * 60)

# 原始文件中查找
lines_orig = []
blocks = page_orig.get_text("dict")["blocks"]
for block in blocks:
    if block["type"] != 0:
        continue
    for line in block["lines"]:
        text = "".join(s["text"] for s in line["spans"])
        if "注册" in text or "地址" in text:
            bbox = line["bbox"]
            lines_orig.append({
                "text": text,
                "bbox": bbox,
                "y": bbox[1],
            })
            print(f"\nORIGINAL: y={bbox[1]:.1f}, '{text}'")
            print(f"  bbox: {bbox}")

# 编辑文件中查找
lines_edit = []
blocks = page_edited.get_text("dict")["blocks"]
for block in blocks:
    if block["type"] != 0:
        continue
    for line in block["lines"]:
        text = "".join(s["text"] for s in line["spans"])
        if "注册" in text or "地址" in text:
            bbox = line["bbox"]
            lines_edit.append({
                "text": text,
                "bbox": bbox,
                "y": bbox[1],
            })
            print(f"\nEDITED: y={bbox[1]:.1f}, '{text}'")
            print(f"  bbox: {bbox}")

# 检查图片区域
print("\n" + "=" * 60)
print("图片区域")
print("=" * 60)

imgs_orig = page_orig.get_image_info(xrefs=True)
for img in imgs_orig:
    bbox = img.get("bbox", [0, 0, 0, 0])
    print(f"Original: xref={img.get('xref', 0)}, y={bbox[1]:.1f}-{bbox[3]:.1f}")

imgs_edit = page_edited.get_image_info(xrefs=True)
for img in imgs_edit:
    bbox = img.get("bbox", [0, 0, 0, 0])
    print(f"Edited: xref={img.get('xref', 0)}, y={bbox[1]:.1f}-{bbox[3]:.1f}")

# 渲染两个文件中"注册地址"区域的像素，对比背景色
print("\n" + "=" * 60)
print("像素采样对比")
print("=" * 60)

# 找 y=278 区域（原始注册地址）
target_y = 278.2
margin = 5

for page, name in [(page_orig, "Original"), (page_edited, "Edited")]:
    # 找该区域
    clip_rect = fitz.Rect(60, target_y - margin, 400, target_y + 15)
    pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), clip=clip_rect, alpha=False)

    # 采样背景像素（左侧空白区域）
    bg_pixels = []
    for y in range(5, 10):
        for x in range(0, 10):
            idx = (y * pix.width + x) * 3
            bg_pixels.append((pix.samples[idx], pix.samples[idx+1], pix.samples[idx+2]))

    avg_bg = (
        sum(p[0] for p in bg_pixels) // len(bg_pixels),
        sum(p[1] for p in bg_pixels) // len(bg_pixels),
        sum(p[2] for p in bg_pixels) // len(bg_pixels),
    )
    print(f"\n{name} at y≈{target_y}:")
    print(f"  Average background RGB: {avg_bg}")
    print(f"  Is white? {avg_bg == (255, 255, 255)}")

doc_orig.close()
doc_edited.close()
print("\nDone.")