---
name: pdf-text-editor-tasks
description: PDF 文字编辑系统实施任务清单
depends_on: design.md
---

# Tasks: PDF 文字编辑系统

## 模块划分

```
Phase 1: 后端基础模块 (BE-001 ~ BE-004)
Phase 2: 前端基础模块 (FE-001 ~ FE-004)
Phase 3: 编辑功能模块 (EDIT-001 ~ EDIT-003)
Phase 4: 导出与完善模块 (EXPORT-001 ~ EXPORT-002)
```

---

## Phase 1: 后端基础模块

### BE-001: 初始化后端项目结构
- 创建 backend/ 目录结构
- 初始化 uv 项目 (pyproject.toml, .python-version)
- 安装依赖：fastapi, uvicorn, pymupdf, python-multipart
- 创建 uploads/, renders/, outputs/ 目录
- 创建 app/__init__.py, app/main.py 基础文件

**验收标准**：
- [ ] uv run uvicorn app.main:app --reload 可启动
- [ ] 依赖安装成功，pymupdf 可正常导入

---

### BE-002: 实现 PDFService 核心类
- 创建 app/services/pdf_service.py
- 实现 PDFService 类：
  - `__init__(file_path)` - 加载 PDF，生成 file_id
  - `get_page_count()` - 返回页数
  - `get_page_size(page_num)` - 返回页面尺寸
  - `get_page_text(page_num)` - 提取文字 span 数据

**验收标准**：
- [ ] 可加载 PDF 文件
- [ ] get_page_text() 返回正确的 span 数据（含 bbox、fontSize、origin）
- [ ] 编写单元测试 test_pdf_service.py

---

### BE-003: 实现 PDFRenderer 模块
- 在 PDFService 中添加 `render_page(page_num, dpi=150)` 方法
- 使用 fitz.Matrix(zoom, zoom) 控制 DPI
- 保存 PNG 到 renders/ 目录
- 返回图片路径或 base64

**验收标准**：
- [ ] render_page(0, 150) 生成清晰 PNG
- [ ] 图片与 PDF 文字对齐
- [ ] 更新单元测试

---

### BE-004: 实现 API 路由
- 创建 app/routers/pdf.py
- 创建 app/models/pdf.py (Pydantic 模型)
- 实现以下接口：
  - POST `/api/pdf/upload` - 上传 PDF
  - GET `/api/pdf/{file_id}/page/{n}/text` - 获取文字数据
  - GET `/api/pdf/{file_id}/page/{n}/render` - 获取渲染图片

**验收标准**：
- [ ] 上传 PDF 成功，返回 file_id
- [ ] GET /text 返回正确的 span 数据
- [ ] GET /render 返回 PNG 图片
- [ ] FastAPI 自动生成 OpenAPI 文档

---

## Phase 2: 前端基础模块

### FE-001: 初始化前端项目结构
- 创建 frontend/ 目录
- 初始化 Vite + React 项目
- 安装并配置 Tailwind CSS
- 创建基础目录结构：components/, hooks/, services/, utils/

**验收标准**：
- [ ] npm run dev 可启动开发服务器
- [ ] Tailwind CSS 正常工作
- [ ] 基础路由/组件结构已建立

---

### FE-002: 实现坐标转换工具
- 创建 src/utils/coordinate.js
- 实现 `pdfToScreen(bbox, pageHeight, renderHeight)` 函数
- 实现 `screenToPdf(screenBox, pageHeight, renderHeight)` 函数

**验收标准**：
- [ ] PDF bbox 正确转换为屏幕坐标
- [ ] Y 轴翻转正确处理

---

### FE-003: 实现 API 调用封装
- 创建 src/services/api.js
- 封装所有后端 API 调用：
  - `uploadPDF(file)`
  - `getPageText(fileId, pageNum)`
  - `getPageRender(fileId, pageNum)`
  - `modifyPage(fileId, pageNum, edits)`
  - `exportPDF(fileId)`

**验收标准**：
- [ ] API 调用正确响应
- [ ] 错误处理完善

---

### FE-004: 实现 PDFViewer 和 TextBlock 组件
- 创建 src/components/PDFViewer.jsx - 主容器
- 创建 src/components/TextBlock.jsx - 单个文字块
- 创建 src/components/FileUpload.jsx - 文件上传

**验收标准**：
- [ ] PDFViewer 可显示 PDF 图片
- [ ] TextBlock 正确定位在文字上方
- [ ] hover 显示虚线边框
- [ ] 文字坐标与 PDF 图片对齐

---

## Phase 3: 编辑功能模块

### EDIT-001: 后端实现 PDFModifier
- 在 PDFService 中添加 `modify_page(page_num, edits)` 方法
- 实现 redact + insert_text 流程：
  1. `add_redact_annot(bbox, fill=(1,1,1))`
  2. `apply_redactions()` - 执行抹除
  3. `insert_text(origin, newText, fontname="helv")` - 写入新文字
  4. 重新渲染并提取文字数据

**验收标准**：
- [ ] modify_page() 正确抹除原文
- [ ] 新文字写入正确位置
- [ ] 返回更新后的图片和文字数据
- [ ] 原文件未被修改

---

### EDIT-002: 前端实现编辑交互
- TextBlock 组件添加编辑模式：
  - 双击进入编辑
  - input 组件替代 span
  - Enter 保存，Escape 取消
  - blur 保存
- 调用 modifyPage API
- 刷新显示

**验收标准**：
- [ ] 双击可进入编辑模式
- [ ] Enter/Escape 正确响应
- [ ] 编辑后显示更新

---

### EDIT-003: 实现撤销功能
- 保存编辑前的文字状态
- Ctrl+Z 或 Escape 取消编辑
- 可选：历史记录栈

**验收标准**：
- [ ] Escape 取消当前编辑，恢复原文
- [ ] Ctrl+Z 撤销上一次编辑（可选）

---

## Phase 4: 导出与完善模块

### EXPORT-001: 实现导出功能
- 后端：GET `/api/pdf/{file_id}/export` 接口
- PDFService.export_pdf() 方法
- 前端：Toolbar 添加导出按钮
- 下载触发

**验收标准**：
- [ ] 点击导出按钮可下载 PDF
- [ ] 导出的 PDF 包含所有修改
- [ ] 原始 PDF 未被修改

---

### EXPORT-002: 完善样式和体验
- Figma 风格编辑体验优化
- hover/active/focus 状态完善
- 加载状态提示
- 错误提示

**验收标准**：
- [ ] 编辑体验流畅
- [ ] 状态提示清晰
- [ ] 错误处理友好

---

## 任务依赖关系

```
BE-001 → BE-002 → BE-003 → BE-004
                      ↓
FE-001 → FE-002 → FE-003 → FE-004
                      ↓
           EDIT-001 (依赖 BE-004)
              ↓
           EDIT-002 (依赖 FE-004 + EDIT-001)
              ↓
           EDIT-003
              ↓
           EXPORT-001 → EXPORT-002
```

---

## 验收检查清单

### 功能验收
- [ ] 上传 PDF 并显示第一页
- [ ] 文字坐标精确对齐
- [ ] 双击编辑，Enter 保存，Escape 取消
- [ ] 导出修改后的 PDF
- [ ] 原文件保护

### 技术验收
- [ ] 后端单元测试通过
- [ ] 前端组件测试通过（可选）
- [ ] API 文档自动生成
- [ ] 错误处理完善