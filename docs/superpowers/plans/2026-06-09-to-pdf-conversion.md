# 文件转PDF功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展现有PDF转换服务，新增Office文档和图片转PDF功能

**Architecture:** 复用现有LibreOffice UNO基础设施，在convert_service.py添加反向转换逻辑，新增独立路由/api/to-pdf处理文件上传和转换

**Tech Stack:** FastAPI、LibreOffice UNO API、Python tempfile

---

## 文件结构

```
backend/app/
├── services/
│   └── convert_service.py    # 扩展：添加 TO_PDF_FORMATS、convert_to_pdf()、_get_or_start_listener()
├── routers/
│   └── to_pdf.py             # 新增：/api/to-pdf 路由
│   └── convert.py            # 保持不变
└── main.py                   # 修改：注册 to_pdf 路由
backend/tests/
└── test_to_pdf.py           # 新增：单元测试
```

---

### Task 1: 添加 TO_PDF_FORMATS 数据结构

**Files:**
- Modify: `backend/app/services/convert_service.py:26`

- [ ] **Step 1: 在 SUPPORTED_FORMATS 后添加 TO_PDF_FORMATS**

在 `convert_service.py` 第45行后添加：

```python
TO_PDF_FORMATS = {
    "docx": {
        "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "ext": ".docx",
        "import_filter": "Office Open XML Text",
    },
    "xlsx": {
        "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ext": ".xlsx",
        "import_filter": "Calc Office Open XML",
    },
    "pptx": {
        "mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "ext": ".pptx",
        "import_filter": "Impress Office Open XML",
    },
    "jpg": {
        "mime": "image/jpeg",
        "ext": ".jpg",
        "import_filter": "draw_jpg_import",
    },
    "jpeg": {
        "mime": "image/jpeg",
        "ext": ".jpeg",
        "import_filter": "draw_jpg_import",
    },
    "png": {
        "mime": "image/png",
        "ext": ".png",
        "import_filter": "draw_png_import",
    },
}
```

- [ ] **Step 2: 验证语法正确**

Run: `cd backend && python -c "from app.services.convert_service import TO_PDF_FORMATS; print(list(TO_PDF_FORMATS.keys()))"`
Expected: `['docx', 'xlsx', 'pptx', 'jpg', 'jpeg', 'png']`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/convert_service.py
git commit -m "feat: add TO_PDF_FORMATS data structure"
```

---

### Task 2: 添加进程复用函数

**Files:**
- Modify: `backend/app/services/convert_service.py:99`

- [ ] **Step 1: 在文件顶部添加 time 导入**

在 `convert_service.py` 第6行后添加：

```python
import time
```

- [ ] **Step 2: 添加全局变量和进程复用函数**

在 `_start_listener()` 函数前添加：

```python
# 全局监听进程缓存
_listener_process = None
_listener_start_time = None

def _get_or_start_listener():
    """复用监听进程，避免重复启动"""
    global _listener_process, _listener_start_time
    
    if _listener_process and _listener_process.poll() is None:
        return _listener_process
    
    # 启动新进程
    _listener_process = _start_listener()
    _listener_start_time = time.time()
    return _listener_process
```

- [ ] **Step 3: 验证语法正确**

Run: `cd backend && python -c "from app.services.convert_service import _get_or_start_listener; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/convert_service.py
git commit -m "feat: add listener process reuse"
```

---

### Task 3: 添加转PDF的UNO转换脚本

**Files:**
- Modify: `backend/app/services/convert_service.py:97`

- [ ] **Step 1: 在 _CONVERT_SCRIPT 后添加 _CONVERT_TO_PDF_SCRIPT**

在第96行后添加：

```python
_CONVERT_TO_PDF_SCRIPT = '''
import sys
import uno
from com.sun.star.beans import PropertyValue

input_path = sys.argv[1]
output_path = sys.argv[2]
import_filter = sys.argv[3]

localContext = uno.getComponentContext()
resolver = localContext.ServiceManager.createInstanceWithContext(
    "com.sun.star.bridge.UnoUrlResolver", localContext)
ctx = resolver.resolve(
    "uno:socket,host=localhost,port=2002;urp;StarOffice.ComponentContext")
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
p.Value = "writer_pdf_Export"
out_props.append(p)
p2 = PropertyValue()
p2.Name = "Overwrite"
p2.Value = True
out_props.append(p2)

doc.storeToURL(out_url, tuple(out_props))
doc.close(True)
print("OK")
'''
```

- [ ] **Step 2: 验证语法正确**

Run: `cd backend && python -c "from app.services.convert_service import _CONVERT_TO_PDF_SCRIPT; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/convert_service.py
git commit -m "feat: add UNO script for to-pdf conversion"
```

---

### Task 4: 添加 convert_to_pdf() 核心函数

**Files:**
- Modify: `backend/app/services/convert_service.py:305`

- [ ] **Step 1: 在文件末尾添加 convert_to_pdf() 函数**

在 `convert_service.py` 末尾添加：

```python
def convert_to_pdf(file_bytes: bytes, source_format: str, original_filename: str) -> dict:
    """将 Office 文档或图片转换为 PDF
    
    Args:
        file_bytes: 源文件字节流
        source_format: 源格式（docx/xlsx/pptx/jpg/jpeg/png）
        original_filename: 原始文件名
        
    Returns:
        dict: {"bytes": pdf_bytes, "mime": "application/pdf", "filename": "xxx.pdf"}
        
    Raises:
        ValueError: 不支持的格式
        RuntimeError: LibreOffice转换失败
    """
    if source_format not in TO_PDF_FORMATS:
        raise ValueError(f"Unsupported source format: {source_format}")
    
    fmt_info = TO_PDF_FORMATS[source_format]
    
    tmp_dir = tempfile.mkdtemp()
    listener = None
    
    try:
        # 写入临时源文件
        source_ext = fmt_info["ext"]
        source_path = Path(tmp_dir) / f"input{source_ext}"
        source_path.write_bytes(file_bytes)
        
        # 输出PDF路径
        output_path = Path(tmp_dir) / "output.pdf"
        
        # 获取或启动监听进程（复用）
        listener = _get_or_start_listener()
        
        # 查找LibreOffice Python
        lo_python = _find_lo_python()
        if not lo_python:
            raise RuntimeError("LibreOffice Python not found")
        
        # 写入转换脚本
        script_path = Path(tmp_dir) / "_convert_to_pdf.py"
        script_path.write_text(_CONVERT_TO_PDF_SCRIPT)
        
        # 执行转换
        result = subprocess.run(
            [lo_python, str(script_path), str(source_path), str(output_path), fmt_info["import_filter"]],
            capture_output=True, text=True, timeout=120,
        )
        
        if result.returncode != 0 or "OK" not in (result.stdout or ""):
            raise RuntimeError(f"Conversion failed: {result.stderr or result.stdout}")
        
        if not output_path.exists():
            raise FileNotFoundError("Converted PDF not found")
        
        # 读取生成的PDF
        pdf_bytes = output_path.read_bytes()
        stem = Path(original_filename).stem
        
        return {
            "bytes": pdf_bytes,
            "mime": "application/pdf",
            "filename": f"{stem}.pdf",
        }
    finally:
        # 注意：不在此停止监听进程，保持复用
        shutil.rmtree(tmp_dir, ignore_errors=True)
```

- [ ] **Step 2: 验证语法正确**

Run: `cd backend && python -c "from app.services.convert_service import convert_to_pdf; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/convert_service.py
git commit -m "feat: add convert_to_pdf function"
```

---

### Task 5: 创建 to_pdf 路由

**Files:**
- Create: `backend/app/routers/to_pdf.py`

- [ ] **Step 1: 创建路由文件**

创建文件 `backend/app/routers/to_pdf.py`：

```python
"""文件转 PDF API 路由"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response
from pathlib import Path

from app.services.convert_service import convert_to_pdf, TO_PDF_FORMATS

router = APIRouter(prefix="/api/to-pdf", tags=["to-pdf"])


@router.post("/")
async def to_pdf(file: UploadFile = File(...)):
    """将 Office 文档或图片转换为 PDF
    
    支持格式：docx, xlsx, pptx, jpg, jpeg, png
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")
    
    # 提取扩展名（去掉点）
    ext = Path(file.filename).suffix.lower().lstrip(".")
    
    if ext not in TO_PDF_FORMATS:
        supported = ", ".join(TO_PDF_FORMATS.keys())
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{ext}'. Supported: {supported}"
        )
    
    file_bytes = await file.read()
    
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file not allowed")
    
    try:
        result = convert_to_pdf(file_bytes, ext, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")
    
    return Response(
        content=result["bytes"],
        media_type=result["mime"],
        headers={"Content-Disposition": f'attachment; filename="{result["filename"]}"'},
    )
```

- [ ] **Step 2: 验证语法正确**

Run: `cd backend && python -c "from app.routers.to_pdf import router; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/to_pdf.py
git commit -m "feat: add /api/to-pdf route"
```

---

### Task 6: 注册路由到主应用

**Files:**
- Modify: `backend/app/main.py:7`

- [ ] **Step 1: 导入 to_pdf 路由**

修改 `main.py` 第7行：

```python
from app.routers import pdf, convert, to_pdf
```

- [ ] **Step 2: 注册路由**

在第32行后添加：

```python
app.include_router(to_pdf.router)
```

- [ ] **Step 3: 验证应用启动**

Run: `cd backend && python -c "from app.main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: register to_pdf router"
```

---

### Task 7: 编写单元测试

**Files:**
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_to_pdf.py`

- [ ] **Step 1: 创建测试目录**

```bash
mkdir -p backend/tests
touch backend/tests/__init__.py
```

- [ ] **Step 2: 创建测试文件**

创建文件 `backend/tests/test_to_pdf.py`：

```python
"""测试文件转PDF功能"""
import pytest
from pathlib import Path
from app.services.convert_service import convert_to_pdf, TO_PDF_FORMATS


class TestConvertToPdfFormats:
    """测试支持的格式"""
    
    def test_to_pdf_formats_defined(self):
        """验证支持的格式列表"""
        expected = ["docx", "xlsx", "pptx", "jpg", "jpeg", "png"]
        assert list(TO_PDF_FORMATS.keys()) == expected
    
    def test_unsupported_format_raises_error(self):
        """不支持的格式应抛出 ValueError"""
        with pytest.raises(ValueError, match="Unsupported source format"):
            convert_to_pdf(b"test", "txt", "test.txt")


class TestToPdfConversion:
    """测试实际转换功能（需要LibreOffice）"""
    
    @pytest.fixture
    def sample_docx(self, tmp_path):
        """创建测试用的 docx 文件"""
        # 使用真实的 docx 文件或跳过
        sample_file = Path("tests/fixtures/sample.docx")
        if not sample_file.exists():
            pytest.skip("Sample docx file not found")
        return sample_file.read_bytes()
    
    def test_docx_to_pdf(self, sample_docx):
        """测试 docx 转 PDF"""
        result = convert_to_pdf(sample_docx, "docx", "test.docx")
        
        assert "bytes" in result
        assert "mime" in result
        assert "filename" in result
        assert result["mime"] == "application/pdf"
        assert result["filename"].endswith(".pdf")
        assert len(result["bytes"]) > 0
        # 验证PDF魔术字节
        assert result["bytes"][:4] == b"%PDF"
    
    @pytest.fixture
    def sample_jpg(self, tmp_path):
        """创建测试用的 jpg 文件"""
        # 使用最小的有效JPEG文件或跳过
        sample_file = Path("tests/fixtures/sample.jpg")
        if not sample_file.exists():
            pytest.skip("Sample jpg file not found")
        return sample_file.read_bytes()
    
    def test_jpg_to_pdf(self, sample_jpg):
        """测试 jpg 转 PDF"""
        result = convert_to_pdf(sample_jpg, "jpg", "test.jpg")
        
        assert result["mime"] == "application/pdf"
        assert result["filename"].endswith(".pdf")
        assert result["bytes"][:4] == b"%PDF"


class TestToPdfAPI:
    """测试 API 路由"""
    
    def test_unsupported_format_returns_400(self):
        """不支持的格式应返回 400"""
        from fastapi.testclient import TestClient
        from app.main import app
        
        client = TestClient(app)
        
        response = client.post(
            "/api/to-pdf/",
            files={"file": ("test.txt", b"test content", "text/plain")}
        )
        
        assert response.status_code == 400
        assert "Unsupported format" in response.json()["detail"]
    
    def test_empty_file_returns_400(self):
        """空文件应返回 400"""
        from fastapi.testclient import TestClient
        from app.main import app
        
        client = TestClient(app)
        
        response = client.post(
            "/api/to-pdf/",
            files={"file": ("test.docx", b"", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        )
        
        assert response.status_code == 400
        assert "Empty file" in response.json()["detail"]
```

- [ ] **Step 3: 创建测试固件目录**

```bash
mkdir -p backend/tests/fixtures
```

- [ ] **Step 4: 运行测试（预期部分失败：缺少固件文件）**

Run: `cd backend && python -m pytest tests/test_to_pdf.py -v`
Expected: 部分测试通过，部分跳过（缺少固件文件）

- [ ] **Step 5: Commit**

```bash
git add backend/tests/
git commit -m "test: add to-pdf conversion tests"
```

---

### Task 8: 创建测试固件文件

**Files:**
- Create: `backend/tests/fixtures/sample.docx`（最小有效docx）
- Create: `backend/tests/fixtures/sample.jpg`（最小有效jpg）

- [ ] **Step 1: 下载或创建测试文件**

说明：这部分需要手动准备真实的测试文件，或使用以下方式生成：

```bash
# 如果有LibreOffice，可以用它创建简单的测试文件
# 或从项目资源目录复制
```

- [ ] **Step 2: 验证转换测试通过**

Run: `cd backend && python -m pytest tests/test_to_pdf.py -v`
Expected: 核心测试通过

---

## 验收标准

- [ ] API端点 `/api/to-pdf/` 可访问
- [ ] 支持 docx/xlsx/pptx/jpg/jpeg/png 格式
- [ ] 不支持的格式返回400错误
- [ ] 空文件返回400错误
- [ ] 转换失败返回500错误并包含具体信息
- [ ] 生成的PDF文件有效（以%PDF开头）
- [ ] 监听进程复用，避免重复启动

---

## 执行顺序总结

1. Task 1: 数据结构
2. Task 2: 进程管理
3. Task 3: UNO脚本
4. Task 4: 核心转换函数
5. Task 5: API路由
6. Task 6: 路由注册
7. Task 7: 单元测试
8. Task 8: 测试固件
