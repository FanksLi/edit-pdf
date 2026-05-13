"""PDF 数据模型定义"""

from pydantic import BaseModel
from typing import List, Tuple


class TextSpan(BaseModel):
    """文字块数据"""
    text: str
    bbox: Tuple[float, float, float, float]  # [x0, y0, x1, y1] PDF坐标
    fontSize: float
    fontName: str
    color: Tuple[float, float, float]  # RGB (0-1范围)
    origin: Tuple[float, float]  # 文字基线起点 [x, y]


class EditItem(BaseModel):
    """编辑项"""
    bbox: Tuple[float, float, float, float]
    newText: str
    fontSize: float
    origin: Tuple[float, float]


class UploadResponse(BaseModel):
    """上传响应"""
    file_id: str
    page_count: int
    page_width: float
    page_height: float


class TextResponse(BaseModel):
    """文字数据响应"""
    page_width: float
    page_height: float
    spans: List[TextSpan]


class RenderResponse(BaseModel):
    """渲染响应"""
    image_url: str
    width: int
    height: int
    dpi: int


class ModifyRequest(BaseModel):
    """修改请求"""
    edits: List[EditItem]


class ModifyResponse(BaseModel):
    """修改响应"""
    image_url: str
    text_data: List[TextSpan]


class ErrorResponse(BaseModel):
    """错误响应"""
    error: str
    detail: str