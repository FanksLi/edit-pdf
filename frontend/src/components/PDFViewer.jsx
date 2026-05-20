import { useState, useCallback, useRef, useEffect } from 'react';
import FileUpload from './FileUpload';
import PageCanvas from './PageCanvas';
import PageSidebar from './PageSidebar';
import { uploadPDF, exportAllPages } from '../services/api';

function PDFViewer() {
  const [fileId, setFileId] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageSizes, setPageSizes] = useState([]); // [{width, height}, ...]
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pageRefs = useRef({}); // pageNum → ref
  const scrollContainerRef = useRef(null);
  const visiblePageRef = useRef(0);

  const handleUpload = async (file) => {
    setLoading(true);
    setError(null);
    try {
      const result = await uploadPDF(file);
      setFileId(result.file_id);
      setPageCount(result.page_count);

      // 单页时用返回的尺寸，多页时先占位
      if (result.page_count === 1) {
        setPageSizes([{ width: result.page_width, height: result.page_height }]);
      } else {
        // 先用首页尺寸占位，后续懒加载时会更新
        const sizes = Array.from({ length: result.page_count }, () => ({
          width: result.page_width,
          height: result.page_height,
        }));
        setPageSizes(sizes);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 追踪当前可见页（IntersectionObserver）
  useEffect(() => {
    if (!fileId || pageCount === 0) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const pages = container.querySelectorAll('[data-page]');
    if (pages.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // 找到可见面积最大的页面
        let maxRatio = 0;
        let mostVisible = visiblePageRef.current;

        for (const entry of entries) {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            mostVisible = parseInt(entry.target.dataset.page, 10);
          }
        }

        if (mostVisible !== visiblePageRef.current) {
          visiblePageRef.current = mostVisible;
          setCurrentPage(mostVisible);
        }
      },
      { root: container, threshold: 0.3 }
    );

    pages.forEach(p => observer.observe(p));
    return () => observer.disconnect();
  }, [fileId, pageCount, pageSizes]);

  // 定期同步 undo/redo 状态
  useEffect(() => {
    const interval = setInterval(() => {
      const ref = pageRefs.current[visiblePageRef.current];
      if (ref) {
        setCanUndo(ref.canUndo());
        setCanRedo(ref.canRedo());
      }
    }, 300);
    return () => clearInterval(interval);
  }, []);

  // 快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'y'))) {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        scrollToPage(Math.min(visiblePageRef.current + 1, pageCount - 1));
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        scrollToPage(Math.max(visiblePageRef.current - 1, 0));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pageCount]);

  const handleUndo = useCallback(() => {
    const ref = pageRefs.current[visiblePageRef.current];
    if (ref) {
      ref.undo();
      setCanUndo(ref.canUndo());
      setCanRedo(ref.canRedo());
    }
  }, []);

  const handleRedo = useCallback(() => {
    const ref = pageRefs.current[visiblePageRef.current];
    if (ref) {
      ref.redo();
      setCanUndo(ref.canUndo());
      setCanRedo(ref.canRedo());
    }
  }, []);

  const scrollToPage = useCallback((pageNum) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-page="${pageNum}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleExport = async () => {
    if (!fileId) return;
    setLoading(true);
    setError(null);
    try {
      // 收集所有页的 edits
      const pagesEdits = {};
      for (let i = 0; i < pageCount; i++) {
        const ref = pageRefs.current[i];
        if (ref) {
          const edits = ref.collectEdits();
          if (edits.paragraph_edits.length > 0 || edits.image_edits.length > 0 || edits.drawing_edits.length > 0) {
            pagesEdits[String(i)] = edits;
          }
        }
      }

      const blob = await exportAllPages(fileId, pagesEdits);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      a.download = `edited_${ts}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFileId(null);
    setPageCount(0);
    setPageSizes([]);
    setCurrentPage(0);
    pageRefs.current = {};
    visiblePageRef.current = 0;
    setError(null);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
        <div className="text-red-500 mb-4">{error}</div>
        <button onClick={handleReset} className="px-4 py-2 bg-blue-500 text-white rounded">重新开始</button>
      </div>
    );
  }

  if (!fileId) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
        <h1 className="text-2xl font-bold mb-8 text-gray-800">PDF 文字编辑器</h1>
        <FileUpload onUpload={handleUpload} loading={loading} />
        {loading && <p className="mt-4 text-gray-500">正在加载...</p>}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* 顶部工具栏 */}
      <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-2 bg-white shadow">
        <h1 className="text-lg font-semibold text-gray-800 hidden sm:block">PDF 编辑器</h1>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>第 {currentPage + 1} / {pageCount} 页</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={handleUndo}
          disabled={!canUndo || loading}
          className={`px-3 py-1.5 rounded text-sm font-medium ${!canUndo || loading ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
          title="撤销 (Ctrl+Z)"
        >
          ↶ 撤销
        </button>
        <button
          onClick={handleRedo}
          disabled={!canRedo || loading}
          className={`px-3 py-1.5 rounded text-sm font-medium ${!canRedo || loading ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
          title="重做 (Ctrl+Shift+Z)"
        >
          ↷ 重做
        </button>
        <button
          onClick={handleExport}
          disabled={loading}
          className={`px-4 py-1.5 rounded text-sm font-medium text-white ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'}`}
        >
          {loading ? '处理中...' : '导出 PDF'}
        </button>
        <button
          onClick={handleReset}
          className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-sm"
        >
          新文件
        </button>
      </div>

      {/* 主体：侧边栏 + 滚动区域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 侧边栏（内部响应式：PC 左侧 / 手机底部） */}
        <PageSidebar
          fileId={fileId}
          pageCount={pageCount}
          currentPage={currentPage}
          onPageClick={scrollToPage}
        />

        {/* 页面滚动容器 */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4 md:space-y-6 md:pb-8 pb-24"
        >
          {pageSizes.map((size, i) => (
            <div key={i} className="flex justify-center">
              <PageCanvas
                ref={el => { if (el) pageRefs.current[i] = el; }}
                fileId={fileId}
                pageNum={i}
                pageWidth={size.width}
                pageHeight={size.height}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default PDFViewer;
