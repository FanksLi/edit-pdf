"""PDF 数据模型定义"""

from pydantic import BaseModel
from typing import List, Tuple, Optional


class TextSpan(BaseModel):
    """文字块数据"""
    text: str
    bbox: Tuple[float, float, float, float]  # [x0, y0, x1, y1] PDF坐标
    fontSize: float
    fontName: str
    color: Tuple[float, float, float]  # RGB (0-1范围)
    origin: Tuple[float, float]  # 文字基线起点 [x, y]


class Paragraph(BaseModel):
    """段落数据 — 多行文字组成的编辑单元"""
    text: str
    bbox: Tuple[float, float, float, float]
    fontSize: float
    fontName: str
    color: Tuple[float, float, float]
    lineHeight: float
    z_index: int = 0


class EditItem(BaseModel):
    """编辑项"""
    bbox: Tuple[float, float, float, float]
    newText: str
    fontSize: float
    origin: Tuple[float, float]


class ParagraphEditItem(BaseModel):
    """段落编辑项"""
    bbox: Tuple[float, float, float, float]  # 原始段落 bbox（用于 redaction）
    new_bbox: Optional[Tuple[float, float, float, float]] = None  # 新位置（移动后）
    newText: str
    fontSize: float
    fontName: str
    color: Tuple[float, float, float]
    height_delta: float = 0.0  # 新高度 - 原高度（PDF 坐标）
    lineHeight: float = 0.0  # 行间距（PDF 坐标）


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
    z_index: int = 0


class DrawingBlock(BaseModel):
    """PDF 中的绘图元素（矩形、线条等）"""
    rect: Tuple[float, float, float, float]  # [x0, y0, x1, y1]
    fill: Optional[Tuple[float, float, float]] = None  # RGB (0-1)
    stroke: Optional[Tuple[float, float, float]] = None  # RGB (0-1)
    z_index: int = 0


class PageContentResponse(BaseModel):
    """页面内容响应 - 绘图 + 段落 + 图片（按 z_index 排列）"""
    page_width: float
    page_height: float
    drawings: List[DrawingBlock] = []
    paragraphs: List[Paragraph]
    images: List[ImageBlock]


class ImageEditItem(BaseModel):
    """图片编辑项"""
    xref: int
    old_bbox: Tuple[float, float, float, float]
    new_bbox: Tuple[float, float, float, float]
    image_data: str  # base64 编码


class DrawingEditItem(BaseModel):
    """绘图编辑项（位置移动）"""
    old_bbox: Tuple[float, float, float, float]
    new_bbox: Tuple[float, float, float, float]


class ModifyRequest(BaseModel):
    """修改请求"""
    paragraph_edits: List[ParagraphEditItem] = []
    image_edits: List[ImageEditItem] = []


class ModifyResponse(BaseModel):
    """修改响应"""
    image_url: str
    paragraphs: List[Paragraph]
    images: List[ImageBlock]
    drawings: List[DrawingBlock] = []


class ErrorResponse(BaseModel):
    """错误响应"""
    error: str
    detail: str


class FontVariant(BaseModel):
    """字体变体信息"""
    family: str
    display_name: str
    variants: List[str]  # ["regular", "bold", "italic", "bolditalic"]


class NewElement(BaseModel):
    """新增元素（文本或图片）"""
    type: str  # "text" or "image"

    # 通用
    bbox: Tuple[float, float, float, float]  # [x0, y0, x1, y1]

    # 文本字段
    text: Optional[str] = None
    font_name: Optional[str] = None
    font_size: Optional[float] = None
    color: Optional[Tuple[float, float, float]] = None  # [r, g, b] 0-1
    font_weight: Optional[str] = None   # "normal" / "bold"
    font_style: Optional[str] = None    # "normal" / "italic"
    text_align: Optional[str] = None    # "left" / "center" / "right"

    # 图片字段
    image_id: Optional[str] = None
    opacity: Optional[float] = None  # 0-1