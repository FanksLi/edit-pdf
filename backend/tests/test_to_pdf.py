"""测试文件转PDF功能"""
import pytest
from pathlib import Path
from app.services.convert_service import convert_to_pdf, TO_PDF_FORMATS


class TestConvertToPdfFormats:
    """测试支持的格式"""

    def test_to_pdf_formats_defined(self):
        """验证支持的格式列表"""
        expected = ["docx", "xlsx", "pptx", "jpg", "jpeg", "png"]
        assert list(TO_PDF_FORMATS.keys()) == expected

    def test_unsupported_format_raises_error(self):
        """不支持的格式应抛出 ValueError"""
        with pytest.raises(ValueError, match="Unsupported source format"):
            convert_to_pdf(b"test", "txt", "test.txt")


class TestToPdfConversion:
    """测试实际转换功能（需要LibreOffice）"""

    @pytest.fixture
    def sample_docx(self, tmp_path):
        """创建测试用的 docx 文件"""
        # 使用真实的 docx 文件或跳过
        sample_file = Path("tests/fixtures/sample.docx")
        if not sample_file.exists():
            pytest.skip("Sample docx file not found")
        return sample_file.read_bytes()

    def test_docx_to_pdf(self, sample_docx):
        """测试 docx 转 PDF"""
        result = convert_to_pdf(sample_docx, "docx", "test.docx")

        assert "bytes" in result
        assert "mime" in result
        assert "filename" in result
        assert result["mime"] == "application/pdf"
        assert result["filename"].endswith(".pdf")
        assert len(result["bytes"]) > 0
        # 验证PDF魔术字节
        assert result["bytes"][:4] == b"%PDF"

    @pytest.fixture
    def sample_jpg(self, tmp_path):
        """创建测试用的 jpg 文件"""
        # 使用最小的有效JPEG文件或跳过
        sample_file = Path("tests/fixtures/sample.jpg")
        if not sample_file.exists():
            pytest.skip("Sample jpg file not found")
        return sample_file.read_bytes()

    def test_jpg_to_pdf(self, sample_jpg):
        """测试 jpg 转 PDF"""
        result = convert_to_pdf(sample_jpg, "jpg", "test.jpg")

        assert result["mime"] == "application/pdf"
        assert result["filename"].endswith(".pdf")
        assert result["bytes"][:4] == b"%PDF"


class TestToPdfAPI:
    """测试 API 路由"""

    def test_unsupported_format_returns_400(self):
        """不支持的格式应返回 400"""
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)

        response = client.post(
            "/api/to-pdf/",
            files={"file": ("test.txt", b"test content", "text/plain")}
        )

        assert response.status_code == 400
        assert "Unsupported format" in response.json()["detail"]

    def test_empty_file_returns_400(self):
        """空文件应返回 400"""
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)

        response = client.post(
            "/api/to-pdf/",
            files={"file": ("test.docx", b"", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        )

        assert response.status_code == 400
        assert "Empty file" in response.json()["detail"]
