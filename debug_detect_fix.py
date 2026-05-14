"""验证修改后的 _detect_bg_color"""
import fitz
import sys
sys.path.insert(0, r"E:\studySpace\ai\edit-pdf\backend")

from app.services.pdf_service import PDFService

original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
service = PDFService(original_path)

page = service.doc[0]

# 测试"注册地址"行的检测
bbox = fitz.Rect(62.69, 278.17, 314.69, 288.67)

bg_color = service._detect_bg_color(page, bbox)
print(f"检测结果: RGB={tuple(int(c*255) for c in bg_color)}")
print(f"是否接近白色: {abs(bg_color[0]-1)<0.1 and abs(bg_color[1]-1)<0.1 and abs(bg_color[2]-1)<0.1}")

# 测试其他区域
test_areas = [
    ("甲方单位名称", fitz.Rect(62.69, 206.17, 314.69, 216.67)),
    ("乙方投资人姓名", fitz.Rect(62.69, 336.17, 314.69, 346.67)),
]

for name, bbox in test_areas:
    bg = service._detect_bg_color(page, bbox)
    print(f"\n{name}: RGB={tuple(int(c*255) for c in bg)}")

service.close()
print("\nDone.")