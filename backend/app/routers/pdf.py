"""PDF API 路由"""

import os
from typing import Dict
from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse

from app.models.pdf import (
    TextSpan, EditItem, UploadResponse, TextResponse,
    RenderResponse, ModifyRequest, ModifyResponse, ErrorResponse
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
    temp_path = UPLOAD_DIR / f"temp_{file.filename}"

    with open(temp_path, "wb") as f:
        f.write(file_bytes)

    try:
        # 创建 PDFService
        service = PDFService(str(temp_path))
        pdf_services[service.file_id] = service

        # 重命名文件为 file_id
        final_path = UPLOAD_DIR / f"{service.file_id}.pdf"
        os.rename(str(temp_path), str(final_path))

        # 获取第一页尺寸
        page_width, page_height = service.get_page_size(0)

        return UploadResponse(
            file_id=service.file_id,
            page_count=service.get_page_count(),
            page_width=page_width,
            page_height=page_height
        )
    except Exception as e:
        # 清理临时文件
        if temp_path.exists():
            os.remove(str(temp_path))
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")


@router.get("/{file_id}/page/{page_num}/text", response_model=TextResponse, responses={404: {"model": ErrorResponse}})
async def get_page_text(file_id: str, page_num: int = 0):
    """获取页面文字数据"""
    if file_id not in pdf_services:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    service = pdf_services[file_id]

    try:
        width, height = service.get_page_size(page_num)
        spans = service.get_page_text(page_num)

        return TextResponse(
            page_width=width,
            page_height=height,
            spans=[TextSpan(**span) for span in spans]
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
        image_base64 = service.render_page(page_num, dpi)
        width, height = service.get_render_size(page_num, dpi)

        return RenderResponse(
            image_base64=image_base64,
            width=width,
            height=height,
            dpi=dpi
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{file_id}/page/{page_num}/modify", response_model=ModifyResponse, responses={404: {"model": ErrorResponse}, 400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def modify_page(file_id: str, page_num: int, request: ModifyRequest):
    """修改页面文字"""
    if file_id not in pdf_services:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    service = pdf_services[file_id]

    try:
        edits = [edit.model_dump() for edit in request.edits]
        result = service.modify_page(page_num, edits)

        return ModifyResponse(
            image_base64=result["image_base64"],
            text_data=[TextSpan(**span) for span in result["text_data"]]
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