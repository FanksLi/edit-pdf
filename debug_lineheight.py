"""检查后端 lineHeight 计算"""
import fitz
import sys
sys.path.insert(0, r"E:\studySpace\ai\edit-pdf\backend")

from app.services.pdf_service import PDFService

original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
service = PDFService(original_path)

paragraphs = service.get_page_text(0)

print("=" * 60)
print("后端返回的 lineHeight")
print("=" * 60)

# 找 y=200-300 区域的段落
for i, para in enumerate(paragraphs):
    if 200 <= para["bbox"][1] <= 300:
        print(f"\n[{i}] bbox y={para['bbox'][1]:.1f}-{para['bbox'][3]:.1f}")
        print(f"  fontSize: {para['fontSize']:.1f}")
        print(f"  lineHeight: {para['lineHeight']:.1f}")
        print(f"  text: '{para['text'][:40]}'")

        # 计算实际行间距（从 bbox 高度推算）
        bbox_height = para["bbox"][3] - para["bbox"][1]
        num_lines = len(para["text"].split('\n'))
        if num_lines > 1:
            actual_gap = bbox_height / (num_lines - 1) if num_lines > 1 else para["fontSize"]
            print(f"  推算实际 gap: {actual_gap:.1f}")

service.close()

# 直接从 PDF 获取行间距
print("\n" + "=" * 60)
print("PDF 实际行间距（从 get_text 分析）")
print("=" * 60)

doc = fitz.open(original_path)
page = doc[0]

lines = []
blocks = page.get_text("dict")["blocks"]
for block in blocks:
    if block["type"] != 0:
        continue
    for line in block["lines"]:
        text = "".join(s["text"] for s in line["spans"])
        bbox = line["bbox"]
        fontSize = line["spans"][0]["size"] if line["spans"] else 10
        lines.append({
            "text": text[:30],
            "y0": bbox[1],
            "fontSize": fontSize,
        })

lines.sort(key=lambda l: l["y0"])

# 计算实际间距
gaps = []
for i in range(1, len(lines)):
    gap = lines[i]["y0"] - lines[i-1]["y0"]
    if 200 <= lines[i]["y0"] <= 300:
        gaps.append(gap)
        print(f"y={lines[i-1]['y0']:.1f} -> y={lines[i]['y0']:.1f}: gap={gap:.1f}, fontSize={lines[i]['fontSize']:.1f}")

if gaps:
    print(f"\n实际间距范围: {min(gaps):.1f} - {max(gaps):.1f}")
    print(f"平均间距: {sum(gaps)/len(gaps):.1f}")

doc.close()
print("\nDone.")