# PDF 文字编辑系统

一个 Web 应用，实现 PDF 文字的精确提取、可视化编辑和修改导出。类似 Figma 的双击编辑体验。

## 功能特性

- PDF 页面渲染为高清图片
- 文字精确坐标提取（逐词级别）
- DOM 覆盖层实现可编辑文字框
- 双击编辑 → 白框遮盖 → 写入新文字
- 原文件保护，始终生成新文件

## 技术栈

**后端**：FastAPI + PyMuPDF (fitz) + uv

**前端**：React 18 + Vite + Tailwind CSS

## 项目结构

```
edit-pdf/
├── backend/           # Python 后端
│   ├── app/
│   │   ├── main.py    # FastAPI 入口
│   │   ├── routers/   # API 路由
│   │   ├── services/  # PDF 处理核心
│   │   └── models/    # 数据模型
│   ├── uploads/       # 上传文件
│   ├── renders/       # 渲染图片
│   └── outputs/       # 导出 PDF
│
├── frontend/          # React 前端
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── utils/
│   └── public/
│
├── docs/              # 文档
│   └── design.md
│
├── openspec/          # OpenSpec 规范
│   └── changes/
│       └── 001-pdf-text-editor/
│           ├── proposal.md
│           ├── design.md
│           └── tasks.md
│
└── README.md
```

## 快速开始

### 后端

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

## API 文档

启动后端后访问：http://localhost:8000/docs

## 开发进度

详见 `openspec/changes/001-pdf-text-editor/tasks.md`

## License

MIT