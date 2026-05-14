"""PDF API 路由"""

import os
from typing import Dict
from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse

from app.models.pdf import (
    UploadResponse, PageContentResponse, RenderResponse,
    ModifyRequest, ModifyResponse, ErrorResponse,
    ImageBlock, DrawingBlock, Paragraph
)
from app.services.pdf_service import PDFService
from app.config import UPLOAD_DIR

router = APIRouter(prefix="/api/pdf", tags=["pdf"])

# 内存中管理 PDFService 实例
pdf_services: Dict[str, PDFService] = {}


@router.post("/upload", response_model=UploadResponse, responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def upload_pdf(file: UploadFile = File(...)):
    """上传 PDF 文件"""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    file_bytes = await file.read()

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file not allowed")

    import uuid
    file_id = uuid.uuid4().hex
    final_path = UPLOAD_DIR / f"{file_id}.pdf"

    try:
        with open(final_path, "wb") as f:
            f.write(file_bytes)

        service = PDFService(str(final_path))
        service.file_id = file_id
        pdf_services[service.file_id] = service

        page_width, page_height = service.get_page_size(0)

        return UploadResponse(
            file_id=service.file_id,
            page_count=service.get_page_count(),
            page_width=page_width,
            page_height=page_height
        )
    except Exception as e:
        if final_path.exists():
            try:
                os.remove(str(final_path))
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")


@router.get("/{file_id}/page/{page_num}/text", response_model=PageContentResponse, responses={404: {"model": ErrorResponse}})
async def get_page_text(file_id: str, page_num: int = 0):
    """获取页面段落和图片数据"""
    if file_id not in pdf_services:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    service = pdf_services[file_id]

    try:
        width, height = service.get_page_size(page_num)
        paragraphs = service.get_page_text(page_num)
        images = service.get_page_images(page_num)
        drawings = service.get_page_drawings(page_num)

        return PageContentResponse(
            page_width=width,
            page_height=height,
            drawings=[DrawingBlock(**d) for d in drawings],
            paragraphs=[Paragraph(**p) for p in paragraphs],
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
    """修改页面段落和图片"""
    if file_id not in pdf_services:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    service = pdf_services[file_id]

    try:
        paragraph_edits = [edit.model_dump() for edit in request.paragraph_edits]
        image_edits = [edit.model_dump() for edit in request.image_edits]
        result = service.modify_page(page_num, paragraph_edits, image_edits, dpi)

        return ModifyResponse(
            image_url=result["image_url"],
            paragraphs=[Paragraph(**p) for p in result["paragraphs"]],
            images=[ImageBlock(**img) for img in result["images"]],
            drawings=[DrawingBlock(**d) for d in result.get("drawings", [])],
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

        service.close()
        pdf_services.pop(file_id, None)

        return FileResponse(
            path=output_path,
            media_type="application/pdf",
            filename=f"{file_id}_edited.pdf"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export PDF: {str(e)}")
