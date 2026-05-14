"""详细行级分析"""
import fitz

original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
edited_path = r"C:\Users\Fan\Downloads\edited (22).pdf"

doc_orig = fitz.open(original_path)
doc_edited = fitz.open(edited_path)

page_orig = doc_orig[0]
page_edited = doc_edited[0]

print("=" * 60)
print("Original PDF - All Lines (y sorted)")
print("=" * 60)

# 提取所有行
def get_all_lines(page):
    lines = []
    blocks = page.get_text("dict")["blocks"]
    for block in blocks:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            spans = line["spans"]
            text = "".join(s["text"] for s in spans)
            bbox = line["bbox"]
            fontSize = spans[0]["size"] if spans else 10
            lines.append({
                "text": text[:50],
                "y0": bbox[1],
                "y1": bbox[3],
                "fontSize": fontSize,
            })
    return sorted(lines, key=lambda l: l["y0"])

lines_orig = get_all_lines(page_orig)
lines_edit = get_all_lines(page_edited)

# 打印原始行（关注编辑区域）
print("\nOriginal lines (y=200-500):")
for i, line in enumerate(lines_orig):
    if 200 <= line["y0"] <= 500:
        print(f"  [{i}] y={line['y0']:.1f}-{line['y1']:.1f}, size={line['fontSize']:.1f}, '{line['text']}'")

print("\n" + "=" * 60)
print("Edited PDF - All Lines (y=200-500)")
print("=" * 60)

print("\nEdited lines (y=200-500):")
for i, line in enumerate(lines_edit):
    if 200 <= line["y0"] <= 500:
        print(f"  [{i}] y={line['y0']:.1f}-{line['y1']:.1f}, size={line['fontSize']:.1f}, '{line['text']}'")

# 对比整体
print("\n" + "=" * 60)
print("Full Line-by-Line Comparison")
print("=" * 60)

# 按文本匹配
orig_texts = {l["text"][:20]: l for l in lines_orig}
edit_texts = {l["text"][:20]: l for l in lines_edit}

matched_count = 0
unmatched_orig = []
unmatched_edit = []

for text_key, orig_line in orig_texts.items():
    if text_key in edit_texts:
        edit_line = edit_texts[text_key]
        delta = edit_line["y0"] - orig_line["y0"]
        if abs(delta) > 2:
            print(f"Moved: '{orig_line['text'][:30]}' y={orig_line['y0']:.1f} -> {edit_line['y0']:.1f} (delta={delta:.1f})")
        matched_count += 1
    else:
        unmatched_orig.append(orig_line)

for text_key, edit_line in edit_texts.items():
    if text_key not in orig_texts:
        unmatched_edit.append(edit_line)

print(f"\nMatched: {matched_count}")
print(f"\nUnmatched in original (may be deleted):")
for l in unmatched_orig[:5]:
    print(f"  y={l['y0']:.1f}, '{l['text']}'")

print(f"\nUnmatched in edited (new lines):")
for l in unmatched_edit[:5]:
    print(f"  y={l['y0']:.1f}, '{l['text']}'")

# 计算行间距变化
print("\n" + "=" * 60)
print("Line Spacing Analysis")
print("=" * 60)

# 原始行间距
gaps_orig = []
for i in range(1, len(lines_orig)):
    gap = lines_orig[i]["y0"] - lines_orig[i-1]["y0"]
    gaps_orig.append(gap)

# 编辑行间距
gaps_edit = []
for i in range(1, len(lines_edit)):
    gap = lines_edit[i]["y0"] - lines_edit[i-1]["y0"]
    gaps_edit.append(gap)

median_gap_orig = sorted(gaps_orig)[len(gaps_orig) // 2]
median_gap_edit = sorted(gaps_edit)[len(gaps_edit) // 2]

print(f"Original median line gap: {median_gap_orig:.1f} pts")
print(f"Edited median line gap: {median_gap_edit:.1f} pts")

# 找异常间距
print("\nAbnormal gaps in edited PDF (gap > 25):")
for i, gap in enumerate(gaps_edit):
    if gap > 25:
        prev_line = lines_edit[i-1]
        curr_line = lines_edit[i]
        print(f"  [{i-1}->{i}] gap={gap:.1f}, between '{prev_line['text'][:20]}' and '{curr_line['text'][:20]}'")

doc_orig.close()
doc_edited.close()
print("\nAnalysis complete.")