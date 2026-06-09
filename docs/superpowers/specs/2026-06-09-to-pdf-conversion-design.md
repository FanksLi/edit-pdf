# 文件转PDF功能设计文档

## 概述

扩展现有PDF转换服务，新增反向转换功能：将Office文档和图片转换为PDF。

## 需求

- 支持格式：docx、xlsx、pptx、jpg、jpeg、png
- 单文件转换，每个文件生成独立PDF
- 使用LibreOffice统一处理，保持架构一致

## 技术方案

### 方案选择：纯LibreOffice统一处理

**理由**：
1. 复用现有UNO基础设施，零额外成本
2. 架构统一，维护简单
3. LibreOffice对Office格式转换质量高
4. 图片导入功能成熟

### 数据结构

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

### API接口

**路由**: `POST /api/to-pdf`

**请求**：
- 单文件上传
- 自动识别扩展名
- 仅允许 docx/xlsx/pptx/jpg/jpeg/png

**响应**：
```python
return Response(
    content=result["bytes"],
    media_type="application/pdf",
    headers={"Content-Disposition": f'attachment; filename="{stem}.pdf"'},
)
```

**错误处理**：
- 400: 不支持的格式、空文件
- 500: LibreOffice转换失败、进程启动失败

### 转换流程

```python
def convert_to_pdf(file_bytes: bytes, source_format: str, original_filename: str) -> dict:
    """
    将文件转换为 PDF

    流程：
    1. 验证格式支持
    2. 写入临时文件
    3. 启动/复用 LibreOffice 监听进程
    4. 执行 UNO 转换脚本
    5. 读取生成的 PDF
    6. 清理临时文件
    7. 返回 PDF 字节流
    """
```

### UNO转换脚本

复用现有UNO脚本模式：
- 连接LibreOffice监听进程（localhost:2002）
- 使用对应格式的导入过滤器
- 统一用PDF导出过滤器

### 进程管理优化

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

**优化点**：
- 避免每次请求启动新进程
- 进程崩溃时自动重启
- 减少3秒启动等待时间

## 错误处理

| 场景 | 处理方式 | HTTP状态码 |
|------|---------|-----------|
| 不支持的格式 | 返回明确错误信息 | 400 |
| 空文件 | 拒绝处理 | 400 |
| LibreOffice未安装 | 检测soffice路径，未找到返回错误 | 500 |
| 监听进程启动失败 | 超时后重试，记录日志 | 500 |
| UNO转换失败 | 捕获stderr，返回具体错误 | 500 |
| 文件损坏无法加载 | LibreOffice返回错误，透传 | 500 |

## 文件结构

```
backend/app/
├── services/
│   └── convert_service.py    # 扩展：添加 convert_to_pdf() 和 TO_PDF_FORMATS
├── routers/
│   └── to_pdf.py             # 新增：/api/to-pdf 路由
│   └── convert.py            # 保持不变（PDF → Office）
└── main.py                   # 注册新路由
```

## 测试策略

### 单元测试

- `test_convert_to_pdf_docx()` - docx转PDF
- `test_convert_to_pdf_xlsx()` - xlsx转PDF
- `test_convert_to_pdf_pptx()` - pptx转PDF
- `test_convert_to_pdf_jpg()` - jpg转PDF
- `test_convert_to_pdf_png()` - png转PDF
- `test_unsupported_format()` - 不支持的格式返回400

### 集成测试

- 端到端API测试：上传文件 → 检查响应头 → 验证PDF可读性

## 依赖

- LibreOffice 7.x+（已集成）
- Python UNO库（LibreOffice自带）
- 无需新增Python依赖包

## 风险与限制

1. **LibreOffice依赖**：需确保服务器安装LibreOffice
2. **并发性能**：LibreOffice监听进程单实例，高并发可能成为瓶颈
3. **图片布局**：LibreOffice Draw导入图片的默认布局可能需要调整

## 后续扩展

- 多文件合并转PDF（已预留设计空间）
- 支持更多图片格式（bmp/gif/webp/tiff）
- PDF转换选项（页面大小、方向、质量）
