"""分析 PDF content stream 和 overlap 情况"""
import fitz
import sys

# 用户文件路径
original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
edited_path = r"C:\Users\Fan\Downloads\edited (20).pdf"

doc_orig = fitz.open(original_path)
doc_edited = fitz.open(edited_path)

page_orig = doc_orig[0]
page_edited = doc_edited[0]

print("=" * 60)
print("ORIGINAL PDF - Content Stream Analysis")
print("=" * 60)

# 获取图片信息
images_orig = page_orig.get_image_info(xrefs=True)
print(f"\nImages in original PDF: {len(images_orig)}")
for img in images_orig:
    xref = img.get('xref', 0)
    bbox = img.get('bbox', [0, 0, 0, 0])
    print(f"  xref={xref}, bbox={bbox}")

# 获取文字 spans
text_dict = page_orig.get_text("dict")
spans = []
for block in text_dict["blocks"]:
    if block["type"] == 0:
        for line in block["lines"]:
            for span in line["spans"]:
                spans.append({
                    "text": span["text"],
                    "bbox": span["bbox"],
                    "size": span["size"],
                })

print(f"\nText spans: {len(spans)}")
# 找与图片重叠的 span
for img in images_orig:
    img_bbox = fitz.Rect(img.get('bbox', [0, 0, 0, 0]))
    if img_bbox.is_empty:
        continue
    overlapping_spans = []
    for span in spans:
        s_bbox = fitz.Rect(span["bbox"])
        if s_bbox.intersects(img_bbox):
            overlapping_spans.append(span["text"][:50])
    if overlapping_spans:
        print(f"\nImage xref={img.get('xref', 0)} overlaps with spans:")
        for t in overlapping_spans[:5]:
            print(f"  - '{t}'")

# Content stream 源码分析
print("\n" + "=" * 60)
print("Content Stream Operations (first 50)")
print("=" * 60)
cs_orig = page_orig.get_contents()
for xref in cs_orig[:3]:
    stream = doc_orig.xref_stream(xref)
    if stream:
        decoded = stream.decode('latin-1', errors='ignore')
        lines = decoded.split('\n')[:50]
        for line in lines:
            print(line[:100])

print("\n" + "=" * 60)
print("EDITED PDF - Content Stream Analysis")
print("=" * 60)

# 获取图片信息
images_edited = page_edited.get_image_info(xrefs=True)
print(f"\nImages in edited PDF: {len(images_edited)}")
for img in images_edited:
    xref = img.get('xref', 0)
    bbox = img.get('bbox', [0, 0, 0, 0])
    print(f"  xref={xref}, bbox={bbox}")

# Content stream 源码分析
cs_edited = page_edited.get_contents()
print(f"\nContent stream xrefs: {cs_edited}")
for xref in cs_edited[:3]:
    stream = doc_edited.xref_stream(xref)
    if stream:
        decoded = stream.decode('latin-1', errors='ignore')
        # 查找关键操作
        lines = decoded.split('\n')
        print(f"\nStream xref={xref} (looking for fill/image ops):")
        for line in lines:
            if any(kw in line for kw in ['re', 'f', 'Do', 'image', 'gs', 'CS']):
                print(f"  {line[:120]}")

# 比较图片 xref 数据
print("\n" + "=" * 60)
print("Image Data Comparison")
print("=" * 60)
for img_orig in images_orig:
    xref = img_orig.get('xref', 0)
    if not xref:
        continue
    stream_orig = doc_orig.xref_stream(xref)
    stream_edited = doc_edited.xref_stream(xref) if xref in [i.get('xref', 0) for i in images_edited] else None

    if stream_edited:
        if stream_orig == stream_edited:
            print(f"  xref={xref}: IDENTICAL stream data")
        else:
            print(f"  xref={xref}: DIFFERENT stream data (len: {len(stream_orig)} vs {len(stream_edited)})")
    else:
        print(f"  xref={xref}: NOT in edited PDF")

doc_orig.close()
doc_edited.close()
print("\nAnalysis complete.")