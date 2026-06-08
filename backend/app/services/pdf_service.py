"""PyMuPDF 核心封装 - PDF 处理服务"""

import fitz
import uuid
import base64
import io
import re
import os
from pathlib import Path
from typing import List, Dict, Any, Optional

from app.config import RENDER_DIR, OUTPUT_DIR, IMAGE_DIR, LOCAL_FONT_DIR
from app.services.font_manager import FontManager



class PDFService:
    """PDF 处理服务类"""

    def __init__(self, file_path: str):
        self.doc = fitz.open(file_path)
        self.file_id = uuid.uuid4().hex
        self.font_mgr = FontManager(local_font_dir=LOCAL_FONT_DIR)
        self.page_sizes: List[tuple] = []
        for page in self.doc:
            self.page_sizes.append((page.rect.width, page.rect.height))

    def get_page_count(self) -> int:
        """获取总页数"""
        return len(self.doc)

    def get_page_size(self, page_num: int) -> tuple:
        """获取指定页面尺寸 (width, height)"""
        if page_num < 0 or page_num >= len(self.page_sizes):
            raise ValueError(f"Page {page_num} out of range")
        return self.page_sizes[page_num]

    def _extract_spans(self, page) -> List[Dict[str, Any]]:
        """提取页面所有 span（内部方法）"""
        blocks = page.get_text("dict")["blocks"]
        spans = []

        for block in blocks:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    color_int = span.get("color", 0)
                    r = (color_int >> 16) & 0xFF
                    g = (color_int >> 8) & 0xFF
                    b = color_int & 0xFF

                    spans.append({
                        "text": span["text"],
                        "bbox": list(span["bbox"]),
                        "fontSize": span["size"],
                        "fontName": span["font"],
                        "color": [r/255, g/255, b/255],
                        "origin": list(span.get("origin", [span["bbox"][0], span["bbox"][3]])),
                    })
        return spans

    def _dominant_font_size(self, spans: list) -> float:
        """取一行中多数 span 的字号（忽略行内少量特殊标记）"""
        if not spans:
            return 10
        from collections import Counter
        # 按 0.5pt 精度四舍五入后统计
        sizes = [round(s["size"] * 2) / 2 for s in spans]
        counts = Counter(sizes)
        return counts.most_common(1)[0][0]

    def _gap_based_paragraphs(self, blocks: list) -> List[Dict[str, Any]]:
        """行距聚类 + 字号段落检测

        断开信号：
        1. 行距跳变：当前 gap 明显大于段内参考间距
        2. 字号突变：相邻行字号差 > 2pt

        同行距 + 同字号 + 连续 → 合为一段
        行内不同字体字号不影响（整行为一个单位）
        """
        # Step 1: 打平所有行为统一的行列表
        flat_lines = []
        for block_idx, block in enumerate(blocks):
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                spans = sorted(line["spans"], key=lambda s: s["bbox"][0])
                if not spans:
                    continue
                first = spans[0]
                color_int = first.get("color", 0)
                flat_lines.append({
                    "text": "".join(s["text"] for s in spans).strip(),
                    "y0": first["bbox"][1],
                    "fontSize": self._dominant_font_size(spans),
                    "fontName": first["font"],
                    "color": [
                        ((color_int >> 16) & 0xFF) / 255,
                        ((color_int >> 8) & 0xFF) / 255,
                        (color_int & 0xFF) / 255,
                    ],
                    "spans_bboxes": [s["bbox"] for s in spans],
                    "block_idx": block_idx,
                    "x0": spans[0]["bbox"][0],
                    "x1": spans[-1]["bbox"][2],
                })

        if not flat_lines:
            return []

        flat_lines.sort(key=lambda l: (l["y0"], l["spans_bboxes"][0][0]))

        if len(flat_lines) == 1:
            return self._build_paragraph_result([flat_lines])

        # Step 2: 计算所有相邻行间距
        gaps = []
        for i in range(1, len(flat_lines)):
            gaps.append(flat_lines[i]["y0"] - flat_lines[i - 1]["y0"])

        # Step 3: 局部行距跳变检测
        # 核心思路：跟踪"当前段落的参考间距"，如果 gap 跳变到更大值 → 断点
        # 参考间距 = 当前段落内最近的"正常"间距
        breaks = [False] * len(gaps)

        # 用页面中最常见的间距作为"正常行距"的初始参考
        normal_gaps = [g for g in gaps if g >= flat_lines[0]["fontSize"] * 0.5]
        if normal_gaps:
            sorted_normal = sorted(normal_gaps)
            base_gap = sorted_normal[len(sorted_normal) // 2]
        else:
            base_gap = flat_lines[0]["fontSize"] * 1.2

        # 当前段落的参考间距（随段落内行距动态更新）
        current_ref = base_gap

        for i in range(len(gaps)):
            gap = gaps[i]
            prev_line = flat_lines[i]
            curr_line = flat_lines[i + 1]

            # 信号 0: 水平不重叠 — 当前行与前一行无 x 轴交集（左或右均可）
            no_horizontal_overlap = (curr_line["x0"] >= prev_line["x1"]
                                     or curr_line["x1"] <= prev_line["x0"])

            # 信号 1: 字号突变（>10% 或 >1.5pt，取较小值）
            fs_diff = abs(curr_line["fontSize"] - prev_line["fontSize"])
            font_size_changed = fs_diff > min(prev_line["fontSize"] * 0.1, 1.5)

            # 跳过异常小 gap（标题内部重叠等）
            if gap < flat_lines[i]["fontSize"] * 0.5:
                if font_size_changed or no_horizontal_overlap:
                    breaks[i] = True
                    current_ref = base_gap
                continue

            # 信号 2: 行距跳变
            # gap > ref × 1.3 且 gap - ref > 字号 × 0.5
            relative_jump = gap / current_ref if current_ref > 0 else 1
            absolute_jump = gap - current_ref
            min_abs_jump = flat_lines[i]["fontSize"] * 0.5
            gap_jumped = relative_jump > 1.3 and absolute_jump > min_abs_jump

            if gap_jumped or font_size_changed or no_horizontal_overlap:
                breaks[i] = True
                # 断开后重置参考间距
                current_ref = base_gap
            else:
                # 没断开 → 更新参考间距为当前 gap（跟踪段内行距变化）
                current_ref = gap

        # Step 4: 按断点分组
        para_groups = []
        current = [flat_lines[0]]

        for i in range(len(breaks)):
            if breaks[i]:
                para_groups.append(current)
                current = [flat_lines[i + 1]]
            else:
                current.append(flat_lines[i + 1])

        para_groups.append(current)

        return self._build_paragraph_result(para_groups)

    def _build_paragraph_result(self, para_groups: list) -> List[Dict[str, Any]]:
        """从分组构建段落数据，lineHeight 用组内实际间距，z_index 用原始 block 顺序"""
        all_gaps = []
        for group in para_groups:
            for i in range(1, len(group)):
                all_gaps.append(group[i]["y0"] - group[i - 1]["y0"])
        global_median = sorted(all_gaps)[len(all_gaps) // 2] if all_gaps else 12

        result = []
        for group in para_groups:
            text = "\n".join(l["text"].rstrip() for l in group).strip()

            all_bb = [bb for l in group for bb in l["spans_bboxes"]]
            x0 = min(b[0] for b in all_bb)
            y0 = min(b[1] for b in all_bb)
            x1 = max(b[2] for b in all_bb)
            y1 = max(b[3] for b in all_bb)

            rep = group[0]

            # lineHeight: 优先用组内实际间距，fallback 到全局 median
            if len(group) >= 2:
                group_gaps = [group[i]["y0"] - group[i - 1]["y0"] for i in range(1, len(group))]
                lh = sorted(group_gaps)[len(group_gaps) // 2]
            else:
                lh = global_median

            # z_index: 用组内第一行所在原始 block 的索引
            z_index = min(l.get("block_idx", 0) for l in group)

            result.append({
                "text": text,
                "bbox": [x0, y0, x1, y1],
                "fontSize": rep["fontSize"],
                "fontName": rep["fontName"],
                "color": rep["color"],
                "lineHeight": lh,
                "z_index": z_index,
            })

        return result

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

    def _detect_tables(self, drawings):
        """从 drawings 中识别表格结构

        支持两种表格类型：
        1. 填充矩形组成的表格（多个带 fill 的矩形）
        2. 线条绘制的表格（用 stroke 线条围成的区域）
        """
        # 分离填充矩形和线条
        filled_rects = []
        lines = []

        for d in drawings:
            rect = d["rect"]
            # rect 可能是列表 [x0, y0, x1, y1] 或 fitz.Rect
            if isinstance(rect, (list, tuple)):
                x0, y0, x1, y1 = rect
            else:
                x0, y0, x1, y1 = rect.x0, rect.y0, rect.x1, rect.y1
            w, h = x1 - x0, y1 - y0

            # 填充矩形
            if d.get("fill"):
                if w > 5 and h > 5:
                    filled_rects.append(d)
            # 线条（宽度或高度很小的矩形）
            elif d.get("stroke"):
                # 水平线（高度很小）
                if w > 10 and h < 2:
                    lines.append({**d, "type": "h_line", "y": (y0 + y1) / 2})
                # 垂直线（宽度很小）
                elif h > 10 and w < 2:
                    lines.append({**d, "type": "v_line", "x": (x0 + x1) / 2})

        tables = []

        # 方式1: 用填充矩形检测表格
        if len(filled_rects) >= 2:
            groups = self._cluster_adjacent_rects(filled_rects, gap_threshold=10)
            for group_idx, group in enumerate(groups):
                if len(group) < 2:
                    continue

                rows, cols = self._group_rows_cols(group)
                if len(rows) >= 1 and len(cols) >= 1:
                    table_id = f"table-{group_idx}"
                    table = self._build_table_structure(group, rows, cols, table_id)
                    tables.append(table)

        # 方式2: 用线条检测表格（至少2条水平线+2条垂直线形成密集网格）
        h_lines = sorted([l for l in lines if l["type"] == "h_line"], key=lambda l: l["y"])
        v_lines = sorted([l for l in lines if l["type"] == "v_line"], key=lambda l: l["x"])

        if len(h_lines) >= 2 and len(v_lines) >= 2:
            # 找出形成密集网格的线条组（垂直线间距相近）
            table_bounds = self._detect_line_table_bounds(h_lines, v_lines)
            for bounds in table_bounds:
                table = self._build_table_from_lines(bounds, h_lines, v_lines, filled_rects, f"table-line-{len(tables)}")
                if table:
                    tables.append(table)

        return tables

    def _detect_line_table_bounds(self, h_lines, v_lines):
        """检测线条形成的表格边界

        只检测垂直线间距相近的区域（表格的列间距应该是均匀的）
        """
        bounds = []

        # 按Y坐标分组水平线，找密集区域
        h_groups = []
        current_group = [h_lines[0]]
        for l in h_lines[1:]:
            if abs(l["y"] - current_group[-1]["y"]) < 50:  # 同一表格内的行间距不超过50
                current_group.append(l)
            else:
                if len(current_group) >= 2:
                    h_groups.append(current_group)
                current_group = [l]
        if len(current_group) >= 2:
            h_groups.append(current_group)

        # 对每个水平线组，找对应的垂直线
        for h_group in h_groups:
            y0 = min(l["rect"][1] for l in h_group)
            y1 = max(l["rect"][3] for l in h_group)

            # 找出跨越这个Y范围的垂直线
            matched_v = []
            for v in v_lines:
                v_y0, v_y1 = v["rect"][1], v["rect"][3]
                # 垂直线应该覆盖整个Y范围
                if v_y0 <= y0 + 5 and v_y1 >= y1 - 5:
                    matched_v.append(v)

            if len(matched_v) >= 2:
                x0 = min(l["rect"][0] for l in matched_v)
                x1 = max(l["rect"][2] for l in matched_v)
                bounds.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1, "h_lines": h_group, "v_lines": matched_v})

        return bounds

    def _build_table_from_lines(self, bounds, h_lines, v_lines, filled_rects, table_id):
        """从线条和填充矩形构建表格结构"""
        x0, y0, x1, y1 = bounds["x0"], bounds["y0"], bounds["x1"], bounds["y1"]

        # 使用 bounds 中已筛选的线条
        h_in_bounds = bounds.get("h_lines", h_lines)
        v_in_bounds = bounds.get("v_lines", v_lines)

        # 找出表格内的水平线（y坐标）
        row_ys = sorted(set(l["y"] for l in h_in_bounds))
        # 找出表格内的垂直线（x坐标）
        col_xs = sorted(set(l["x"] for l in v_in_bounds))

        if len(row_ys) < 1 or len(col_xs) < 1:
            return None

        # 添加边界
        all_ys = [y0] + row_ys + [y1]
        all_xs = [x0] + col_xs + [x1]

        rows = []
        for row_idx in range(len(all_ys) - 1):
            cells = []
            for col_idx in range(len(all_xs) - 1):
                cell_x0, cell_y0 = all_xs[col_idx], all_ys[row_idx]
                cell_x1, cell_y1 = all_xs[col_idx + 1], all_ys[row_idx + 1]

                # 查找该单元格的填充颜色
                cell_fill = None
                for fr in filled_rects:
                    fr_rect = fr["rect"]
                    if isinstance(fr_rect, (list, tuple)):
                        fr_x0, fr_y0, fr_x1, fr_y1 = fr_rect
                    else:
                        fr_x0, fr_y0, fr_x1, fr_y1 = fr_rect.x0, fr_rect.y0, fr_rect.x1, fr_rect.y1
                    if (fr_x0 <= cell_x0 + 1 and fr_y0 <= cell_y0 + 1 and
                        fr_x1 >= cell_x1 - 1 and fr_y1 >= cell_y1 - 1):
                        cell_fill = fr.get("fill")
                        break

                cell_id = f"{table_id}-cell-{row_idx}-{col_idx}"
                cells.append({
                    "id": cell_id,
                    "rect": [cell_x0, cell_y0, cell_x1, cell_y1],
                    "fill": cell_fill,
                    "stroke": None,
                    "paragraph_ids": [],
                })

            if cells:
                rows.append({"cells": cells})

        if not rows:
            return None

        return {
            "id": table_id,
            "bbox": [x0, y0, x1, y1],
            "rows": rows,
        }

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

    def _detect_cell_alignment(self, paragraphs: list, drawings: list) -> list:
        """检测段落文字在表格 cell 中的对齐方式。

        对每个段落，找到包含它的最小绘图矩形（cell 边界），
        根据 text 相对 cell 的位置判断 left/center/right。
        """
        cell_rects = []
        for d in drawings:
            r = d["rect"]
            w, h = r[2] - r[0], r[3] - r[1]
            if w < 5 or h < 5:
                continue
            cell_rects.append(r)

        for para in paragraphs:
            px0, py0, px1, py1 = para["bbox"]
            pw = px1 - px0
            ph = py1 - py0

            best_cell = None
            best_area = float('inf')

            for cr in cell_rects:
                cx0, cy0, cx1, cy1 = cr
                if cx0 <= px0 and cy0 <= py0 and cx1 >= px1 and cy1 >= py1:
                    area = (cx1 - cx0) * (cy1 - cy0)
                    if area < best_area:
                        best_area = area
                        best_cell = cr

            if best_cell:
                cx0, cy0, cx1, cy1 = best_cell
                cw = cx1 - cx0
                margin = para["fontSize"] * 1.0

                text_center = px0 + pw / 2
                cell_center = cx0 + cw / 2

                if abs(text_center - cell_center) < margin and pw < cw * 0.9:
                    para["textAlign"] = "center"
                elif abs(px1 - cx1) < margin and pw < cw * 0.9:
                    para["textAlign"] = "right"
                else:
                    para["textAlign"] = "left"
            else:
                para["textAlign"] = "left"

        return paragraphs

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

        # 过滤掉属于表格的填充矩形（单元格背景），但保留线条
        table_fill_rects = set()
        for table in tables:
            for row in table["rows"]:
                for cell in row["cells"]:
                    table_fill_rects.add(tuple(cell["rect"]))

        non_table_drawings = [
            d for d in drawings
            # 保留所有线条（有 stroke 没有 fill 的元素）
            if (d.get("stroke") and not d.get("fill")) or
               # 只过滤掉表格填充矩形
               (d.get("fill") and tuple(d["rect"]) not in table_fill_rects)
        ]

        return {
            "tables": tables,
            "paragraphs": paragraphs,
            "drawings": non_table_drawings,
            "images": [],  # 保持兼容
        }

    def get_page_drawings(self, page_num: int) -> List[Dict[str, Any]]:
        """提取页面绘图元素（矩形、线条等），带 z_index

        z_index 基于内容流 xref 顺序：
        找到绘图所在的内容流 xref 位置，
        统计该位置之前所有内容流产生的 text/image block 数量。
        """
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        drawings = page.get_drawings()

        if not drawings:
            return []

        import re

        content_xrefs = page.get_contents()
        if not content_xrefs:
            return []

        # 获取 text/image blocks 总数作为最大 z_index
        blocks = page.get_text("dict")["blocks"]
        total_blocks = len(blocks)

        # 统计每个内容流 xref 产生的 block 数量
        xref_block_count = {}

        # 找出主要的 text xref（BT 最多的那个）
        text_xref = None
        max_bt = 0
        other_text_xrefs = []
        for xref in content_xrefs:
            stream = self.doc.xref_stream(xref)
            if not stream:
                continue
            bt_count = len(re.findall(rb'(?<=\s)BT(?=\s)', stream))
            if bt_count > 0:
                if bt_count > max_bt:
                    if text_xref and text_xref not in other_text_xrefs:
                        other_text_xrefs.append(text_xref)
                    text_xref = xref
                    max_bt = bt_count
                else:
                    other_text_xrefs.append(xref)

        # 主 text xref 产生的 block 数 = 总 text blocks - 其他 text xref 的 block 数
        text_block_count = sum(1 for b in blocks if b["type"] == 0)
        if text_xref:
            xref_block_count[text_xref] = max(text_block_count - len(other_text_xrefs), 0)
        # 每个 Do xref 产生 1 个 image block
        for xref in content_xrefs:
            stream = self.doc.xref_stream(xref)
            if not stream:
                continue
            do_count = len(re.findall(rb'(?<=\s)Do(?=\s)', stream))
            if do_count > 0:
                xref_block_count[xref] = do_count
        # 其他 text xref 各产生 1 个 block
        for xref in other_text_xrefs:
            xref_block_count[xref] = 1

        # 找到包含 re 操作符的内容流 xref
        drawing_xrefs = []
        for xref in content_xrefs:
            stream = self.doc.xref_stream(xref)
            if not stream:
                continue
            re_count = len(re.findall(rb'(?<=\s)re(?=\s)', stream))
            for _ in range(re_count):
                drawing_xrefs.append(xref)

        # 累计：色块 xref 之前的所有 block 数量
        xref_to_cumulative = {}
        running = 0
        for xref in content_xrefs:
            xref_to_cumulative[xref] = running
            running += xref_block_count.get(xref, 0)

        result = []
        for idx, d in enumerate(drawings):
            rect = d["rect"]
            # 保留线条（宽度或高度为0但有stroke的元素）
            # 注意：PyMuPDF 中线条的 is_empty 返回 True，但我们需要保留它们
            is_line = rect.width < 1 or rect.height < 1

            fill = d.get("fill")
            stroke = d.get("color")

            # 跳过既没有填充也没有边框的元素
            if not fill and not stroke:
                continue

            # 非线条元素需要最小尺寸
            if not is_line and (rect.width < 0.5 or rect.height < 0.5):
                continue

            if idx < len(drawing_xrefs):
                draw_xref = drawing_xrefs[idx]
                z_index = xref_to_cumulative.get(draw_xref, 0)
            else:
                z_index = 0

            fill_tuple = tuple(fill) if fill else None
            stroke_tuple = tuple(stroke) if stroke else None

            result.append({
                "rect": [rect.x0, rect.y0, rect.x1, rect.y1],
                "fill": fill_tuple,
                "stroke": stroke_tuple,
                "z_index": z_index,
            })

        return result

    def render_page(self, page_num: int, dpi: int = 150) -> str:
        """渲染页面为 PNG，返回 base64 编码"""
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        zoom = dpi / 72  # 72 是 PDF 的默认 DPI
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)

        # 返回 base64 编码
        img_bytes = pix.tobytes("png")
        return base64.b64encode(img_bytes).decode("utf-8")

    def render_page_to_file(self, page_num: int, dpi: int = 150) -> str:
        """渲染页面为 PNG 文件，返回文件路径"""
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        zoom = dpi / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)

        output_path = RENDER_DIR / f"{self.file_id}_page_{page_num}.png"
        pix.save(str(output_path))
        return str(output_path)

    def get_render_size(self, page_num: int, dpi: int = 150) -> tuple:
        """获取渲染后图片尺寸 (width, height)"""
        width, height = self.get_page_size(page_num)
        zoom = dpi / 72
        return (int(width * zoom), int(height * zoom))

    def _collect_smask_xrefs(self, page) -> set:
        """收集当前页面所有图片引用的 SMask xref（遮罩图片，不应单独显示）"""
        smask_xrefs = set()
        for item in page.get_image_info(xrefs=True):
            xref = item.get("xref", 0)
            if not xref:
                continue
            try:
                obj_str = self.doc.xref_object(xref)
                match = re.search(r'/SMask\s+(\d+)\s+0\s+R', obj_str)
                if match:
                    smask_xrefs.add(int(match.group(1)))
            except Exception:
                continue
        return smask_xrefs

    def _get_smask_xref(self, xref: int) -> Optional[int]:
        """获取图片的 SMask xref，无则返回 None"""
        try:
            obj_str = self.doc.xref_object(xref)
            match = re.search(r'/SMask\s+(\d+)\s+0\s+R', obj_str)
            if match:
                return int(match.group(1))
        except Exception:
            pass
        return None

    def _apply_smask(self, pix, smask_xref: int, page, bbox) -> 'fitz.Pixmap':
        """将 SMask 遮罩合成到图片的 alpha 通道"""
        try:
            mask_pix = fitz.Pixmap(self.doc, smask_xref)
        except Exception:
            return pix

        w, h = pix.width, pix.height

        # 尺寸不匹配时，用页面渲染方式回退（正确处理缩放遮罩）
        if mask_pix.width != w or mask_pix.height != h:
            rect = fitz.Rect(bbox)
            if not rect.is_empty and rect.width >= 1 and rect.height >= 1:
                zoom = 150 / 72
                mat = fitz.Matrix(zoom, zoom)
                return page.get_pixmap(matrix=mat, clip=rect, alpha=True)
            return pix

        # 色彩通道数（不含 alpha）
        color_n = pix.n - pix.alpha
        total = w * h
        samples = pix.samples
        mask_samples = mask_pix.samples
        mn = mask_pix.n

        # 构建 RGBA 字节数组
        rgba = bytearray(total * 4)
        for i in range(total):
            src = i * pix.n
            dst = i * 4

            if color_n == 1:  # 灰度 → RGB
                g = samples[src]
                rgba[dst] = g
                rgba[dst + 1] = g
                rgba[dst + 2] = g
            else:  # RGB 或已有 alpha 的 RGBA
                rgba[dst] = samples[src]
                rgba[dst + 1] = samples[src + 1]
                rgba[dst + 2] = samples[src + 2]

            # alpha 取自遮罩的第一个通道
            rgba[dst + 3] = mask_samples[i * mn]

        return fitz.Pixmap(fitz.csRGB, w, h, bytes(rgba), 1)

    def get_page_images(self, page_num: int) -> List[Dict[str, Any]]:
        """提取页面中的图片块（正确处理色彩空间和 SMask 遮罩透明度）"""
        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        images = []
        seen_xrefs = set()

        # 收集所有 SMask xref，跳过它们
        smask_xrefs = self._collect_smask_xrefs(page)

        # 构建图片 bbox → z_index 映射（基于 get_text dict 中的 block 顺序）
        blocks = page.get_text("dict")["blocks"]
        img_bbox_to_zindex = {}
        for idx, block in enumerate(blocks):
            if block["type"] == 1:
                bbox = tuple(round(v, 1) for v in block["bbox"])
                img_bbox_to_zindex[bbox] = idx

        image_list = page.get_image_info(xrefs=True)
        for item in image_list:
            xref = item.get("xref", 0)
            if not xref or xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)

            # 跳过 SMask 遮罩图片
            if xref in smask_xrefs:
                continue

            try:
                bbox = list(item.get("bbox", [0, 0, 0, 0]))
                rect = fitz.Rect(bbox)

                # 跳过无效区域
                if rect.is_empty or rect.width < 1 or rect.height < 1:
                    continue

                pix = fitz.Pixmap(self.doc, xref)

                # CMYK 等色彩空间 → RGB
                if pix.colorspace and pix.colorspace.n > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)

                # 如果图片没有 alpha 且存在 SMask，手动合成遮罩
                if not pix.alpha:
                    smask_xref = self._get_smask_xref(xref)
                    if smask_xref is not None:
                        pix = self._apply_smask(pix, smask_xref, page, bbox)

                # 保存为 PNG（保留 alpha 通道）
                filename = f"{self.file_id}_img_{xref}.png"
                filepath = RENDER_DIR / filename
                pix.save(str(filepath))

                # 用 bbox 匹配 z_index
                bbox_key = tuple(round(v, 1) for v in bbox)
                z_index = img_bbox_to_zindex.get(bbox_key, 0)

                images.append({
                    "xref": xref,
                    "bbox": bbox,
                    "width": pix.width,
                    "height": pix.height,
                    "image_url": f"/renders/{filename}",
                    "z_index": z_index,
                })
            except Exception:
                continue
            finally:
                try:
                    pix = None
                except Exception:
                    pass

        return images

    def _detect_bg_color(self, page, bbox) -> tuple:
        """采样 bbox 四角外侧像素，自动检测背景色

        策略：取最亮的采样点作为背景色（文字抗锯齿像素偏暗，不影响结果），
        再用白色吸附消除微弱色偏。
        """
        margin_x = 20
        margin_y = 10

        expanded = fitz.Rect(
            max(0, bbox.x0 - margin_x),
            max(0, bbox.y0 - margin_y),
            min(page.rect.width, bbox.x1 + margin_x),
            min(page.rect.height, bbox.y1 + margin_y),
        )

        pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), clip=expanded, alpha=False)
        w, h = pix.width, pix.height

        bx0 = int(bbox.x0 - expanded.x0)
        by0 = int(bbox.y0 - expanded.y0)
        bx1 = int(bbox.x1 - expanded.x0)
        by1 = int(bbox.y1 - expanded.y0)

        colors = []
        corners = [
            (max(0, bx0 - margin_x), max(0, by0 - margin_y)),
            (min(w - 1, bx1 + min(10, margin_x)), max(0, by0 - margin_y)),
            (max(0, bx0 - margin_x), min(h - 1, by1 + margin_y)),
            (min(w - 1, bx1 + min(10, margin_x)), min(h - 1, by1 + margin_y)),
            (bx0 + (bx1 - bx0) // 2, max(0, by0 - margin_y)),
            (bx0 + (bx1 - bx0) // 2, min(h - 1, by1 + margin_y)),
        ]

        for cx, cy in corners:
            if 0 <= cx < w and 0 <= cy < h:
                idx = (cy * w + cx) * 3
                colors.append((pix.samples[idx], pix.samples[idx + 1], pix.samples[idx + 2]))

        if not colors:
            return (1, 1, 1)

        # 取最亮采样点（最接近真实背景色，文字抗锯齿像素偏暗会被排除）
        brightest = max(colors, key=lambda c: c[0] + c[1] + c[2])
        r = brightest[0] / 255
        g = brightest[1] / 255
        b = brightest[2] / 255

        # 白色吸附：近白色或低饱和度高亮度 → 纯白
        avg = (r + g + b) / 3
        spread = max(r, g, b) - min(r, g, b)
        if avg > 0.82 and spread < 0.12:
            return (1, 1, 1)

        return (r, g, b)

    def _extract_image_rgba(self, page, xref: int, bbox) -> bytes:
        """提取图片为 RGBA PNG bytes（保留 SMask 透明度）"""
        pix = fitz.Pixmap(self.doc, xref)
        # CMYK → RGB
        if pix.colorspace and pix.colorspace.n > 3:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        # 如果没有 alpha 且存在 SMask，手动合成
        if not pix.alpha:
            smask_xref = self._get_smask_xref(xref)
            if smask_xref is not None:
                pix = self._apply_smask(pix, smask_xref, page, bbox)
        return pix.tobytes("png")

    def _apply_all_edits(self, page, doc, paragraph_edits, image_edits, drawing_edits):
        """所有编辑操作的核心方法 — 保存→清除→重绘（Save-Redact-Restore）。

        核心思路：不再尝试精准手术式编辑内容流，而是：
        1. 保存所有受影响区域内的"旁观者"文字
        2. 对编辑区域整块清除（add_redact_annot）
        3. 执行 redaction
        4. 恢复旁观者文字 + 插入编辑后的内容
        """
        # 1. 提取当前内容
        current_spans = self._extract_spans(page)
        current_images_info = [
            item for item in page.get_image_info(xrefs=True)
            if item.get("xref", 0) > 0
        ]

        # 2. 预提取图片数据（redaction 之前，保留原始格式避免膨胀）
        image_rgba_cache = {}
        for img_info in current_images_info:
            xref = img_info.get("xref", 0)
            if not xref:
                continue
            try:
                # 优先用 extract_image 保留原始格式（JPEG 存 JPEG，不转 PNG）
                has_alpha = False
                smask_xref = self._get_smask_xref(xref)
                if smask_xref is not None:
                    has_alpha = True

                if not has_alpha:
                    img_data = doc.extract_image(xref)
                    if img_data and img_data.get("image"):
                        image_rgba_cache[xref] = img_data["image"]
                        continue

                # 有 alpha 或 extract_image 失败：用 Pixmap 渲染为 PNG
                bbox = img_info.get("bbox", [0, 0, 0, 0])
                pix = fitz.Pixmap(doc, xref)
                if pix.colorspace and pix.colorspace.n > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                if not pix.alpha and smask_xref is not None:
                    pix = self._apply_smask(pix, smask_xref, page, bbox)
                image_rgba_cache[xref] = pix.tobytes("png")
            except Exception:
                pass

        # 3. 注册系统字体（FontManager 用 insert_text fontfile 方案，无需预注册）

        # 4. 绘图路径删除（必须在段落 redaction 之前！）
        # 原因：_detect_bg_color 采样像素时，如果色块还在内容流中，
        # 会返回色块颜色作为"背景色"，导致 redaction 用色块颜色填充。
        moved_drawings = []
        for draw_edit in drawing_edits:
            try:
                old_bbox = fitz.Rect(draw_edit["old_bbox"])
                new_bbox = draw_edit.get("new_bbox")
                fill = draw_edit.get("fill")
                stroke = draw_edit.get("stroke")
                if new_bbox:
                    moved_drawings.append({"new_bbox": new_bbox, "fill": fill, "stroke": stroke})

                page_h = page.rect.height
                target_x = old_bbox.x0
                target_y = page_h - old_bbox.y1
                target_w = old_bbox.x1 - old_bbox.x0
                target_h = old_bbox.y1 - old_bbox.y0
                tolerance = 1.0

                for xref in page.get_contents():
                    stream_bytes = doc.xref_stream(xref)
                    if not stream_bytes:
                        continue
                    text = stream_bytes.decode('latin-1')
                    orig_len = len(text)

                    for rm in re.finditer(
                        r'(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+re', text
                    ):
                        bx, by, bw, bh = (float(rm.group(i)) for i in range(1, 5))
                        if (abs(bx - target_x) < tolerance and
                                abs(by - target_y) < tolerance and
                                abs(bw - target_w) < tolerance and
                                abs(bh - target_h) < tolerance):
                            bs = max(text.rfind('\nq', 0, rm.start()),
                                    text.rfind(' q', 0, rm.start()))
                            if bs >= 0:
                                bs += 1
                            else:
                                continue
                            be = text.find('Q', rm.end())
                            while be >= 0 and be > 0 and text[be - 1] not in ' \n\t\r':
                                be = text.find('Q', be + 1)
                            if be >= 0:
                                be += 1
                            else:
                                continue
                            text = text[:bs] + text[be:]
                            break

                    if len(text) != orig_len:
                        doc.update_stream(xref, text.encode('latin-1'))
                        break
            except Exception:
                continue

        # ────────────────────────────────────────────────────────────
        # 5. 预计算：段落的 original_text、text_changed、position_changed
        # ────────────────────────────────────────────────────────────
        para_original_text = {}
        para_spans_map = {}  # id(p_edit) → 该段落的 span 列表
        para_changed = {}    # id(p_edit) → (text_changed, position_changed)

        for p_edit in paragraph_edits:
            old_bbox = fitz.Rect(p_edit["bbox"])
            spans_in_para = [
                s for s in current_spans
                if old_bbox.y0 - 2 <= fitz.Rect(s["bbox"]).y0
                and fitz.Rect(s["bbox"]).y1 <= old_bbox.y1 + 2
                and fitz.Rect(s["bbox"]).x0 >= old_bbox.x0 - 2
            ]
            para_spans_map[id(p_edit)] = spans_in_para

            if spans_in_para:
                lines_map = {}
                for s in spans_in_para:
                    y_key = round(s["bbox"][1], 0)
                    lines_map.setdefault(y_key, []).append(s)
                original = "\n".join(
                    "".join(sp["text"] for sp in sorted(lst, key=lambda x: x["bbox"][0]))
                    for lst in (lines_map[y] for y in sorted(lines_map))
                ).strip()
            else:
                original = ""
            para_original_text[id(p_edit)] = original

            new_text_stripped = p_edit["newText"].strip()
            new_bbox = p_edit.get("new_bbox")
            new_font_size = p_edit.get("fontSize", 12)
            original_font_size = p_edit.get("originalFontSize", new_font_size)

            text_changed = new_text_stripped != original
            position_changed = new_bbox and list(new_bbox) != list(p_edit["bbox"])
            font_size_changed = abs(new_font_size - original_font_size) > 0.1

            # Check color change
            new_color = p_edit.get("color")
            color_changed = False
            if new_color and "originalColor" in p_edit:
                original_color = p_edit["originalColor"]
                color_changed = any(abs(new_color[i] - original_color[i]) > 0.01 for i in range(3))

            para_changed[id(p_edit)] = (text_changed or font_size_changed or color_changed, position_changed)

        # ────────────────────────────────────────────────────────────
        # 6. 收集所有编辑区域 + 标记"故意删除"的 span
        # ────────────────────────────────────────────────────────────
        edit_bboxes = []           # 所有要 redact 的区域
        intentional_span_ids = set()  # (text, origin_x, origin_y) 被故意删除的 span

        # 6a. 段落编辑区域
        shifted_spans = []
        shifted_images = []
        edited_para_bboxes = []

        for p_edit in paragraph_edits:
            old_bbox = fitz.Rect(p_edit["bbox"])
            new_bbox = p_edit.get("new_bbox")
            height_delta = p_edit.get("height_delta", 0)
            edited_para_bboxes.append(old_bbox)
            text_changed, position_changed = para_changed[id(p_edit)]

            if text_changed or position_changed:
                edit_bboxes.append(old_bbox)
                # 标记段落内的 span 为"故意删除"
                for s in para_spans_map[id(p_edit)]:
                    intentional_span_ids.add((s["text"], round(s["origin"][0], 1), round(s["origin"][1], 1)))

                # 段落移动时：new_bbox 区域也需清除，标记该区域内 span 为 intentional
                if position_changed and new_bbox:
                    new_rect = fitz.Rect(new_bbox)
                    edit_bboxes.append(new_rect)
                    for s in current_spans:
                        s_bbox = fitz.Rect(s["bbox"])
                        if s_bbox.intersects(new_rect):
                            intentional_span_ids.add((s["text"], round(s["origin"][0], 1), round(s["origin"][1], 1)))

            # 下推逻辑已禁用 - 不再自动移动下方内容
            # if height_delta > 2:
            #     para_bottom = old_bbox.y1
            #     for span in current_spans:
            #         s_bbox = fitz.Rect(span["bbox"])
            #         if s_bbox.y0 >= para_bottom - 1:
            #             in_other_para = any(
            #                 pb.y0 - 2 <= s_bbox.y0 and s_bbox.y1 <= pb.y1 + 2
            #                 for pb in edited_para_bboxes
            #                 if pb != old_bbox
            #             )
            #             if not in_other_para:
            #                 edit_bboxes.append(fitz.Rect(s_bbox))
            #                 intentional_span_ids.add((span["text"], round(span["origin"][0], 1), round(span["origin"][1], 1)))
            #                 shifted_spans.append((span, height_delta))
            #     for img_info in current_images_info:
            #         i_bbox = fitz.Rect(img_info.get("bbox", [0, 0, 0, 0]))
            #         if i_bbox.y0 >= para_bottom - 1 and not i_bbox.is_empty:
            #             shifted_images.append((img_info, height_delta))

        # 6b. 图片编辑区域
        moved_images = []
        for img_edit in image_edits:
            try:
                xref = img_edit["xref"]
                img_bytes = image_rgba_cache.get(xref)
                if not img_bytes:
                    continue
                old_bbox = fitz.Rect(img_edit["old_bbox"])
                edit_bboxes.append(old_bbox)
                moved_images.append({
                    "bytes": img_bytes,
                    "new_bbox": img_edit["new_bbox"],
                    "angle": img_edit.get("angle", 0),
                })
            except Exception:
                continue

        # ────────────────────────────────────────────────────────────
        # 7. 找出"旁观者" span：在编辑区域内但不是被故意删除的
        #    循环扩散：旁观者的完整 bbox 也加入 edit_bboxes，可能波及新的 span
        # ────────────────────────────────────────────────────────────
        bystander_spans = []
        prev_count = -1
        while len(bystander_spans) != prev_count:
            prev_count = len(bystander_spans)
            bystander_spans = []
            for span in current_spans:
                s_bbox = fitz.Rect(span["bbox"])
                if not any(s_bbox.intersects(eb) for eb in edit_bboxes):
                    continue
                sid = (span["text"], round(span["origin"][0], 1), round(span["origin"][1], 1))
                if sid in intentional_span_ids:
                    continue
                bystander_spans.append(span)
            # 把旁观者的完整 bbox 加入编辑区域，供下一轮检测
            for span in bystander_spans:
                sb = fitz.Rect(span["bbox"])
                if not any(sb == eb for eb in edit_bboxes):
                    edit_bboxes.append(sb)

        # ────────────────────────────────────────────────────────────
        # 8. Redact 所有编辑区域（整块清除）
        # ────────────────────────────────────────────────────────────
        for eb in edit_bboxes:
            bg = self._detect_bg_color(page, eb)
            # 白色背景不填充 — PDF 页面本身是白色，无需画白色矩形
            if all(abs(v - 1.0) < 0.01 for v in bg):
                page.add_redact_annot(eb)
            else:
                page.add_redact_annot(eb, fill=bg)

        # 9. 执行 redaction
        page.apply_redactions(images=0)

        # 10. 删除位移图片（replace_image 清空原图）
        for img_info, _ in shifted_images:
            xref = img_info.get("xref", 0)
            if not xref:
                continue
            try:
                transparent_pix = fitz.Pixmap(fitz.csRGB, 1, 1, b'\x00\x00\x00\x00', 1)
                page.replace_image(xref, pixmap=transparent_pix)
            except Exception:
                pass

        # ────────────────────────────────────────────────────────────
        # 11. 恢复旁观者文字（被 redaction 误删的相邻文字）
        # ────────────────────────────────────────────────────────────
        for span in bystander_spans:
            self.font_mgr.insert_text_line(page, span["origin"][0], span["origin"][1],
                                           span["text"], span.get("fontName", ""),
                                           span.get("fontSize", 12),
                                           tuple(span.get("color", (0, 0, 0))))

        # 12. 插入段落文字（仅处理有变化的）
        for p_edit in paragraph_edits:
            old_bbox = fitz.Rect(p_edit["bbox"])
            new_bbox = p_edit.get("new_bbox")
            new_text_stripped = p_edit["newText"].strip()
            text_changed, position_changed = para_changed[id(p_edit)]
            original_text = para_original_text[id(p_edit)]

            if not position_changed and new_text_stripped == original_text:
                continue

            font_size = p_edit.get("fontSize", 12)
            original_font_size = p_edit.get("originalFontSize", font_size)
            color = tuple(p_edit.get("color", (0, 0, 0)))

            # 根据字体大小变化动态调整行高
            # lineHeight 来自前端，是原始字体对应的绝对行高（PDF坐标）
            # 需要按比例调整为新字体对应的行高
            original_line_height = p_edit.get("lineHeight", original_font_size * 1.2)
            if original_font_size > 0 and abs(font_size - original_font_size) > 0.1:
                # 字体大小有变化，按比例调整行高
                line_height_ratio = original_line_height / original_font_size
                line_height = font_size * line_height_ratio
            else:
                line_height = original_line_height

            original_font = p_edit.get("fontName", "")
            target_bbox = fitz.Rect(new_bbox) if new_bbox else old_bbox

            if new_bbox:
                first_baseline_y = new_bbox[1] + font_size * 0.85
            else:
                first_baseline_y = None
                for span in current_spans:
                    s_bbox = fitz.Rect(span["bbox"])
                    if (old_bbox.y0 - 1 <= s_bbox.y0 <= old_bbox.y0 + font_size + 1
                            and s_bbox.x0 >= old_bbox.x0 - 2):
                        first_baseline_y = span["origin"][1]
                        break
                if first_baseline_y is None:
                    first_baseline_y = old_bbox.y0 + font_size * 0.85

            for i, line in enumerate(p_edit["newText"].split('\n')):
                if not line:
                    continue
                y = first_baseline_y + i * line_height
                text_align = p_edit.get("textAlign", "left")
                if text_align == "left" or target_bbox.width < 5:
                    self.font_mgr.insert_text_line(page, target_bbox.x0, y, line,
                                                   original_font, font_size, color)
                else:
                    rect = fitz.Rect(target_bbox.x0, y - font_size, target_bbox.x1, y + font_size * 0.5)
                    align = 1 if text_align == "center" else 2
                    self.font_mgr.insert_textbox(page, rect, line,
                                                 font_name=original_font,
                                                 font_size=font_size, color=color, align=align)

        # 13. 插入位移文字
        for span, delta in shifted_spans:
            new_y = span["origin"][1] + delta
            orig_fn = span.get("fontName", "")
            self.font_mgr.insert_text_line(page, span["bbox"][0], new_y, span["text"],
                                           orig_fn, span["fontSize"], tuple(span["color"]))

        # 14. 插入移动图片
        for moved in moved_images:
            img_bytes = moved["bytes"]
            angle = moved.get("angle", 0)
            if angle and angle % 360 != 0:
                img_bytes = _rotate_image_bytes(img_bytes, angle, ".png")
            page.insert_image(fitz.Rect(moved["new_bbox"]), stream=img_bytes,
                              keep_proportion=True)

        # 15. 插入位移图片
        for img_info, delta in shifted_images:
            xref = img_info.get("xref", 0)
            img_bytes = image_rgba_cache.get(xref)
            if not img_bytes:
                continue
            old_ib = fitz.Rect(img_info.get("bbox", [0, 0, 0, 0]))
            new_rect = fitz.Rect(old_ib.x0, old_ib.y0 + delta, old_ib.x1, old_ib.y1 + delta)
            page.insert_image(new_rect, stream=img_bytes, keep_proportion=True)

        # 16. 插入移动绘图
        for md in moved_drawings:
            fill_color = md["fill"]
            if fill_color:
                shape = page.new_shape()
                shape.draw_rect(fitz.Rect(md["new_bbox"]))
                shape.finish(fill=fill_color, color=md["stroke"])
                shape.commit()

    def _apply_new_elements(self, page, doc, new_elements: list):
        """在页面上插入新增的文本和图片元素。

        在已有元素编辑之后调用，纯新增，不涉及涂改。
        """
        for el in new_elements:
            el_type = el.get("type", "")
            bbox = el.get("bbox", [0, 0, 0, 0])
            rect = fitz.Rect(bbox)

            if el_type == "text":
                text = el.get("text", "")
                if not text.strip():
                    continue

                font_name = el.get("font_name", "Roboto")
                font_size = el.get("font_size", 12.0)
                color = el.get("color", [0, 0, 0])
                font_weight = el.get("font_weight", "normal")
                font_style = el.get("font_style", "normal")
                text_align = el.get("text_align", "left")
                align_map = {"left": 0, "center": 1, "right": 2, "justify": 3}
                align = align_map.get(text_align, 0)

                font_file = self.font_mgr.find_local_font(font_name, font_weight, font_style)
                color_tuple = tuple(color) if color else (0, 0, 0)

                self.font_mgr.insert_textbox(
                    page, rect, text,
                    font_file=font_file, font_name=font_name,
                    font_size=font_size, color=color_tuple, align=align,
                )

            elif el_type == "image":
                image_id = el.get("image_id", "")
                ext = el.get("ext", ".png")
                angle = el.get("angle", 0)
                if not image_id:
                    continue

                image_path = IMAGE_DIR / f"{self.file_id}_{image_id}{ext}"
                if not image_path.exists():
                    continue

                with open(image_path, "rb") as f:
                    img_bytes = f.read()

                if angle and angle % 360 != 0:
                    img_bytes = _rotate_image_bytes(img_bytes, angle, ext)

                # 压缩图片：转换为 JPEG 格式（质量 85）以减小文件大小
                try:
                    from PIL import Image
                    import io
                    pil_img = Image.open(io.BytesIO(img_bytes))
                    # 如果有 alpha 通道，转换为 RGB
                    if pil_img.mode in ('RGBA', 'LA', 'PA'):
                        # 创建白色背景
                        background = Image.new('RGB', pil_img.size, (255, 255, 255))
                        if pil_img.mode == 'RGBA':
                            background.paste(pil_img, mask=pil_img.split()[3])
                        else:
                            background.paste(pil_img)
                        pil_img = background
                    elif pil_img.mode != 'RGB':
                        pil_img = pil_img.convert('RGB')
                    # 保存为 JPEG
                    output = io.BytesIO()
                    pil_img.save(output, format='JPEG', quality=85, optimize=True)
                    img_bytes = output.getvalue()
                except Exception as e:
                    print(f"[WARN] Image compression failed, using original: {e}")

                page.insert_image(rect, stream=img_bytes, keep_proportion=True)

    def modify_page(self, page_num: int, paragraph_edits: List[Dict], image_edits: List[Dict] = None, dpi: int = 150) -> Dict:
        """修改页面并返回渲染结果（实时预览用）"""
        if image_edits is None:
            image_edits = []

        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        page = self.doc[page_num]
        self._apply_all_edits(page, self.doc, paragraph_edits, image_edits, [])

        image_path = self.render_page_to_file(page_num, dpi)
        image_url = f"/renders/{Path(image_path).name}"
        paragraphs = self.get_page_text(page_num)
        images = self.get_page_images(page_num)
        drawings = self.get_page_drawings(page_num)

        return {
            "image_url": image_url,
            "paragraphs": paragraphs,
            "images": images,
            "drawings": drawings,
        }

    def apply_all_pages_edits(self, pages_edits: dict) -> str:
        """多页统一导出：复制 doc，逐页应用编辑，导出。

        pages_edits: { "0": {paragraph_edits, image_edits, drawing_edits}, ... }
        """
        import io
        buf = io.BytesIO()
        self.doc.save(buf)
        buf.seek(0)

        tmp_path = OUTPUT_DIR / f"{self.file_id}_tmp_all.pdf"
        with open(tmp_path, 'wb') as f:
            f.write(buf.read())

        tmp_doc = fitz.open(str(tmp_path))

        for page_num_str, edits in pages_edits.items():
            page_num = int(page_num_str)
            if page_num < 0 or page_num >= len(tmp_doc):
                continue
            para_edits = edits.get("paragraph_edits", [])
            img_edits = edits.get("image_edits", [])
            draw_edits = edits.get("drawing_edits", [])
            new_elements = edits.get("new_elements", [])
            if not para_edits and not img_edits and not draw_edits and not new_elements:
                continue
            page = tmp_doc[page_num]
            # 先处理已有元素编辑
            if para_edits or img_edits or draw_edits:
                self._apply_all_edits(page, tmp_doc, para_edits, img_edits, draw_edits)
            # 再插入新增元素
            if new_elements:
                self._apply_new_elements(page, tmp_doc, new_elements)

        output_path = OUTPUT_DIR / f"{self.file_id}_edited.pdf"
        self.font_mgr.save_with_subset(tmp_doc, str(output_path))
        tmp_doc.close()
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        return str(output_path)

    def export_pdf(self) -> str:
        """导出修改后的 PDF，返回文件路径"""
        output_path = OUTPUT_DIR / f"{self.file_id}_edited.pdf"
        self.doc.save(str(output_path))
        return str(output_path)

    def apply_edits_and_export(self, page_num: int, paragraph_edits: List[Dict], image_edits: List[Dict], drawing_edits: List[Dict] = None) -> str:
        """一次性应用所有编辑并导出 PDF

        复制 doc 副本进行修改，不影响内存中的原始 doc（支持多次导出）。
        """
        if drawing_edits is None:
            drawing_edits = []

        if page_num < 0 or page_num >= len(self.doc):
            raise ValueError(f"Page {page_num} out of range")

        # 复制 doc，在副本上操作
        import io
        buf = io.BytesIO()
        self.doc.save(buf)
        buf.seek(0)

        tmp_path = OUTPUT_DIR / f"{self.file_id}_tmp.pdf"
        with open(tmp_path, 'wb') as f:
            f.write(buf.read())

        tmp_doc = fitz.open(str(tmp_path))
        page = tmp_doc[page_num]

        self._apply_all_edits(page, tmp_doc, paragraph_edits, image_edits, drawing_edits)

        # 导出（子集化字体 + 压缩保存）
        output_path = OUTPUT_DIR / f"{self.file_id}_edited.pdf"
        self.font_mgr.save_with_subset(tmp_doc, str(output_path))
        tmp_doc.close()
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        return str(output_path)

    def close(self):
        """关闭文档，释放内存"""
        self.doc.close()


def _rotate_image_bytes(img_bytes: bytes, angle: float, ext: str = ".png") -> bytes:
    """旋转图片字节，保持原始格式和背景色。"""
    from PIL import Image

    pil_img = Image.open(io.BytesIO(img_bytes))
    has_alpha = pil_img.mode in ('RGBA', 'LA', 'PA')

    if has_alpha:
        rotated = pil_img.rotate(-angle, expand=True, resample=Image.BICUBIC)
    else:
        rotated = pil_img.convert('RGBA').rotate(
            -angle, expand=True, resample=Image.BICUBIC,
            fillcolor=(255, 255, 255, 255)
        )
        bg = Image.new('RGBA', rotated.size, (255, 255, 255, 255))
        bg.paste(rotated, mask=rotated.split()[3] if rotated.mode == 'RGBA' else None)
        rotated = bg.convert('RGB')

    buf = io.BytesIO()
    if ext.lower() in ('.jpg', '.jpeg'):
        rotated.save(buf, format='JPEG', quality=90)
    else:
        rotated.save(buf, format='PNG')
    return buf.getvalue()