"""PDF 转换服务 - docx 使用 pdf2docx，其余格式使用 LibreOffice UNO API"""

import subprocess
import tempfile
import shutil
import platform
import re
import zipfile
import sys
from pathlib import Path


def _find_soffice():
    if platform.system() == "Windows":
        for p in [
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        ]:
            if Path(p).exists():
                return p
    return "soffice"


SOFFICE = _find_soffice()

SUPPORTED_FORMATS = {
    "docx": {
        "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "ext": ".docx",
        "import_filter": "writer_pdf_import",
        "export_filter": "Office Open XML Text",
    },
    "xlsx": {
        "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ext": ".xlsx",
        "import_filter": "calc_pdf_import",
        "export_filter": "Calc Office Open XML",
    },
    "pptx": {
        "mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "ext": ".pptx",
        "import_filter": "impress_pdf_import",
        "export_filter": "Impress Office Open XML",
    },
}

_CONVERT_SCRIPT = '''
import sys
import uno
from com.sun.star.beans import PropertyValue

input_path = sys.argv[1]
output_path = sys.argv[2]
import_filter = sys.argv[3]
export_filter = sys.argv[4]

localContext = uno.getComponentContext()
resolver = localContext.ServiceManager.createInstanceWithContext(
    "com.sun.star.bridge.UnoUrlResolver", localContext)
ctx = resolver.resolve(
    "uno:socket,host=localhost,port=2002;"
    "urp;StarOffice.ComponentContext")
smgr = ctx.ServiceManager
desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)

url = uno.systemPathToFileUrl(input_path)
props = []
p = PropertyValue()
p.Name = "Hidden"
p.Value = True
props.append(p)
p2 = PropertyValue()
p2.Name = "FilterName"
p2.Value = import_filter
props.append(p2)

doc = desktop.loadComponentFromURL(url, "_blank", 0, tuple(props))
if not doc:
    print(f"ERROR: Failed to load {input_path}", file=sys.stderr)
    sys.exit(1)

out_url = uno.systemPathToFileUrl(output_path)
out_props = []
p = PropertyValue()
p.Name = "FilterName"
p.Value = export_filter
out_props.append(p)
p2 = PropertyValue()
p2.Name = "Overwrite"
p2.Value = True
out_props.append(p2)

doc.storeToURL(out_url, tuple(out_props))
doc.close(True)
print("OK")
'''


def _start_listener():
    """启动 LibreOffice 监听模式"""
    proc = subprocess.Popen(
        [SOFFICE, "--headless", "--norestore", "--accept=socket,host=localhost,port=2002;urp;"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    import time
    time.sleep(3)
    return proc


def _stop_listener(proc):
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def _find_lo_python():
    if platform.system() == "Windows":
        lo_python = Path(SOFFICE).parent / "python.exe"
        if lo_python.exists():
            return str(lo_python)
    return None


def _fix_docx_postprocess(docx_bytes: bytes) -> bytes:
    """后处理 docx：修复 PDF 转 docx 的排版问题
    1. 删除浮动 Drawing / VML / anchor 元素（色块转成的浮动图片）
    2. 白色文字改黑色
    3. 去除连续重复段落
    """
    # ── regex patterns ──
    # 白色文字
    white_pattern = re.compile(
        r'(<(?:\w+:)?color\s+(?:\w+:)?val\s*=\s*")([fF]{6})("\s*/?>)',
    )
    # 包含 mc:AlternateContent 的 run（浮动文本框 / 背景色块）
    drawing_run_pattern = re.compile(
        r'<w:r>\s*<w:rPr>.*?</w:rPr>\s*<mc:AlternateContent>.*?</mc:AlternateContent>\s*</w:r>',
        re.DOTALL,
    )
    # 包含 w:drawing 的 run（浮动 anchor / inline 图片）
    anchor_run_pattern = re.compile(
        r'<w:r>\s*(?:<w:rPr>.*?</w:rPr>)?\s*<w:drawing>.*?</w:drawing>\s*</w:r>',
        re.DOTALL,
    )
    # 空 run（只有 rPr 没有 t）
    empty_run_pattern = re.compile(
        r'<w:r>\s*<w:rPr>.*?</w:rPr>\s*</w:r>',
        re.DOTALL,
    )

    tmp_in = tempfile.SpooledTemporaryFile(max_size=10 * 1024 * 1024)
    tmp_in.write(docx_bytes)
    tmp_in.seek(0)

    tmp_out = tempfile.SpooledTemporaryFile(max_size=10 * 1024 * 1024)

    with zipfile.ZipFile(tmp_in, 'r') as zin:
        with zipfile.ZipFile(tmp_out, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == 'word/document.xml':
                    text = data.decode('utf-8')
                    # 1. 删除浮动元素（色块转成的图片 / VML 对象）
                    text = drawing_run_pattern.sub('', text)
                    text = anchor_run_pattern.sub('', text)
                    # 2. 删除空 run
                    text = empty_run_pattern.sub('', text)
                    # 3. 修复白色文字
                    text = white_pattern.sub(r'\g<1>000000\g<3>', text)
                    # 4. 去除连续重复段落
                    text = _dedup_paragraphs(text)
                    data = text.encode('utf-8')
                zout.writestr(item, data)

    tmp_out.seek(0)
    result = tmp_out.read()
    tmp_in.close()
    tmp_out.close()
    return result


def _dedup_paragraphs(xml_text: str) -> str:
    """去除连续重复的 <w:p> 段落"""
    para_pattern = re.compile(r'(<w:p>.*?</w:p>)', re.DOTALL)

    def extract_text(p):
        texts = re.findall(r'<w:t[^>]*>(.*?)</w:t>', p)
        return ''.join(texts).strip()

    parts = para_pattern.split(xml_text)
    if not parts:
        return xml_text

    result = []
    prev_text = None
    for part in parts:
        if part.startswith('<w:p>') and part.endswith('</w:p>'):
            text = extract_text(part)
            if text and text == prev_text:
                continue
            prev_text = text
            result.append(part)
        else:
            result.append(part)

    return ''.join(result)


def _convert_pdf_to_docx(pdf_bytes: bytes, output_path: Path) -> None:
    """使用 pdf2docx 将 PDF 转为 docx

    float_image_ignorable_gap=0 强制图片浮动，避免挤压文字
    """
    from pdf2docx import Converter

    tmp_dir = tempfile.mkdtemp()
    try:
        pdf_path = Path(tmp_dir) / "input.pdf"
        pdf_path.write_bytes(pdf_bytes)

        cv = Converter(str(pdf_path))
        cv.convert(str(output_path), float_image_ignorable_gap=0)
        cv.close()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def convert_pdf_to(pdf_bytes: bytes, target_format: str, original_filename: str = "document.pdf") -> dict:
    if target_format not in SUPPORTED_FORMATS:
        raise ValueError(f"Unsupported target format: {target_format}")

    fmt_info = SUPPORTED_FORMATS[target_format]

    if target_format == "docx":
        return _convert_docx_via_pdf2docx(pdf_bytes, fmt_info, original_filename)

    return _convert_via_libreoffice(pdf_bytes, target_format, fmt_info, original_filename)


def _convert_docx_via_pdf2docx(pdf_bytes: bytes, fmt_info: dict, original_filename: str) -> dict:
    """pdf2docx 转 docx + 后处理修复排版"""
    tmp_dir = tempfile.mkdtemp()
    try:
        output_path = Path(tmp_dir) / f"output{fmt_info['ext']}"
        _convert_pdf_to_docx(pdf_bytes, output_path)

        if not output_path.exists():
            raise FileNotFoundError("Converted file not found")

        converted_bytes = output_path.read_bytes()
        # 后处理：修复浮动色块、间距、边距
        converted_bytes = _fix_docx_postprocess(converted_bytes)

        stem = Path(original_filename).stem
        return {
            "bytes": converted_bytes,
            "mime": fmt_info["mime"],
            "filename": f"{stem}{fmt_info['ext']}",
        }
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

def _convert_via_libreoffice(pdf_bytes: bytes, target_format: str, fmt_info: dict, original_filename: str) -> dict:
    """LibreOffice UNO 转换（xlsx/pptx）"""
    tmp_dir = tempfile.mkdtemp()
    listener = None

    try:
        pdf_path = Path(tmp_dir) / "input.pdf"
        output_path = Path(tmp_dir) / f"output{fmt_info['ext']}"
        pdf_path.write_bytes(pdf_bytes)

        listener = _start_listener()

        lo_python = _find_lo_python()
        if lo_python:
            script_path = Path(tmp_dir) / "_convert.py"
            script_path.write_text(_CONVERT_SCRIPT)
            result = subprocess.run(
                [lo_python, str(script_path), str(pdf_path), str(output_path), fmt_info["import_filter"], fmt_info["export_filter"]],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode != 0 or "OK" not in (result.stdout or ""):
                raise RuntimeError(f"Conversion failed: {result.stderr or result.stdout}")
        else:
            raise RuntimeError("LibreOffice Python not found")

        if not output_path.exists():
            raise FileNotFoundError(f"Converted file not found")

        converted_bytes = output_path.read_bytes()
        stem = Path(original_filename).stem

        return {
            "bytes": converted_bytes,
            "mime": fmt_info["mime"],
            "filename": f"{stem}{fmt_info['ext']}",
        }
    finally:
        _stop_listener(listener)
        shutil.rmtree(tmp_dir, ignore_errors=True)
