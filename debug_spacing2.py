"""对比原始和编辑后 PDF 的行间距"""
import fitz

original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
edited_path = r"C:\Users\Fan\Downloads\edited (24).pdf"

doc_orig = fitz.open(original_path)
doc_edit = fitz.open(edited_path)

page_orig = doc_orig[0]
page_edit = doc_edit[0]

print("=" * 60)
print("原始 PDF 行间距分析")
print("=" * 60)

# 提取所有行
def get_lines(page):
    lines = []
    blocks = page.get_text("dict")["blocks"]
    for block in blocks:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            text = "".join(s["text"] for s in line["spans"])
            bbox = line["bbox"]
            lines.append({
                "text": text[:40],
                "y0": bbox[1],
                "y1": bbox[3],
            })
    return sorted(lines, key=lambda l: l["y0"])

lines_orig = get_lines(page_orig)
lines_edit = get_lines(page_edit)

# 计算行间距
print("\n原始行间距（相邻行的 y 差值）:")
gaps_orig = []
for i in range(1, len(lines_orig)):
    gap = lines_orig[i]["y0"] - lines_orig[i-1]["y0"]
    gaps_orig.append(gap)
    if 200 <= lines_orig[i]["y0"] <= 450:  # 关注编辑区域
        print(f"  [{lines_orig[i-1]['text'][:20]}] -> [{lines_orig[i]['text'][:20]}]: gap={gap:.1f}")

print("\n编辑后行间距:")
gaps_edit = []
for i in range(1, len(lines_edit)):
    gap = lines_edit[i]["y0"] - lines_edit[i-1]["y0"]
    gaps_edit.append(gap)
    if 200 <= lines_edit[i]["y0"] <= 450:  # 关注编辑区域
        print(f"  [{lines_edit[i-1]['text'][:20]}] -> [{lines_edit[i]['text'][:20]}]: gap={gap:.1f}")

# 统计
median_orig = sorted(gaps_orig)[len(gaps_orig)//2]
median_edit = sorted(gaps_edit)[len(gaps_edit)//2]

print(f"\n原始中位间距: {median_orig:.1f}")
print(f"编辑后中位间距: {median_edit:.1f}")

# 找异常间距（编辑区域）
print("\n" + "=" * 60)
print("编辑区域详细对比")
print("=" * 60)

# 找 y=200-300 区域的行（甲方信息）
print("\n原始 y=200-300 区域:")
for line in lines_orig:
    if 200 <= line["y0"] <= 300:
        print(f"  y={line['y0']:.1f}: '{line['text']}'")

print("\n编辑后 y=200-300 区域:")
for line in lines_edit:
    if 200 <= line["y0"] <= 300:
        print(f"  y={line['y0']:.1f}: '{line['text']}'")

doc_orig.close()
doc_edit.close()
print("\nDone.")