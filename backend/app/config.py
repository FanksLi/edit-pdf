"""配置管理"""

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
RENDER_DIR = BASE_DIR / "renders"
OUTPUT_DIR = BASE_DIR / "outputs"

# 确保目录存在
for d in [UPLOAD_DIR, RENDER_DIR, OUTPUT_DIR]:
    d.mkdir(parents=True, exist_ok=True)