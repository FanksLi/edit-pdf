"""FastAPI 应用入口"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import pdf

app = FastAPI(
    title="PDF 文字编辑系统",
    description="实现 PDF 文字的精确提取、可视化编辑和修改导出",
    version="0.1.0",
)

# CORS 配置 - 允许前端访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # MVP 允许所有来源，生产环境应限制
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(pdf.router)


@app.get("/")
async def root():
    """根路径"""
    return {"message": "PDF Editor API", "docs": "/docs"}