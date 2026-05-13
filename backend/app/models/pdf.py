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


class ImageBlock(BaseModel):
    """PDF 中的图片块"""
    xref: int
    bbox: Tuple[float, float, float, float]
    width: int
    height: int
    image_url: str


class PageContentResponse(BaseModel):
    """页面内容响应 - 文字 + 图片"""
    page_width: float
    page_height: float
    spans: List[TextSpan]
    images: List[ImageBlock]


class ImageEditItem(BaseModel):
    """图片编辑项"""
    xref: int
    old_bbox: Tuple[float, float, float, float]
    new_bbox: Tuple[float, float, float, float]
    image_data: str  # base64 编码


class ModifyRequest(BaseModel):
    """修改请求"""
    text_edits: List[EditItem]
    image_edits: List[ImageEditItem] = []


class ModifyResponse(BaseModel):
    """修改响应"""
    image_url: str
    text_data: List[TextSpan]
    images: List[ImageBlock]


class ErrorResponse(BaseModel):
    """错误响应"""
    error: str
    detail: str