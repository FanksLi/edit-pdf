"""PDF API 路由"""

import os
from typing import Dict
from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse

from app.models.pdf import (
    TextSpan, EditItem, UploadResponse, TextResponse,
    PageContentResponse, RenderResponse, ModifyRequest, ModifyResponse,
    ErrorResponse, ImageBlock
)
from app.services.pdf_service import PDFService
from app.config import UPLOAD_DIR

router = APIRouter(prefix="/api/pdf", tags=["pdf"])

# 内存中管理 PDFService 实例
pdf_services: Dict[str, PDFService] = {}


@router.post("/upload", response_model=UploadResponse, responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def upload_pdf(file: UploadFile = File(...)):
    """上传 PDF 文件"""
    # 检查文件类型
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    # 保存文件
    file_bytes = await file.read()

    # 检查文件是否为空
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file not allowed")

    # 先生成 file_id，直接用 file_id 命名写入，避免 Windows 上 rename 占用问题
    import uuid
    file_id = uuid.uuid4().hex
    final_path = UPLOAD_DIR / f"{file_id}.pdf"

    try:
        with open(final_path, "wb") as f:
            f.write(file_bytes)

        # 创建 PDFService
        service = PDFService(str(final_path))
        service.file_id = file_id  # 使用预生成的 file_id
        pdf_services[service.file_id] = service

        # 获取第一页尺寸
        page_width, page_height = service.get_page_size(0)

        return UploadResponse(
            file_id=service.file_id,
            page_count=service.get_page_count(),
            page_width=page_width,
            page_height=page_height
        )
    except Exception as e:
        # 清理文件
        if final_path.exists():
            try:
                os.remove(str(final_path))
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")


@router.get("/{file_id}/page/{page_num}/text", response_model=PageContentResponse, responses={404: {"model": ErrorResponse}})
async def get_page_text(file_id: str, page_num: int = 0):
    """获取页面文字和图片数据"""
    if file_id not in pdf_services:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    service = pdf_services[file_id]

    try:
        width, height = service.get_page_size(page_num)
        spans = service.get_page_text(page_num)
        images = service.get_page_images(page_num)

        return PageContentResponse(
            page_width=width,
            page_height=height,
            spans=[TextSpan(**span) for span in spans],
            images=[ImageBlock(**img) for img in images],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{file_id}/page/{page_num}/render", response_model=RenderResponse, responses={404: {"model": ErrorResponse}})
async def get_page_render(file_id: str, page_num: int = 0, dpi: int = Query(150, ge=50, le=300)):
    """渲染页面为图片"""
    if file_id not in pdf_services:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    service = pdf_services[file_id]

    try:
        # 渲染并保存到文件，返回 URL
        image_path = service.render_page_to_file(page_num, dpi)
        image_url = f"/renders/{os.path.basename(image_path)}"
        width, height = service.get_render_size(page_num, dpi)

        return RenderResponse(
            image_url=image_url,
            width=width,
            height=height,
            dpi=dpi
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{file_id}/page/{page_num}/modify", response_model=ModifyResponse, responses={404: {"model": ErrorResponse}, 400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def modify_page(file_id: str, page_num: int, request: ModifyRequest, dpi: int = Query(150, ge=50, le=300)):
    """修改页面文字和图片"""
    if file_id not in pdf_services:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    service = pdf_services[file_id]

    try:
        text_edits = [edit.model_dump() for edit in request.text_edits]
        image_edits = [edit.model_dump() for edit in request.image_edits]
        result = service.modify_page(page_num, text_edits, image_edits, dpi)

        return ModifyResponse(
            image_url=result["image_url"],
            text_data=[TextSpan(**span) for span in result["text_data"]],
            images=[ImageBlock(**img) for img in result["images"]],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to modify page: {str(e)}")


@router.get("/{file_id}/export", responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def export_pdf(file_id: str):
    """导出修改后的 PDF"""
    if file_id not in pdf_services:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    service = pdf_services[file_id]

    try:
        output_path = service.export_pdf()

        # 清理：导出后释放资源，防止内存泄漏
        service.close()
        pdf_services.pop(file_id, None)

        return FileResponse(
            path=output_path,
            media_type="application/pdf",
            filename=f"{file_id}_edited.pdf"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export PDF: {str(e)}")