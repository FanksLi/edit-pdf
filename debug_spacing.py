"""分析新导出文件的间距和段落问题"""
import fitz

original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
edited_path = r"C:\Users\Fan\Downloads\edited (22).pdf"

doc_orig = fitz.open(original_path)
doc_edited = fitz.open(edited_path)

page_orig = doc_orig[0]
page_edited = doc_edited[0]

print("=" * 60)
print("ORIGINAL PDF - Text Blocks")
print("=" * 60)

# 提取原始文字结构
blocks_orig = page_orig.get_text("dict")["blocks"]
for i, block in enumerate(blocks_orig):
    if block["type"] != 0:
        continue
    lines = block["lines"]
    print(f"\nBlock {i}: {len(lines)} lines")
    for j, line in enumerate(lines[:3]):
        spans = line["spans"]
        text = "".join(s["text"][:30] for s in spans)
        bbox = line["bbox"]
        print(f"  Line {j}: y0={bbox[1]:.1f}, y1={bbox[3]:.1f}, text='{text}'")

print("\n" + "=" * 60)
print("EDITED PDF - Text Blocks")
print("=" * 60)

blocks_edited = page_edited.get_text("dict")["blocks"]
for i, block in enumerate(blocks_edited):
    if block["type"] != 0:
        continue
    lines = block["lines"]
    print(f"\nBlock {i}: {len(lines)} lines")
    for j, line in enumerate(lines[:3]):
        spans = line["spans"]
        text = "".join(s["text"][:30] for s in spans)
        bbox = line["bbox"]
        print(f"  Line {j}: y0={bbox[1]:.1f}, y1={bbox[3]:.1f}, text='{text}'")

# 对比段落 bbox
print("\n" + "=" * 60)
print("Paragraph BBOX Comparison")
print("=" * 60)

# 找主要段落区域（跳过标题）
for block_orig, block_edit in zip(blocks_orig, blocks_edited):
    if block_orig["type"] != 0 or block_edit["type"] != 0:
        continue

    orig_bbox = block_orig["bbox"]
    edit_bbox = block_edit["bbox"]

    if orig_bbox[1] > 200:  # 跳过顶部标题
        print(f"\nOriginal bbox: y0={orig_bbox[1]:.1f}, y1={orig_bbox[3]:.1f}")
        print(f"Edited bbox:   y0={edit_bbox[1]:.1f}, y1={edit_bbox[3]:.1f}")
        print(f"Height delta:  {edit_bbox[3] - edit_bbox[1] - (orig_bbox[3] - orig_bbox[1]):.1f}")

        # 对比行数
        orig_lines = len(block_orig["lines"])
        edit_lines = len(block_edit["lines"])
        print(f"Line count: orig={orig_lines}, edit={edit_lines}")

        # 详细对比每行
        if len(block_orig["lines"]) > 3 and len(block_edit["lines"]) > 3:
            print("\n  Line-by-line comparison:")
            for k in range(min(5, len(block_orig["lines"]), len(block_edit["lines"]))):
                orig_line = block_orig["lines"][k]
                edit_line = block_edit["lines"][k]
                orig_y = orig_line["bbox"][1]
                edit_y = edit_line["bbox"][1]
                orig_text = "".join(s["text"][:20] for s in orig_line["spans"])
                edit_text = "".join(s["text"][:20] for s in edit_line["spans"])
                print(f"    [{k}] orig_y={orig_y:.1f}, edit_y={edit_y:.1f}, delta={edit_y - orig_y:.1f}")
                print(f"        orig='{orig_text}' | edit='{edit_text}'")

# 检查图片
print("\n" + "=" * 60)
print("Image Comparison")
print("=" * 60)

imgs_orig = page_orig.get_image_info(xrefs=True)
imgs_edit = page_edited.get_image_info(xrefs=True)

print(f"Original images: {len(imgs_orig)}")
for img in imgs_orig:
    bbox = img.get("bbox", [0, 0, 0, 0])
    print(f"  xref={img.get('xref', 0)}, y={bbox[1]:.1f}-{bbox[3]:.1f}")

print(f"\nEdited images: {len(imgs_edit)}")
for img in imgs_edit:
    bbox = img.get("bbox", [0, 0, 0, 0])
    print(f"  xref={img.get('xref', 0)}, y={bbox[1]:.1f}-{bbox[3]:.1f}")

doc_orig.close()
doc_edited.close()
print("\nAnalysis complete.")