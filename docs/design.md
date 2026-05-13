# PDF 文字编辑系统设计方案

## 1. 项目概述

### 目标
构建一个 Web 应用，实现 PDF 文字的精确提取、可视化编辑和修改导出。用户可像 Figma 一样双击文字进行编辑，修改后生成新的 PDF。

### 核心特性
- PDF 页面渲染为高清图片（前端展示）
- 文字精确坐标提取（逐词级别）
- DOM 覆盖层实现可编辑文字框
- 双击编辑 → 白框遮盖 → 写入新文字
- 原文件保护，始终生成新文件

---

## 2. 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| **后端框架** | FastAPI | 高性能异步 API，自动生成 OpenAPI 文档 |
| **PDF 主处理** | PyMuPDF (fitz) | 提取文字坐标、渲染图片、redact+insert 修改 |
| **PDF 辅助工具** | pdfplumber | 备选方案：带布局的文字提取，表格提取 |
| **PDF 创建** | reportlab | 备选方案：从头创建 PDF（当原 PDF 无法编辑时） |
| **包管理** | uv | 现代 Python 包管理，极快依赖安装 |
| **前端框架** | React 18 + Vite | 快速 HMR，轻量构建 |
| **前端样式** | **Tailwind CSS** | 用户选择，原子化 CSS |
| **API 通信** | fetch / axios | RESTful API 调用 |

### PDF 库选型对比

| 任务 | 最佳工具 | 说明 |
|---|---|---|
| 文字精确坐标提取 | **PyMuPDF** | `page.get_text("dict")` 返回每个 span 的 bbox |
| 文字布局提取 | pdfplumber | `page.extract_text()` 保持布局，适合纯文字导出 |
| 表格提取 | pdfplumber | `page.extract_tables()` 返回结构化表格数据 |
| 页面渲染为图片 | **PyMuPDF** | `page.get_pixmap(dpi=150)` 高质量渲染 |
| 抹除文字 | **PyMuPDF** | `add_redact_annot()` + `apply_redactions()` |
| 写入新文字 | **PyMuPDF** | `insert_text()` 或 reportlab |
| 创建新 PDF | reportlab | `canvas.Canvas()` 从头生成 PDF |
| OCR 扫描版 PDF | pytesseract + pdf2image | 图片转文字（备选扩展功能） |

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     前端 (React + Vite)                   │
│  ┌─────────────────────────────────────────────────────┐│
│  │  PDFCanvas 组件                                      ││
│  │  ├─ PDFImageLayer (img: 页面渲染图片)                 ││
│  │  ├─ TextOverlayLayer (绝对定位的透明 DOM 文字框)       ││
│  │  │   └─ TextBlock 组件 (可双击编辑的 span/input)       ││
│  │  └─ MaskLayer (编辑时的白色遮罩矩形)                   ││
│  └─────────────────────────────────────────────────────┘│
│         ↓ API 调用                                       │
├─────────────────────────────────────────────────────────┤
│                   后端 (FastAPI + PyMuPDF)                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│  │ PDFLoader    │ │ PDFRenderer  │ │ PDFModifier      │ │
│  │ - 加载文档    │ │ - 渲染页面    │ │ - redact 原文字   │ │
│  │ - 提取文字    │ │ - 返回 PNG   │ │ - insert 新文字   │ │
│  │ - 返回坐标    │ │              │ │ - 保存新 PDF     │ │
│  └──────────────┘ └──────────────┘ └──────────────────┘ │
│                      services/pdf_service.py             │
├─────────────────────────────────────────────────────────┤
│                      文件系统                             │
│  uploads/     ← 用户上传的原始 PDF                        │
│  renders/     ← 渲染的页面图片                            │
│  outputs/     ← 修改后导出的 PDF                          │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 数据流与 API 设计

### 4.1 核心数据模型

```python
# 文字块数据结构（前端需要）
class TextSpan:
    text: str              # 文字内容
    bbox: [x0, y0, x1, y1] # PDF 坐标（左下角为原点）
    page_bbox: [w, h]      # 页面尺寸（用于坐标转换）
    font_size: float       # 字号
    font_name: str         # 字体名称（用于近似匹配）
    color: [r, g, b]       # 颜色 RGB
```

### 4.2 API 接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/pdf/upload` | POST | 上传 PDF，返回 `{ file_id, page_count }` |
| `/api/pdf/{file_id}/page/{n}/render` | GET | 返回页面 PNG 图片 |
| `/api/pdf/{file_id}/page/{n}/text` | GET | 返回该页所有文字块坐标数据 |
| `/api/pdf/{file_id}/page/{n}/modify` | POST | Body: `{ edits: [{ bbox, newText }] }`，返回修改后的图片 + 文字数据 |
| `/api/pdf/{file_id}/export` | GET | 导出修改后的完整 PDF 文件 |

---

## 5. 前端核心逻辑

### 5.1 坐标转换

PDF 使用左下角为原点的坐标系，浏览器使用左上角。转换公式：

```javascript
// PDF bbox: [x0, y0, x1, y1] (左下原点)
// 页面高度: pageHeight
// 渲染图片高度: renderHeight (通常 = pageHeight * dpi/72)

const screenX = x0 * scale;
const screenY = renderHeight - y1 * scale; // Y 轴翻转
const width = (x1 - x0) * scale;
const height = (y1 - y0) * scale;
```

### 5.2 编辑交互流程

```
用户双击 TextBlock
  → 显示 MaskLayer (白色矩形遮挡该区域)
  → TextBlock 切换为 contenteditable 或 input
  → 用户编辑文字
  → 按 Enter 或点击外部确认
  → POST /api/pdf/{file_id}/page/{n}/modify
  → 后端执行 redact + insert_text
  → 返回新的页面图片 + 更新后的文字数据
  → 前端刷新显示
```

---

## 6. 项目目录结构

```
edit-pdf/
├── backend/                    # Python 后端
│   ├── pyproject.toml          # uv 项目配置
│   ├── .python-version         # Python 版本锁定 (建议 3.11+)
│   ├── uv.lock                 # 依赖锁定文件
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py             # FastAPI 入口
│   │   ├── config.py           # 配置管理
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   └── pdf.py          # PDF 相关 API 路由
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   └── pdf_service.py  # PyMuPDF 核心操作封装
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── pdf.py          # Pydantic 数据模型
│   │   └── utils/
│   │   │   ├── __init__.py
│   │   │   └── file_utils.py   # 文件操作工具
│   ├── uploads/                # 上传文件临时存储
│   ├── renders/                # 渲染图片缓存
│   └── outputs/                # 导出 PDF 存储
│   └── tests/
│       └── test_pdf_service.py
│
├── frontend/                   # React + Vite 前端
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   ├── src/
│   │   ├── App.jsx             # 应用入口
│   │   ├── main.jsx
│   │   ├── index.css           # Tailwind 入口
│   │   ├── components/
│   │   │   ├── PDFViewer.jsx   # PDF 查看器主组件
│   │   │   ├── TextBlock.jsx   # 单个可编辑文字块
│   │   │   ├── Toolbar.jsx     # 工具栏
│   │   │   └── FileUpload.jsx  # 文件上传组件
│   │   ├── hooks/
│   │   │   ├── usePDF.js       # PDF 操作 hook
│   │   │   └── useTextEdit.js  # 编辑交互 hook
│   │   ├── services/
│   │   │   └── api.js          # API 调用封装
│   │   └── utils/
│   │   │   └── coordinate.js   # 坐标转换工具
│   └── public/
│
├── docs/                       # 文档目录
│   ├── design.md               # 本设计文档
│   └── api.md                  # API 详细说明
│
├── README.md                   # 项目说明
└── .gitignore
```

---

## 7. 实现步骤

### Phase 1: 后端基础

1. **初始化 uv 项目**
   ```bash
   cd backend
   uv init
   uv add fastapi uvicorn pymupdf python-multipart
   ```

2. **实现 PDFLoader 模块**
   - `pdf_service.py`: 加载 PDF，提取文字坐标
   - `get_page_text()`: 使用 `page.get_text("dict")` 返回 span 数据结构
   - `get_page_size()`: 返回页面尺寸用于前端坐标转换

3. **实现 PDFRenderer 模块**
   - `render_page()`: PyMuPDF `get_pixmap(matrix=fitz.Matrix(zoom, zoom))`
   - 支持 DPI 参数（默认 150）

4. **实现 API 路由**
   - `/upload`: 接收文件，生成唯一 file_id
   - `/page/{n}/text`: 返回文字数据
   - `/page/{n}/render`: 返回图片

### Phase 2: 前端基础

1. **初始化 Vite + React + Tailwind**
   ```bash
   cd frontend
   npm create vite@latest . -- --template react
   npm install -D tailwindcss postcss autoprefixer
   npx tailwindcss init -p
   ```

2. **实现 PDFViewer 组件**
   - 获取页面图片，渲染 `<img>`
   - 获取文字数据，渲染 TextOverlayLayer

3. **实现坐标转换**
   - `coordinate.js`: PDF bbox → 屏幕 bbox

4. **实现 TextBlock 组件**
   - 绝对定位的透明 div
   - hover 显示虚线边框
   - 双击触发编辑模式

### Phase 3: 编辑功能

1. **后端实现 PDFModifier**
   - `modify_page()`: 接收 edits 列表
   - `add_redact_annot()` → `apply_redactions()` → `insert_text()`

2. **前端实现编辑交互**
   - 确认编辑 → API 调用 → 刷新显示

3. **实现撤销功能**
   - 保存编辑前状态
   - Ctrl+Z / Escape 撤销

### Phase 4: 导出与完善

1. **导出完整 PDF**
   - `/export`: 输出修改后的 PDF

2. **文件管理**
   - 临时文件清理策略
   - 原文件保护

---

## 8. 设计决策

| 决策项 | 选择 | 说明 |
|---|---|---|
| 前端样式 | **Tailwind CSS** | 用户选择，原子化 CSS 开发效率高 |
| 字体策略 | **Helvetica 默认替代** | 先跑通核心流程，后续可扩展精确匹配 |
| 多页支持 | **先单页 PoC** | 先跑通单页核心闭环，再扩展多页 |

---

## 9. MVP 范围

Phase 1-3 聚焦单页核心功能：
- 单 PDF 文件上传 → 显示第一页
- 文字坐标提取 → DOM 覆盖层渲染
- 双击编辑 → 修改 → 刷新显示
- 导出修改后的单页 PDF

Phase 4 再扩展：
- 多页切换
- 多页批量编辑
- 撤销历史