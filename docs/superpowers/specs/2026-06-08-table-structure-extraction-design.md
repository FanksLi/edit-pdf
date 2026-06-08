# 表格结构提取设计

## 背景

当前 PDF 编辑器返回平铺数据：`paragraphs[]` + `drawings[]` + `images[]`。表格被拆成独立的矩形色块和文字段落，前端渲染时背景与文字错位。

## 目标

后端识别表格结构，返回 `tables[]` 字段，让前端按 table → row → cell 渲染，实现表格背景与文字对齐。

## 数据结构

```json
{
  "tables": [
    {
      "id": "table-0",
      "bbox": [x0, y0, x1, y1],
      "rows": [
        {
          "cells": [
            {
              "id": "cell-0-0",
              "rect": [x0, y0, x1, y1],
              "paragraph_ids": ["para-8"],
              "fill": [r, g, b],
              "stroke": null
            }
          ]
        }
      ]
    }
  ],
  "paragraphs": [
    {
      "id": "para-8",
      "text": "Employee Name",
      "bbox": [...],
      "tableId": "table-0",
      "cellId": "cell-0-0",
      ...
    }
  ],
  "drawings": [
    // 非表格 drawings 保持独立
  ],
  "images": []
}
```

**paragraphs 新增字段**：
- `id`：段落唯一标识
- `tableId`：所属表格（null 表示非表格）
- `cellId`：所属 cell（null 表示非表格）

**drawings 变化**：
- 属于表格的矩形不再独立返回（已聚合到 `tables[].rows[].cells[]`）
- 非表格 drawings 保持独立

## 算法：表格识别

### 输入

`drawings[]`（矩形色块列表）

### 步骤

1. **过滤**：宽高 >5pt，有 fill 或 stroke
2. **聚类**：
   - 计算所有矩形边界
   - 相邻矩形（水平/垂直间距 <10pt）归为同一候选表格
   - 用连通分量算法聚类
3. **网格化**：
   - 按 Y 坐标排序，阈值分组为 rows（间距 <5pt 视为同一行）
   - 按 X 坐标排序，阈值分组为 cols
   - 形成 row × col 网格
4. **校验**：
   - 矩形数量 ≥4（至少 2×2）
   - 行数 ≥2，列数 ≥2
   - 网格覆盖率 >80%（大部分网格位置有矩形）
5. **输出**：`tables[]` 结构

### 伪代码

```python
def _detect_tables(drawings):
    # 1. 过滤有效矩形
    rects = [d for d in drawings if d['rect'][2]-d['rect'][0] > 5 and d['rect'][3]-d['rect'][1] > 5]

    # 2. 聚类：相邻矩形归为同一表格
    groups = _cluster_adjacent_rects(rects, gap_threshold=10)

    tables = []
    for group in groups:
        # 3. 网格化
        rows = _group_by_y(group, y_threshold=5)
        cols = _group_by_x(group, x_threshold=5)

        # 4. 校验
        if len(rows) >= 2 and len(cols) >= 2 and len(group) >= 4:
            table = _build_table_structure(group, rows, cols)
            tables.append(table)

    return tables

def _cluster_adjacent_rects(rects, gap_threshold):
    # 用连通分量聚类：相邻矩形（间距 < threshold）连通
    # 返回独立表格候选组
    ...

def _build_table_structure(group, rows, cols):
    # 构建 rows × cells 结构
    # 每个 cell 包含 rect、fill、stroke、paragraph_ids
    ...
```

## 段落归属

对每个 `paragraph`，检测是否落在某个 `cell.rect` 内：

```python
def _assign_paragraphs_to_cells(paragraphs, tables):
    for para in paragraphs:
        px0, py0, px1, py1 = para['bbox']
        for table in tables:
            for row in table['rows']:
                for cell in row['cells']:
                    cx0, cy0, cx1, cy1 = cell['rect']
                    if cx0 <= px0 and cy0 <= py0 and cx1 >= px1 and cy1 >= py1:
                        para['tableId'] = table['id']
                        para['cellId'] = cell['id']
                        cell['paragraph_ids'].append(para['id'])
                        break
```

## API 变化

`GET /api/pdf/{file_id}/page/{page_num}/text` 返回：

```json
{
  "page_width": 595.27,
  "page_height": 841.88,
  "tables": [...],
  "paragraphs": [...],
  "drawings": [...],
  "images": []
}
```

## 前端渲染变化

### FabricCanvas.jsx

```javascript
// 优先渲染 tables
for (const table of content.tables || []) {
  for (const row of table.rows) {
    for (const cell of row.cells) {
      // 渲染 cell 背景
      const rect = new Rect({
        left: cell.rect[0] * SCALE,
        top: cell.rect[1] * SCALE,
        width: (cell.rect[2] - cell.rect[0]) * SCALE,
        height: (cell.rect[3] - cell.rect[1]) * SCALE,
        fill: cell.fill ? `rgb(...)` : null,
        ...
      });
      canvas.add(rect);

      // 渲染 cell 内 paragraphs
      for (const pid of cell.paragraph_ids) {
        const para = paragraphs.find(p => p.id === pid);
        _addParagraph(canvas, textLayer, para);
      }
    }
  }
}

// 渲染非表格 drawings
for (const d of content.drawings || []) {
  if (!d.tableId) _addDrawing(canvas, d);
}

// 渲染非表格 paragraphs
for (const para of paragraphs) {
  if (!para.tableId) _addParagraph(canvas, textLayer, para);
}
```

## 导出变化

表格整体移动时，遍历 `tables[]`，按 table bbox 计算偏移量，所有 cells 同步偏移。

cell 内文字编辑：只修改对应 paragraph，不影响表格结构。

## 实现文件

| 文件 | 改动 |
|------|------|
| `backend/app/services/pdf_service.py` | 新增 `_detect_tables()`、`_assign_paragraphs_to_cells()`，修改 `get_page_text()` |
| `frontend/src/components/FabricCanvas.jsx` | 新增表格渲染逻辑 |
| `frontend/src/components/PageCanvas.jsx` | 同步表格渲染逻辑 |

## 边界情况

- 跨行/跨列 cell：暂不支持，按单 cell 处理
- 无背景表格（只有边框线条）：stroke 作为 fill 渲染
- 复杂表格（嵌套、不规则）：fallback 到独立 drawings 渲染