"""检查后端段落分组结果"""
import fitz
import sys
sys.path.insert(0, r"E:\studySpace\ai\edit-pdf\backend")

from app.services.pdf_service import PDFService

original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
service = PDFService(original_path)

paragraphs = service.get_page_text(0)

print("=" * 60)
print("Backend Paragraph Grouping Result")
print("=" * 60)

for i, para in enumerate(paragraphs):
    bbox = para["bbox"]
    height = bbox[3] - bbox[1]
    lines = para["text"].split('\n')
    print(f"\n[{i}] Paragraph:")
    print(f"  bbox: y0={bbox[1]:.1f}, y1={bbox[3]:.1f}, height={height:.1f}")
    print(f"  lines: {len(lines)}")
    print(f"  fontSize: {para['fontSize']:.1f}")
    print(f"  lineHeight: {para['lineHeight']:.1f}")
    for j, line in enumerate(lines[:3]):
        print(f"    [{j}] '{line[:40]}'")

service.close()
print("\nDone.")