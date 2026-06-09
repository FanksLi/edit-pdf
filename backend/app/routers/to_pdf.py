"""文件转 PDF API 路由"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response
from pathlib import Path

from app.services.convert_service import convert_to_pdf, TO_PDF_FORMATS

router = APIRouter(prefix="/api/to-pdf", tags=["to-pdf"])


@router.post("/")
async def to_pdf(file: UploadFile = File(...)):
    """将 Office 文档或图片转换为 PDF

    支持格式：docx, xlsx, pptx, jpg, jpeg, png
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    # 提取扩展名（去掉点）
    ext = Path(file.filename).suffix.lower().lstrip(".")

    if ext not in TO_PDF_FORMATS:
        supported = ", ".join(TO_PDF_FORMATS.keys())
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{ext}'. Supported: {supported}"
        )

    file_bytes = await file.read()

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file not allowed")

    try:
        result = convert_to_pdf(file_bytes, ext, file.filename)
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
