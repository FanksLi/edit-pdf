"""测试导出 PDF：验证方框问题和背景色问题"""
import sys
sys.path.insert(0, '.')

import json
from app.services.pdf_service import PDFService
from pathlib import Path

# 找一个上传的 PDF
upload_dir = Path('uploads')
pdf_files = list(upload_dir.glob('*.pdf'))
if not pdf_files:
    print("No PDF files found in uploads/")
    sys.exit(1)

pdf_path = str(pdf_files[-1])
print(f"Using: {pdf_path}")

service = PDFService(pdf_path)
service.file_id = pdf_files[-1].stem

# 打印页面字体信息
page = service.doc[0]
print("\n=== Page fonts ===")
for fi in page.get_fonts():
    xref, _, _, name, *_ = fi
    print(f"  xref={xref} name={name}")
    try:
        fd = service.doc.extract_font(xref)
        if isinstance(fd, tuple) and len(fd) > 3:
            print(f"    ext={fd[1]} type={fd[2]} content_len={len(fd[3]) if fd[3] else 0}")
        elif isinstance(fd, dict):
            print(f"    ext={fd.get('ext')} type={fd.get('type')} content_len={len(fd.get('content',b''))}")
    except Exception as e:
        print(f"    extract error: {e}")

# 测试导出
request_body = {
    "paragraph_edits": [
        {
            "bbox": [62.692909240722656, 162.16943359375, 199.19290161132812, 172.66943359375],
            "newText": "合同编号：_____",
            "fontSize": 10.5,
            "fontName": "SimHei",
            "color": [0, 0, 0],
            "height_delta": 0,
            "lineHeight": 24
        },
        {
            "bbox": [62.692909240722656, 206.16943359375, 330.4429016113281, 288.66943359375],
            "newText": "甲方\n名称：________________________________________\n法定代表人：______________ 联系电话：______________\n注册地址：______________________________________",
            "fontSize": 10.5,
            "fontName": "SimHei",
            "color": [0, 0, 0],
            "height_delta": 0,
            "lineHeight": 24
        },
        {
            "bbox": [62.692909240722656, 570.32470703125, 164.8369140625, 585.24072265625],
            "new_bbox": [62.21290924072265, 536.7310960785974, 171.98699440002443, 590.9990960785974],
            "newText": "第一条 \n\n123123123",
            "fontSize": 14,
            "fontName": "MicrosoftYaHei-0",
            "color": [0, 0, 0],
            "height_delta": 48,
            "lineHeight": 24
        },
        {
            "bbox": [259.2821044921875, 64.92278289794922, 326.36181640625, 75.90555572509766],
            "new_bbox": [448.88210449218747, 42.36707268688249, 521.1373962402345, 51.88707268688248],
            "newText": "Double click to edit",
            "fontSize": 8,
            "fontName": "Helvetica",
            "color": [0, 0, 0],
            "height_delta": 0,
            "lineHeight": 24
        }
    ],
    "image_edits": [],
    "drawing_edits": [
        {
            "old_bbox": [210.32325744628906, 43.94775390625, 403.7864990234375, 93.88836669921875],
            "new_bbox": [78.80325744628907, 46.82720627362023, 272.2664990234375, 96.76781906658898],
            "fill": [0.8509804010391235, 0.4274509847164154, 0.3803921639919281],
            "stroke": [0.8509804010391235, 0.4274509847164154, 0.3803921639919281]
        }
    ]
}

try:
    output = service.apply_edits_and_export(
        0,
        request_body["paragraph_edits"],
        request_body["image_edits"],
        request_body["drawing_edits"]
    )
    print(f"\nExport OK: {output}")
    print(f"File size: {Path(output).stat().st_size / 1024:.1f} KB")
except Exception as e:
    import traceback
    print(f"\nExport FAILED: {e}")
    traceback.print_exc()

service.close()
