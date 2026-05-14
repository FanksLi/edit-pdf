import { useState, useCallback, useRef, useEffect } from 'react';
import FileUpload from './FileUpload';
import FabricCanvas from './FabricCanvas';
import { uploadPDF, getPageText, getPageRender, modifyPage, exportPDF } from '../services/api';

function PDFViewer() {
  const [fileId, setFileId] = useState(null);
  const [pageData, setPageData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [renderSize, setRenderSize] = useState({ width: 0, height: 0 });
  const [imageUrl, setImageUrl] = useState(null);

  const editHistory = useRef([]);
  const [canUndo, setCanUndo] = useState(false);

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

  const loadPage = async (fid, pageNum, knownWidth = null, knownHeight = null) => {
    try {
      const [textData, imageData] = await Promise.all([
        getPageText(fid, pageNum),
        getPageRender(fid, pageNum),
      ]);

      setImageUrl(imageData.image_url);
      setRenderSize({ width: imageData.width, height: imageData.height });

      setPageData({
        paragraphs: textData.paragraphs || [],
        images: textData.images || [],
        pageWidth: knownWidth || textData.page_width,
        pageHeight: knownHeight || textData.page_height,
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEditsReady = useCallback(async (edits) => {
    if (!fileId) return;

    editHistory.current.push({
      pageData: JSON.parse(JSON.stringify(pageData)),
      imageUrl,
    });
    setCanUndo(editHistory.current.length > 0);

    setLoading(true);
    setError(null);
    try {
      const result = await modifyPage(fileId, 0, edits.paragraph_edits, edits.image_edits);
      setImageUrl(result.image_url);
      setPageData(prev => ({
        paragraphs: result.paragraphs || [],
        images: result.images || [],
        pageWidth: prev.pageWidth,
        pageHeight: prev.pageHeight,
      }));
    } catch (err) {
      setError(err.message);
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

  const handleUndo = useCallback(async () => {
    if (!fileId || editHistory.current.length === 0) return;
    const prev = editHistory.current.pop();
    setPageData(prev.pageData);
    setImageUrl(prev.imageUrl);
    setCanUndo(editHistory.current.length > 0);
  }, [fileId]);

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

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
        <div className="text-red-500 mb-4">{error}</div>
        <button onClick={() => { setError(null); setFileId(null); setPageData(null); }} className="px-4 py-2 bg-blue-500 text-white rounded">重新开始</button>
      </div>
    );
  }

  if (!pageData) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
        <h1 className="text-2xl font-bold mb-8 text-gray-800">PDF 文字编辑器</h1>
        <FileUpload onUpload={handleUpload} loading={loading} />
        {loading && <p className="mt-4 text-gray-500">正在加载...</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="sticky top-0 z-20 flex items-center gap-4 p-4 bg-white shadow">
        <h1 className="text-lg font-semibold text-gray-800">PDF 文字编辑器</h1>
        <div className="flex-1" />
        <button onClick={handleUndo} disabled={!canUndo || loading} className={`px-3 py-2 rounded font-medium ${!canUndo || loading ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`} title="撤销 (Ctrl+Z)">↶ 撤销</button>
        <button onClick={handleExport} disabled={loading} className={`px-4 py-2 rounded font-medium text-white ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'}`}>{loading ? '处理中...' : '导出 PDF'}</button>
        <button onClick={() => { setFileId(null); setPageData(null); setImageUrl(null); setRenderSize({ width: 0, height: 0 }); editHistory.current = []; setCanUndo(false); }} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded">新文件</button>
      </div>

      <div className="flex justify-center p-8">
        <FabricCanvas
          renderSize={renderSize}
          paragraphs={pageData.paragraphs}
          images={pageData.images}
          pageHeight={pageData.pageHeight}
          onEditsReady={handleEditsReady}
        />
      </div>

      <div className="p-2 bg-gray-200 text-center text-sm text-gray-600">
        双击文字编辑 · 拖拽移动 · Enter 保存 · Escape 取消 · Ctrl+Z 撤销
      </div>
    </div>
  );
}

export default PDFViewer;
