# 表格结构提取实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后端识别表格结构，返回 `tables[]` 字段，前端按 table → row → cell 渲染实现背景与文字对齐。

**Architecture:** 后端新增 `_detect_tables()` 用几何聚类识别表格网格，`_assign_paragraphs_to_cells()` 分配段落到 cell。前端 FabricCanvas/PageCanvas 新增表格渲染路径。

**Tech Stack:** Python (PyMuPDF), JavaScript (React + Fabric.js)

---

## 文件结构

| 文件 | 责任 |
|------|------|
| `backend/app/services/pdf_service.py` | 表格识别算法、段落归属、API 返回 |
| `frontend/src/components/FabricCanvas.jsx` | 表格渲染逻辑 |
| `frontend/src/components/PageCanvas.jsx` | 同步表格渲染逻辑 |

---

### Task 1: 后端表格识别算法

**Files:**
- Modify: `backend/app/services/pdf_service.py`

- [ ] **Step 1: 新增 `_is_adjacent()` 辅助函数**

在 `_detect_cell_alignment` 方法之前添加：

```python
def _is_adjacent(self, rect1, rect2, gap_threshold=10):
    """判断两个矩形是否相邻（水平或垂直间距 < threshold）"""
    x0a, y0a, x1a, y1a = rect1
    x0b, y0b, x1b, y1b = rect2

    # 水平相邻：Y 范围重叠，X 间距 < threshold
    y_overlap = max(0, min(y1a, y1b) - max(y0a, y0b))
    if y_overlap > 0:
        x_gap = min(abs(x1a - x0b), abs(x1b - x0a))
        if x_gap < gap_threshold:
            return True

    # 垂直相邻：X 范围重叠，Y 间距 < threshold
    x_overlap = max(0, min(x1a, x1b) - max(x0a, x0b))
    if x_overlap > 0:
        y_gap = min(abs(y1a - y0b), abs(y1b - y0a))
        if y_gap < gap_threshold:
            return True

    return False
```

- [ ] **Step 2: 新增 `_cluster_adjacent_rects()` 聚类函数**

```python
def _cluster_adjacent_rects(self, drawings, gap_threshold=10):
    """用连通分量聚类相邻矩形，返回独立表格候选组"""
    n = len(drawings)
    if n == 0:
        return []

    # 构建邻接矩阵
    adj = [[False] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            if self._is_adjacent(drawings[i]["rect"], drawings[j]["rect"], gap_threshold):
                adj[i][j] = adj[j][i] = True

    # DFS 找连通分量
    visited = [False] * n
    groups = []

    def dfs(node, group):
        visited[node] = True
        group.append(node)
        for neighbor in range(n):
            if adj[node][neighbor] and not visited[neighbor]:
                dfs(neighbor, group)

    for i in range(n):
        if not visited[i]:
            group = []
            dfs(i, group)
            groups.append([drawings[idx] for idx in group])

    return groups
```

- [ ] **Step 3: 新增 `_group_rows_cols()` 网格化函数**

```python
def _group_rows_cols(self, group, y_threshold=5, x_threshold=5):
    """将矩形组按 Y/X 坐标分组为 rows 和 cols"""
    rects = [d["rect"] for d in group]

    # 按 Y 坐标分 rows
    sorted_by_y = sorted(rects, key=lambda r: r[1])
    rows = []
    current_row = [sorted_by_y[0]]
    for r in sorted_by_y[1:]:
        if abs(r[1] - current_row[-1][1]) < y_threshold:
            current_row.append(r)
        else:
            rows.append(current_row)
            current_row = [r]
    rows.append(current_row)

    # 按 X 坐标分 cols
    sorted_by_x = sorted(rects, key=lambda r: r[0])
    cols = []
    current_col = [sorted_by_x[0]]
    for r in sorted_by_x[1:]:
        if abs(r[0] - current_col[-1][0]) < x_threshold:
            current_col.append(r)
        else:
            cols.append(current_col)
            current_col = [r]
    cols.append(current_col)

    return rows, cols
```

- [ ] **Step 4: 新增 `_build_table_structure()` 构建表格结构**

```python
def _build_table_structure(self, group, rows, cols, table_id):
    """构建表格 rows × cells 结构"""
    table_rows = []

    for row_idx, row_rects in enumerate(rows):
        cells = []
        # 按 X 排序当前行的矩形
        row_rects_sorted = sorted(row_rects, key=lambda r: r[0])

        for col_idx, rect in enumerate(row_rects_sorted):
            # 找对应的 drawing 数据
            drawing = next((d for d in group if d["rect"] == rect), None)
            if not drawing:
                continue

            cell_id = f"{table_id}-cell-{row_idx}-{col_idx}"
            cells.append({
                "id": cell_id,
                "rect": list(rect),
                "fill": drawing.get("fill"),
                "stroke": drawing.get("stroke"),
                "paragraph_ids": [],
            })

        if cells:
            table_rows.append({"cells": cells})

    # 计算表格整体 bbox
    all_rects = [d["rect"] for d in group]
    bbox = [
        min(r[0] for r in all_rects),
        min(r[1] for r in all_rects),
        max(r[2] for r in all_rects),
        max(r[3] for r in all_rects),
    ]

    return {
        "id": table_id,
        "bbox": bbox,
        "rows": table_rows,
    }
```

- [ ] **Step 5: 新增 `_detect_tables()` 主函数**

```python
def _detect_tables(self, drawings):
    """从 drawings 中识别表格结构"""
    # 过滤有效矩形
    valid_drawings = [
        d for d in drawings
        if d["rect"][2] - d["rect"][0] > 5 and d["rect"][3] - d["rect"][1] > 5
    ]

    if len(valid_drawings) < 4:
        return []

    # 聚类
    groups = self._cluster_adjacent_rects(valid_drawings, gap_threshold=10)

    tables = []
    for group_idx, group in enumerate(groups):
        # 校验：至少 4 个矩形
        if len(group) < 4:
            continue

        # 网格化
        rows, cols = self._group_rows_cols(group)

        # 校验：至少 2 行 2 列
        if len(rows) < 2 or len(cols) < 2:
            continue

        # 构建表格结构
        table_id = f"table-{group_idx}"
        table = self._build_table_structure(group, rows, cols, table_id)
        tables.append(table)

    return tables
```

- [ ] **Step 6: 新增 `_assign_paragraphs_to_cells()` 段落归属函数**

```python
def _assign_paragraphs_to_cells(self, paragraphs, tables):
    """将段落分配到对应的 cell"""
    # 给 paragraphs 添加 id
    for idx, para in enumerate(paragraphs):
        para["id"] = f"para-{idx}"
        para["tableId"] = None
        para["cellId"] = None

    # 遍历每个段落找所属 cell
    for para in paragraphs:
        px0, py0, px1, py1 = para["bbox"]

        for table in tables:
            for row in table["rows"]:
                for cell in row["cells"]:
                    cx0, cy0, cx1, cy1 = cell["rect"]
                    # 判断段落是否完全在 cell 内
                    if cx0 <= px0 and cy0 <= py0 and cx1 >= px1 and cy1 >= py1:
                        para["tableId"] = table["id"]
                        para["cellId"] = cell["id"]
                        cell["paragraph_ids"].append(para["id"])
                        break

    return paragraphs
```

- [ ] **Step 7: 修改 `get_page_text()` 返回 tables**

```python
def get_page_text(self, page_num: int) -> Dict[str, Any]:
    """提取页面文字和表格结构"""
    if page_num < 0 or page_num >= len(self.doc):
        raise ValueError(f"Page {page_num} out of range")

    page = self.doc[page_num]
    blocks = page.get_text("dict")["blocks"]
    paragraphs = self._gap_based_paragraphs(blocks)

    drawings = self.get_page_drawings(page_num)

    # 检测表格
    tables = self._detect_tables(drawings)

    # 分配段落到 cell
    paragraphs = self._assign_paragraphs_to_cells(paragraphs, tables)

    # 检测对齐方式（使用新的 cell 信息）
    paragraphs = self._detect_cell_alignment(paragraphs, drawings)

    # 过滤掉属于表格的 drawings
    table_rects = set()
    for table in tables:
        for row in table["rows"]:
            for cell in row["cells"]:
                table_rects.add(tuple(cell["rect"]))

    non_table_drawings = [
        d for d in drawings
        if tuple(d["rect"]) not in table_rects
    ]

    return {
        "tables": tables,
        "paragraphs": paragraphs,
        "drawings": non_table_drawings,
        "images": [],  # 保持兼容
    }
```

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/pdf_service.py
git commit -m "feat: add table structure detection in backend

- _detect_tables() clusters adjacent rectangles into tables
- _assign_paragraphs_to_cells() assigns paragraphs to cells
- get_page_text() returns tables[] structure
- filters out table drawings from standalone list

Co-Authored-By: astron-code-latest <noreply@anthropic.com>"
```

---

### Task 2: 前端 FabricCanvas 表格渲染

**Files:**
- Modify: `frontend/src/components/FabricCanvas.jsx`

- [ ] **Step 1: 新增 `_addTableCell()` 函数**

在 `_addParagraph` 函数之后添加：

```javascript
const _addTableCell = (canvas, textLayer, cell, SCALE) => {
  const [x0, y0, x1, y1] = cell.rect;
  const fill = cell.fill
    ? `rgba(${Math.round(cell.fill[0] * 255)},${Math.round(cell.fill[1] * 255)},${Math.round(cell.fill[2] * 255)},0.8)`
    : null;
  const stroke = cell.stroke
    ? `rgb(${Math.round(cell.stroke[0] * 255)},${Math.round(cell.stroke[1] * 255)},${Math.round(cell.stroke[2] * 255)})`
    : null;

  const rect = new Rect({
    left: x0 * SCALE,
    top: y0 * SCALE,
    width: (x1 - x0) * SCALE,
    height: (y1 - y0) * SCALE,
    fill,
    stroke,
    strokeWidth: stroke ? 1 : 0,
    originX: 'left',
    originY: 'top',
    selectable: false,
  });
  canvas.add(rect);
};
```

- [ ] **Step 2: 新增 `_renderTable()` 函数**

```javascript
const _renderTable = (canvas, textLayer, table, paragraphs, SCALE) => {
  for (const row of table.rows) {
    for (const cell of row.cells) {
      // 渲染 cell 背景
      _addTableCell(canvas, textLayer, cell, SCALE);

      // 渲染 cell 内 paragraphs
      for (const pid of cell.paragraph_ids) {
        const para = paragraphs.find(p => p.id === pid);
        if (para) {
          _addParagraph(canvas, textLayer, para);
        }
      }
    }
  }
};
```

- [ ] **Step 3: 修改 `loadElements()` 渲染顺序**

在 `loadElements` 函数内部，替换现有的 drawings/paragraphs 渲染逻辑：

```javascript
const loadElements = async () => {
  await document.fonts.ready;

  // 背景
  if (content.renderImageUrl && !hideBackground) {
    try {
      const bgImg = await FabricImage.fromURL(content.renderImageUrl);
      bgImg.set({
        left: 0, top: 0,
        originX: 'left', originY: 'top',
        scaleX: canvas.width / bgImg.width,
        scaleY: canvas.height / bgImg.height,
      });
      canvas.backgroundImage = bgImg;
    } catch (e) {
      console.error('Failed to load background:', e);
    }
  }

  const paragraphs = content.paragraphs || [];

  // 优先渲染 tables
  for (const table of (content.tables || [])) {
    _renderTable(canvas, textLayerRef.current, table, paragraphs, SCALE);
  }

  // 渲染非表格 drawings
  for (const d of (content.drawings || [])) {
    _addDrawing(canvas, d);
  }

  // 渲染非表格 paragraphs
  for (const para of paragraphs) {
    if (!para.tableId) {
      _addParagraph(canvas, textLayerRef.current, para);
    }
  }

  canvas.requestRenderAll();
};
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FabricCanvas.jsx
git commit -m "feat: add table rendering in FabricCanvas

- _addTableCell() renders cell background rectangle
- _renderTable() renders table structure with cells + paragraphs
- prioritizes table rendering before standalone drawings/paragraphs

Co-Authored-By: astron-code-latest <noreply@anthropic.com>"
```

---

### Task 3: 前端 PageCanvas 表格渲染同步

**Files:**
- Modify: `frontend/src/components/PageCanvas.jsx`

- [ ] **Step 1: 新增 `_addTableCell()` 函数**

```javascript
const _addTableCell = (canvas, cell, scale) => {
  const [x0, y0, x1, y1] = cell.rect;
  const fill = cell.fill
    ? `rgba(${Math.round(cell.fill[0] * 255)},${Math.round(cell.fill[1] * 255)},${Math.round(cell.fill[2] * 255)},0.8)`
    : null;
  const stroke = cell.stroke
    ? `rgb(${Math.round(cell.stroke[0] * 255)},${Math.round(cell.stroke[1] * 255)},${Math.round(cell.stroke[2] * 255)})`
    : null;

  const rect = new Rect({
    left: x0 * scale,
    top: y0 * scale,
    width: (x1 - x0) * scale,
    height: (y1 - y0) * scale,
    fill,
    stroke,
    strokeWidth: stroke ? 1 : 0,
    originX: 'left',
    originY: 'top',
    selectable: false,
  });
  canvas.add(rect);
};
```

- [ ] **Step 2: 修改 `loadElements()` 渲染逻辑**

```javascript
const loadElements = async () => {
  await document.fonts.ready;

  if (renderImageUrl && !hideBackground) {
    try {
      const bgImg = await FabricImage.fromURL(renderImageUrl);
      bgImg.set({
        left: 0, top: 0,
        originX: 'left', originY: 'top',
        scaleX: canvas.width / bgImg.width,
        scaleY: canvas.height / bgImg.height,
      });
      canvas.backgroundImage = bgImg;
    } catch (e) {
      console.error('Failed to load background:', e);
    }
  }

  const paragraphs = content.paragraphs || [];

  // 优先渲染 tables
  for (const table of (content.tables || [])) {
    for (const row of table.rows) {
      for (const cell of row.cells) {
        _addTableCell(canvas, cell, scale);
      }
    }
  }

  // 渲染非表格 drawings
  for (const d of (content.drawings || [])) {
    _addDrawing(canvas, d);
  }

  canvas.requestRenderAll();
};
```

- [ ] **Step 3: 修改 textElements 构建逻辑过滤表格段落**

在 `useEffect` 构建 textElements 时，过滤掉属于表格的段落：

```javascript
useEffect(() => {
  if (!loaded || !content) return;

  const paragraphs = content.paragraphs || [];
  const elements = paragraphs
    .filter(para => !para.tableId) // 只处理非表格段落
    .map((para, idx) => {
      const pos = pdfToCanvas(para.bbox, scale);
      const fontProps = resolvePdfFont(para.fontName);
      // ... 现有的构建逻辑
    });

  setTextElements(elements);
}, [loaded, content]);
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PageCanvas.jsx
git commit -m "feat: add table rendering in PageCanvas

- _addTableCell() renders cell background
- loadElements() prioritizes table rendering
- textElements filters out table paragraphs

Co-Authored-By: astron-code-latest <noreply@anthropic.com>"
```

---

### Task 4: 验证和测试

**Files:**
- None (manual verification)

- [ ] **Step 1: 启动后端服务**

```bash
cd backend && uvicorn app.main:app --reload
```

- [ ] **Step 2: 启动前端**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: 上传测试 PDF**

上传 `backend/tests/test_employment_contract_signed.pdf`，检查：
- 表格背景矩形与文字是否对齐
- 非表格 drawings 是否正常渲染
- 非 table 区域段落是否正常

- [ ] **Step 4: Commit 验证记录**

```bash
git commit --allow-empty -m "test: verify table rendering alignment

- table cell backgrounds align with text
- non-table drawings render independently
- non-table paragraphs unaffected

Co-Authored-By: astron-code-latest <noreply@anthropic.com>"
```