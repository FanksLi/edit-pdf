"""PDF 转换 API 路由"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import Response

from app.services.convert_service import convert_pdf_to, SUPPORTED_FORMATS

router = APIRouter(prefix="/api/convert", tags=["convert"])


@router.post("/")
async def convert_pdf(
    file: UploadFile = File(...),
    target_format: str = Query("docx", enum=list(SUPPORTED_FORMATS.keys())),
):
    """将 PDF 转换为办公文档 (docx/xlsx/pptx)"""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file not allowed")

    try:
        result = convert_pdf_to(file_bytes, target_format, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")

    return Response(
        content=result["bytes"],
        media_type=result["mime"],
        headers={"Content-Disposition": f'attachment; filename="{result["filename"]}"'},
    )
