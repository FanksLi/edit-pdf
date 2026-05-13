import { useState, useCallback, useRef, useEffect } from 'react';
import FileUpload from './FileUpload';
import TextBlock from './TextBlock';
import { uploadPDF, getPageText, getPageRender, modifyPage, exportPDF } from '../services/api';

function PDFViewer() {
  const [fileId, setFileId] = useState(null);
  const [pageData, setPageData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [renderHeight, setRenderHeight] = useState(800);
  const [imageUrl, setImageUrl] = useState(null);

  // 编辑历史栈（用于 Ctrl+Z 撤销）
  const editHistory = useRef([]);
  const [canUndo, setCanUndo] = useState(false);

  // 上传 PDF
  const handleUpload = async (file) => {
    setLoading(true);
    setError(null);
    try {
      const result = await uploadPDF(file);
      setFileId(result.file_id);
      await loadPage(result.file_id, 0, result.page_width, result.page_height);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 加载页面数据
  const loadPage = async (fid, pageNum, knownWidth = null, knownHeight = null) => {
    try {
      const [textData, imageData] = await Promise.all([
        getPageText(fid, pageNum),
        getPageRender(fid, pageNum),
      ]);

      // 直接使用服务器返回的 URL
      setImageUrl(imageData.image_url);

      setPageData({
        imagePath: imageData.image_url,
        textSpans: textData.spans || [],
        pageWidth: knownWidth || textData.page_width,
        pageHeight: knownHeight || textData.page_height,
      });
    } catch (err) {
      setError(err.message);
    }
  };

  // 编辑回调（保存历史用于撤销）
  const handleEdit = useCallback(async (edit) => {
    if (!fileId) return;

    // 保存当前状态到历史栈
    editHistory.current.push({
      pageData: JSON.parse(JSON.stringify(pageData)),
      imageUrl: imageUrl,
    });
    setCanUndo(editHistory.current.length > 0);

    setLoading(true);
    setError(null);
    try {
      const result = await modifyPage(fileId, 0, [edit]);
      // 使用返回的 image_url
      setImageUrl(result.image_url);
      setPageData({
        imagePath: result.image_url,
        textSpans: result.text_data || [],
        pageWidth: pageData.pageWidth,
        pageHeight: pageData.pageHeight,
      });
    } catch (err) {
      setError(err.message);
      // 撤销失败的编辑
      if (editHistory.current.length > 0) {
        const prev = editHistory.current.pop();
        setPageData(prev.pageData);
        setImageUrl(prev.imageUrl);
        setCanUndo(editHistory.current.length > 0);
      }
    } finally {
      setLoading(false);
    }
  }, [fileId, pageData, imageUrl]);

  // Ctrl+Z 撤销
  const handleUndo = useCallback(async () => {
    if (!fileId || editHistory.current.length === 0) return;

    const prev = editHistory.current.pop();
    setPageData(prev.pageData);
    setImageUrl(prev.imageUrl);
    setCanUndo(editHistory.current.length > 0);
  }, [fileId]);

  // 全局键盘事件监听（Ctrl+Z）
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && canUndo) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, handleUndo]);

  // 导出 PDF
  const handleExport = async () => {
    if (!fileId) return;
    setLoading(true);
    setError(null);
    try {
      const blob = await exportPDF(fileId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'edited.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 错误显示
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
        <div className="text-red-500 mb-4">{error}</div>
        <button
          onClick={() => { setError(null); setFileId(null); setPageData(null); }}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          重新开始
        </button>
      </div>
    );
  }

  // 上传界面
  if (!pageData) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
        <h1 className="text-2xl font-bold mb-8 text-gray-800">PDF 文字编辑器</h1>
        <FileUpload onUpload={handleUpload} loading={loading} />
        {loading && <p className="mt-4 text-gray-500">正在加载...</p>}
      </div>
    );
  }

  const scale = renderHeight / pageData.pageHeight;

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Toolbar */}
      <div className="flex items-center gap-4 p-4 bg-white shadow z-20">
        <h1 className="text-lg font-semibold text-gray-800">PDF 文字编辑器</h1>
        <div className="flex-1" />
        {/* 撤销按钮 */}
        <button
          onClick={handleUndo}
          disabled={!canUndo || loading}
          className={`
            px-3 py-2 rounded font-medium
            ${!canUndo || loading ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}
          `}
          title="撤销上一次编辑 (Ctrl+Z)"
        >
          ↶ 撤销
        </button>
        <button
          onClick={handleExport}
          disabled={loading}
          className={`
            px-4 py-2 rounded font-medium
            ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'}
            text-white
          `}
        >
          {loading ? '处理中...' : '导出 PDF'}
        </button>
        <button
          onClick={() => { setFileId(null); setPageData(null); setImageUrl(null); editHistory.current = []; setCanUndo(false); }}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded"
        >
          新文件
        </button>
      </div>

      {/* PDF Canvas */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-8">
        <div
          className="relative shadow-lg bg-white"
          style={{ width: pageData.pageWidth * scale, height: renderHeight }}
        >
          {/* 底层：渲染图片 */}
          <img
            src={imageUrl}
            alt="PDF Page"
            className="absolute top-0 left-0 w-full h-full"
            draggable={false}
          />

          {/* 上层：文字覆盖 */}
          {pageData.textSpans.map((span, idx) => (
            <TextBlock
              key={`${idx}-${span.text}`}
              span={span}
              pageHeight={pageData.pageHeight}
              renderHeight={renderHeight}
              onEdit={handleEdit}
            />
          ))}
        </div>
      </div>

      {/* 提示 */}
      <div className="p-2 bg-gray-200 text-center text-sm text-gray-600">
        双击文字块编辑 · Enter 保存 · Escape 取消 · Ctrl+Z 撤销
      </div>
    </div>
  );
}

export default PDFViewer;