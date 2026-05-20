# 操作栏 + 新增元素支持 设计文档

## 概述

为 PDF 编辑器添加操作栏，支持添加文本和图片元素，选中元素后可编辑属性。新元素可导出到 PDF。全栈实现（前端 React + 后端 FastAPI）。

## 前端设计

### 操作栏组件 (`Toolbar.jsx`)

位于 `PDFViewer.jsx` 顶部工具栏下方，水平排列，三个区域：

```
┌─────────────────────────────────────────────────────────┐
│ [+ 文本] [+ 图片]  │  [属性区：动态切换]  │  [删除]     │
└─────────────────────────────────────────────────────────┘
```

**状态切换：**
- 未选中 → 显示添加按钮（文本/图片）
- 选中文本 → 字体下拉 | 字号输入 | B/I 切换 | 颜色选择 | 对齐按钮 | 删除
- 选中图片 → 宽/高输入 | 不透明度滑块 | 删除

**手机端适配：**
- 操作栏 `overflow-x-auto` 水平滚动
- 属性控件紧凑排列
- 添加按钮固定可见

### 选中事件桥接

- `PageCanvas` 新增 `onSelectionChange(obj, type)` 回调
- 监听 Fabric `selection:created` / `selection:updated` / `selection:cleared`
- `PDFViewer` 持有 `selectedObject` state，传给 `Toolbar`

### 添加文本

- 创建 `Textbox`，默认：`fontSize: 16 * scale`、`fontFamily: 'Helvetica'`、居中
- 标记 `_newElement = true`，无 `_pdfData`
- 自动进入编辑模式 `enterEditing()`

### 添加图片

- 触发隐藏 `<input type="file" accept="image/*">`
- 读取文件 → 调 `uploadImage` API → 后端存临时文件返回 `image_id`
- 用 `image_id` 构造 URL 加载 `FabricImage`
- 默认尺寸 max 200x200，保持比例
- 标记 `_newElement = true`

### 属性编辑

直接修改 Fabric 对象属性 + `canvas.requestRenderAll()`：

**文本属性：**
- 字体族：从 `GET /api/pdf/fonts` 获取列表，使用 `backend/localFont` 目录下的字体
- 字号：数字输入
- 粗体/斜体：toggle 按钮，根据选中字体的 `supportsBold` / `supportsItalic` 启用/禁用
- 颜色：`<input type="color">`
- 对齐：左/中/右按钮

**图片属性：**
- 宽/高输入（联动 scaleX/scaleY）
- 不透明度：range slider 0-100
- 删除按钮

### collectEdits() 扩展

区分 `_pdfData`（已有元素编辑）和 `_newElement`（新增元素）：

- 已有 → `paragraph_edits` / `image_edits` / `drawing_edits`
- 新增 → `new_elements` 统一列表，每项含 `type` 字段

新元素数据：
```json
[
  {
    "type": "text",
    "bbox": [x0, y0, x1, y1],
    "text": "...",
    "font_name": "Helvetica",
    "font_size": 12.0,
    "color": [0, 0, 0],
    "font_weight": "bold",
    "font_style": "normal",
    "text_align": "left"
  },
  {
    "type": "image",
    "bbox": [x0, y0, x1, y1],
    "image_id": "abc123",
    "opacity": 0.8
  }
]
```

## 后端设计

### 新增 API

1. `GET /api/pdf/fonts` — 扫描 `localFont` 目录，返回字体族列表及变体能力
2. `POST /api/pdf/{file_id}/upload_image` — 上传图片到临时目录，返回 `{ image_id }`
3. `export_all` 接口扩展：每页支持 `new_elements` 字段

### 数据模型

```python
class NewElement(BaseModel):
    type: Literal["text", "image"]

    # 通用
    bbox: list[float]  # [x0, y0, x1, y1]

    # 文本字段
    text: str | None = None
    font_name: str | None = None
    font_size: float | None = None
    color: list[float] | None = None       # [r, g, b] 0-1
    font_weight: str | None = None         # "normal" / "bold"
    font_style: str | None = None          # "normal" / "italic"
    text_align: str | None = None          # "left" / "center" / "right"

    # 图片字段
    image_id: str | None = None
    opacity: float | None = None           # 0-1
```

### 导出处理

`_apply_all_edits` 尾部追加处理 `new_elements`：
- `type == "text"` → 根据 `font_weight` + `font_style` 选择变体文件（如 `Roboto-BoldItalic.ttf`），`page.insert_text()` 直接写入（无涂改）
- `type == "image"` → 通过 `image_id` 找临时文件 → `page.insert_image()` 插入
- 新元素在已有元素编辑之后再写入

### 字体管理

**字体目录结构** (`backend/localFont/`)：
```
Arimo/        → Regular, Bold, Italic, BoldItalic
Caladea/      → Regular, Bold, Italic, BoldItalic
Carlito/      → Regular, Bold, Italic, BoldItalic
Cousine/      → Regular, Bold, Italic, BoldItalic
Liberation_Serif/ → Regular, Bold, Italic, BoldItalic
Open_Sans/    → Regular, Bold, Italic, BoldItalic (+ Light, SemiBold, ExtraBold 等)
Roboto/       → Regular, Bold, Italic, BoldItalic (+ Thin, Light, Medium, Black 等)
Roboto_Mono/  → Regular, Bold, Italic (+ Light, Medium, Thin 等)
SimHei/       → Regular only (不支持粗体/斜体)
Tinos/        → Regular, Bold, Italic, BoldItalic
```

**`GET /api/pdf/fonts` 返回格式：**
```json
[
  {
    "family": "Roboto",
    "display_name": "Roboto",
    "variants": ["regular", "bold", "italic", "bolditalic"]
  },
  {
    "family": "SimHei",
    "display_name": "SimHei (黑体)",
    "variants": ["regular"]
  }
]
```

**前端逻辑：**
- 字体下拉绑定 `family`，显示 `display_name`
- 选中字体后检查 `variants`：
  - 含 `bold` → 粗体按钮启用，否则禁用
  - 含 `italic` → 斜体按钮启用，否则禁用
  - 含 `bolditalic` → 粗体+斜体同时启用时可组合

**后端字体选择逻辑：**
- `font_weight == "bold" && font_style == "italic"` → 优先 BoldItalic，无则 Bold
- `font_weight == "bold"` → Bold 文件
- `font_style == "italic"` → Italic 文件
- 默认 → Regular 文件

### 图片上传

- `upload_image` 接收 multipart 文件
- 存到临时目录 `{UPLOAD_DIR}/images/{file_id}_{uuid}.{ext}`
- 返回 `image_id`（文件名不含扩展名）
- 导出时通过 `image_id` 查找文件

## 文件变更清单

| 文件 | 改动 |
|------|------|
| `frontend/src/components/Toolbar.jsx` | 新建 — 操作栏组件 |
| `frontend/src/components/PageCanvas.jsx` | 改 — 选中事件回调 + addNewText/addImage 方法暴露 |
| `frontend/src/components/PDFViewer.jsx` | 改 — 集成 Toolbar + 选中状态管理 |
| `frontend/src/services/api.js` | 改 — 新增 uploadImage API |
| `backend/app/models/pdf.py` | 改 — 新增 NewElement 模型 |
| `backend/app/routers/pdf.py` | 改 — 新增 fonts 列表路由 + upload_image 路由 + export_all 支持 new_elements |
| `backend/app/services/pdf_service.py` | 改 — _apply_all_edits 追加 new_elements 处理 + 字体变体选择 |
