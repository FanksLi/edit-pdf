---
name: pdf-text-editor-design
description: PDF 文字编辑系统技术设计方案
depends_on: proposal.md
---

# Design: PDF 文字编辑系统

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     前端 (React + Vite)                   │
│  PDFViewer 组件                                          │
│  ├─ PDFImageLayer (img: 页面渲染图片)                     │
│  ├─ TextOverlayLayer (绝对定位的文字框)                   │
│  │   └─ TextBlock 组件 (可双击编辑)                       │
│  └─ Toolbar (导出按钮)                                   │
└─────────────────────────────────────────────────────────┘
         ↓ REST API
┌─────────────────────────────────────────────────────────┐
│                   后端 (FastAPI + PyMuPDF)                │
│  PDFService                                              │
│  ├─ get_page_text() - 提取文字坐标                       │
│  ├─ render_page() - 渲染页面为 PNG                       │
│  ├─ modify_page() - redact + insert_text                 │
│  └─ export_pdf() - 导出修改后的 PDF                      │
└─────────────────────────────────────────────────────────┘
         ↓ 文件存储
┌─────────────────────────────────────────────────────────┐
│  uploads/ - 原始 PDF                                     │
│  renders/ - 渲染图片缓存                                  │
│  outputs/ - 修改后的 PDF                                 │
└─────────────────────────────────────────────────────────┘
```

## 核心模块设计

### 1. PDFService (backend/app/services/pdf_service.py)

**职责**：封装 PyMuPDF 所有 PDF 操作

**核心方法**：
```python
class PDFService:
    def __init__(file_path: str)      # 加载 PDF，生成 file_id
    def get_page_count() -> int       # 返回页数
    def get_page_size(page_num)       # 返回页面尺寸
    def get_page_text(page_num)       # 提取文字 span 数据
    def render_page(page_num, dpi)    # 渲染为 PNG
    def modify_page(page_num, edits)  # 执行文字修改
    def export_pdf()                  # 导出完整 PDF
    def close()                       # 释放资源
```

**关键实现细节**：
- 文字提取使用 `page.get_text("dict")`，返回 span 级别 bbox
- 渲染使用 `fitz.Matrix(zoom, zoom)` 控制 DPI
- 修改流程：`add_redact_annot()` → `apply_redactions()` → `insert_text()`
- 原文件保护：始终另存为新文件，不覆盖原文件

### 2. PDFRouter (backend/app/routers/pdf.py)

**职责**：定义 REST API 接口

**API 设计**：
| 接口 | 方法 | 请求 | 响应 |
|---|---|---|---|
| `/upload` | POST | multipart/form-data | `{ file_id, page_count, page_size }` |
| `/page/{n}/text` | GET | - | `{ spans: [{ text, bbox, fontSize, origin }] }` |
| `/page/{n}/render` | GET | `?dpi=150` | PNG 文件或 base64 |
| `/page/{n}/modify` | POST | `{ edits: [{ bbox, newText }] }` | `{ imagePath, textData }` |
| `/export` | GET | - | PDF 文件下载 |

### 3. PDFViewer 组件 (frontend/src/components/PDFViewer.jsx)

**职责**：主容器，协调各子组件

**状态管理**：
```javascript
const [fileId, setFileId] = useState(null);
const [pageData, setPageData] = useState({
  imagePath, textSpans, pageWidth, pageHeight
});
const [renderHeight, setRenderHeight] = useState(800);
```

**核心流程**：
1. 上传 PDF → 获取 file_id
2. 加载第一页图片和文字数据
3. 渲染图片层 + 文字覆盖层
4. 处理编辑事件 → 调用 modify API → 刷新显示
5. 导出 → 下载 PDF

### 4. TextBlock 组件 (frontend/src/components/TextBlock.jsx)

**职责**：单个文字块的编辑交互

**交互流程**：
```
hover → 显示虚线边框 (border-dashed border-blue-300)
dblclick → 进入编辑模式
  - 显示 input
  - 白色背景
  - 蓝色边框
keydown:
  - Enter → 保存，调用 onEdit
  - Escape → 取消，恢复原文
blur → 保存
```

### 5. 坐标转换 (frontend/src/utils/coordinate.js)

**职责**：PDF 坐标 → 屏幕坐标

**核心算法**：
```javascript
// PDF: 左下角原点，Y 向上
// Screen: 左上角原点，Y 向下

function pdfToScreen(bbox, pageHeight, renderHeight) {
  const [x0, y0, x1, y1] = bbox;
  const scale = renderHeight / pageHeight;
  return {
    left: x0 * scale,
    top: renderHeight - y1 * scale,  // Y 翻转
    width: (x1 - x0) * scale,
    height: (y1 - y0) * scale,
  };
}
```

## 数据模型

### TextSpan（前后端共用）

```typescript
interface TextSpan {
  text: string;
  bbox: [number, number, number, number];  // [x0, y0, x1, y1]
  fontSize: number;
  fontName: string;
  color: [number, number, number];  // RGB 0-1
  origin: [number, number];  // 文字基线起点
}
```

### EditRequest（修改请求）

```typescript
interface EditRequest {
  bbox: [number, number, number, number];
  newText: string;
  fontSize: number;
  origin: [number, number];
}
```

## 文件存储策略

| 目录 | 内容 | 清理策略 |
|---|---|---|
| `uploads/` | 用户上传的原始 PDF | 会话结束后可选清理 |
| `renders/` | 渲染的 PNG 图片 | 修改后自动更新 |
| `outputs/` | 导出的修改后 PDF | 用户下载后保留 |

**原文件保护**：
- 原始 PDF 始终存储在 uploads/，不被修改
- 所有修改操作在内存中的 doc 对象上进行
- 导出时生成新文件到 outputs/

## 错误处理

| 场景 | 处理方式 |
|---|---|
| PDF 文件损坏 | 返回 400 错误，提示用户 |
| 不支持的字体 | 自动用 Helvetica 替代 |
| 编辑冲突（并发） | MVP 不处理，后续可加锁 |
| 导出失败 | 返回 500，记录日志 |

## 性能考虑

| 问题 | 解决方案 |
|---|---|
| 大 PDF 文件加载慢 | MVP 单页，后续可分页加载 |
| 高 DPI 渲染慢 | 默认 DPI 150，可配置 |
| 文字 span 数量多 | 使用虚拟滚动（后续优化） |

## 测试策略

- **后端单元测试**：pytest 测试 PDFService 各方法
- **前端组件测试**：Vitest 测试 TextBlock 交互
- **集成测试**：手动测试完整流程
- **测试 PDF**：准备包含各种字体的测试 PDF 文件