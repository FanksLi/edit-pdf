# PDF 文字编辑系统 API 接口文档

## 基础信息

- **Base URL**: `http://localhost:8000/api/pdf`
- **Content-Type**: `application/json` (除文件上传外)
- **认证**: MVP 无认证，后续可扩展

---

## 数据模型定义

### TextSpan (文字块)

```python
from pydantic import BaseModel
from typing import List, Tuple

class TextSpan(BaseModel):
    text: str                          # 文字内容
    bbox: Tuple[float, float, float, float]  # [x0, y0, x1, y1] PDF坐标
    fontSize: float                    # 字号
    fontName: str                      # 字体名称
    color: Tuple[float, float, float]  # RGB (0-1范围)
    origin: Tuple[float, float]        # 文字基线起点 [x, y]
```

### EditItem (编辑项)

```python
class EditItem(BaseModel):
    bbox: Tuple[float, float, float, float]  # 要编辑的区域
    newText: str                        # 新文字内容
    fontSize: float                     # 字号
    origin: Tuple[float, float]         # 文字基线起点
```

### UploadResponse (上传响应)

```python
class UploadResponse(BaseModel):
    file_id: str              # 唯一文件标识
    page_count: int           # 总页数
    page_width: float         # 第一页宽度
    page_height: float        # 第一页高度
```

### TextResponse (文字数据响应)

```python
class TextResponse(BaseModel):
    page_width: float
    page_height: float
    spans: List[TextSpan]
```

### RenderResponse (渲染响应)

```python
class RenderResponse(BaseModel):
    image_base64: str         # PNG base64编码
    width: int                # 渲染图片宽度
    height: int               # 渲染图片高度
    dpi: int                  # 渲染DPI
```

### ModifyRequest (修改请求)

```python
class ModifyRequest(BaseModel):
    edits: List[EditItem]
```

### ModifyResponse (修改响应)

```python
class ModifyResponse(BaseModel):
    image_base64: str         # 新渲染图片
    text_data: List[TextSpan] # 更新后的文字数据
```

### ErrorResponse (错误响应)

```python
class ErrorResponse(BaseModel):
    error: str                # 错误类型
    detail: str               # 详细信息
```

---

## API 接口

### 1. 上传 PDF

**接口**: `POST /api/pdf/upload`

**请求**:
- Content-Type: `multipart/form-data`
- Body: `file` (PDF文件)

**响应**: `UploadResponse`

```json
{
  "file_id": "a1b2c3d4e5f6",
  "page_count": 5,
  "page_width": 595.0,
  "page_height": 842.0
}
```

**错误响应**:
- 400: 文件格式不正确 / PDF损坏
- 500: 服务器处理错误

---

### 2. 获取页面文字数据

**接口**: `GET /api/pdf/{file_id}/page/{page_num}/text`

**参数**:
- `file_id`: 文件唯一标识
- `page_num`: 页码 (从 0 开始)

**响应**: `TextResponse`

```json
{
  "page_width": 595.0,
  "page_height": 842.0,
  "spans": [
    {
      "text": "Hello World",
      "bbox": [100.0, 700.0, 200.0, 720.0],
      "fontSize": 12.0,
      "fontName": "Helvetica",
      "color": [0.0, 0.0, 0.0],
      "origin": [100.0, 718.0]
    }
  ]
}
```

**错误响应**:
- 404: file_id 不存在 / 页码超出范围

---

### 3. 渲染页面为图片

**接口**: `GET /api/pdf/{file_id}/page/{page_num}/render`

**参数**:
- `file_id`: 文件唯一标识
- `page_num`: 页码 (从 0 开始)
- Query: `dpi` (可选，默认 150)

**响应**: `RenderResponse`

```json
{
  "image_base64": "iVBORw0KGgoAAAANS...",
  "width": 1240,
  "height": 1754,
  "dpi": 150
}
```

**或直接返回 PNG 文件**:
- Content-Type: `image/png`
- Body: 二进制 PNG 数据

**错误响应**:
- 404: file_id 不存在 / 页码超出范围

---

### 4. 修改页面文字

**接口**: `POST /api/pdf/{file_id}/page/{page_num}/modify`

**参数**:
- `file_id`: 文件唯一标识
- `page_num`: 页码 (从 0 开始)

**请求**: `ModifyRequest`

```json
{
  "edits": [
    {
      "bbox": [100.0, 700.0, 200.0, 720.0],
      "newText": "New Text",
      "fontSize": 12.0,
      "origin": [100.0, 718.0]
    }
  ]
}
```

**响应**: `ModifyResponse`

```json
{
  "image_base64": "iVBORw0KGgoAAAANS...",
  "text_data": [
    {
      "text": "New Text",
      "bbox": [100.0, 700.0, 180.0, 720.0],
      "fontSize": 12.0,
      "fontName": "Helvetica",
      "color": [0.0, 0.0, 0.0],
      "origin": [100.0, 718.0]
    }
  ]
}
```

**处理流程**:
1. 使用 `add_redact_annot(bbox)` 标记抹除区域
2. 使用 `apply_redactions()` 执行抹除
3. 使用 `insert_text(origin, newText)` 写入新文字
4. 重新渲染页面为 PNG
5. 重新提取文字数据

**错误响应**:
- 404: file_id 不存在 / 页码超出范围
- 400: edits 数据格式错误
- 500: PDF 处理错误

---

### 5. 导出修改后的 PDF

**接口**: `GET /api/pdf/{file_id}/export`

**参数**:
- `file_id`: 文件唯一标识

**响应**:
- Content-Type: `application/pdf`
- Body: 二进制 PDF 数据
- Header: `Content-Disposition: attachment; filename="{file_id}_edited.pdf"`

**错误响应**:
- 404: file_id 不存在
- 500: PDF 导出错误

---

## 错误码说明

| 状态码 | 说明 |
|---|---|
| 200 | 成功 |
| 400 | 请求参数错误 / 文件格式错误 |
| 404 | 资源不存在 (file_id / page_num) |
| 500 | 服务器内部错误 |

---

## 前端调用示例

### JavaScript (fetch)

```javascript
// 上传 PDF
async function uploadPDF(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch('/api/pdf/upload', {
    method: 'POST',
    body: formData
  });
  return response.json();
}

// 获取文字数据
async function getPageText(fileId, pageNum) {
  const response = await fetch(`/api/pdf/${fileId}/page/${pageNum}/text`);
  return response.json();
}

// 渲染页面
async function getPageRender(fileId, pageNum, dpi = 150) {
  const response = await fetch(`/api/pdf/${fileId}/page/${pageNum}/render?dpi=${dpi}`);
  return response.json();
}

// 修改文字
async function modifyPage(fileId, pageNum, edits) {
  const response = await fetch(`/api/pdf/${fileId}/page/${pageNum}/modify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edits })
  });
  return response.json();
}

// 导出 PDF
async function exportPDF(fileId) {
  const response = await fetch(`/api/pdf/${fileId}/export`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileId}_edited.pdf`;
  a.click();
}
```

---

## 注意事项

1. **坐标系统**: PDF 使用左下角原点，Y 轴向上；前端需转换为左上角原点
2. **原文件保护**: 所有修改不会影响原始 PDF，导出时生成新文件
3. **字体替代**: 编辑时使用 Helvetica 替代原字体，可能导致视觉差异
4. **DPI 选择**: 推荐 100-200，过高会影响性能
5. **MVP 范围**: 仅支持单页编辑，多页功能后续扩展