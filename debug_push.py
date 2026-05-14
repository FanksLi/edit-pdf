"""详细分析下推逻辑问题"""
import fitz

original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
edited_path = r"C:\Users\Fan\Downloads\edited (22).pdf"

doc_orig = fitz.open(original_path)
doc_edited = fitz.open(edited_path)

page_orig = doc_orig[0]
page_edited = doc_edited[0]

print("=" * 60)
print("按文本内容匹配段落，对比位置")
print("=" * 60)

# 提取原始段落（用 gap_based 方法）
def get_paragraphs(page):
    blocks = page.get_text("dict")["blocks"]
    flat_lines = []
    for block in blocks:
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
                "y1": first["bbox"][3],
                "fontSize": first["size"],
                "bbox": [min(s["bbox"][0] for s in spans), first["bbox"][1],
                         max(s["bbox"][2] for s in spans), max(s["bbox"][3] for s in spans)],
            })

    flat_lines.sort(key=lambda l: (l["y0"], l["bbox"][0]))

    # 计算间距
    gaps = []
    for i in range(1, len(flat_lines)):
        gaps.append(flat_lines[i]["y0"] - flat_lines[i - 1]["y0"])

    median_gap = sorted(gaps)[len(gaps) // 2] if gaps else flat_lines[0]["fontSize"] * 1.2
    threshold = max(median_gap * 1.5, flat_lines[0]["fontSize"] * 1.5)

    # 分组
    para_groups = []
    current = [flat_lines[0]]
    for i in range(1, len(flat_lines)):
        gap = flat_lines[i]["y0"] - flat_lines[i - 1]["y0"]
        font_changed = abs(flat_lines[i]["fontSize"] - flat_lines[i - 1]["fontSize"]) > 2
        if gap > threshold or font_changed:
            para_groups.append(current)
            current = [flat_lines[i]]
        else:
            current.append(flat_lines[i])
    para_groups.append(current)

    # 构建段落
    paragraphs = []
    for group in para_groups:
        text = "\n".join(l["text"] for l in group)
        x0 = min(l["bbox"][0] for l in group)
        y0 = min(l["y0"] for l in group)
        x1 = max(l["bbox"][2] for l in group)
        y1 = max(l["y1"] for l in group)
        paragraphs.append({
            "text": text[:40],
            "bbox": [x0, y0, x1, y1],
            "fontSize": group[0]["fontSize"],
        })
    return paragraphs

paras_orig = get_paragraphs(page_orig)
paras_edit = get_paragraphs(page_edited)

print(f"\nOriginal paragraphs: {len(paras_orig)}")
print(f"Edited paragraphs: {len(paras_edit)}")

# 按文本内容匹配
print("\n" + "=" * 60)
print("Paragraph Matching by Content")
print("=" * 60)

matched = []
for i, po in enumerate(paras_orig):
    # 找相似文本
    best_match = None
    best_diff = 999
    for j, pe in enumerate(paras_edit):
        # 简单匹配：开头相同
        if po["text"][:10] == pe["text"][:10]:
            best_match = (j, pe)
            break
        # 或者文本长度相近
        diff = abs(len(po["text"]) - len(pe["text"]))
        if diff < best_diff:
            best_diff = diff
            best_match = (j, pe)

    if best_match:
        j, pe = best_match
        orig_y = po["bbox"][1]
        edit_y = pe["bbox"][1]
        delta = edit_y - orig_y
        print(f"\n[{i}] vs [{j}]:")
        print(f"  Orig: y={orig_y:.1f}, text='{po['text']}'")
        print(f"  Edit: y={edit_y:.1f}, text='{pe['text']}'")
        print(f"  Delta: {delta:.1f} pts")
        matched.append((i, j, delta))

# 检查水印图片区域
print("\n" + "=" * 60)
print("Watermark Image Region")
print("=" * 60)
imgs = page_edited.get_image_info(xrefs=True)
for img in imgs:
    bbox = img.get("bbox", [0, 0, 0, 0])
    if bbox[3] - bbox[1] > 100:  # 大图片
        print(f"\nImage xref={img.get('xref', 0)}: y={bbox[1]:.1f}-{bbox[3]:.1f}")
        print(f"  Height: {bbox[3] - bbox[1]:.1f} pts")

        # 检查哪些段落进入这个区域
        for i, pe in enumerate(paras_edit):
            para_y0, para_y1 = pe["bbox"][1], pe["bbox"][3]
            if para_y0 >= bbox[1] and para_y1 <= bbox[3]:
                print(f"  -> Paragraph {i} (y={para_y0:.1f}-{para_y1:.1f}) inside watermark region")

doc_orig.close()
doc_edited.close()
print("\nAnalysis complete.")