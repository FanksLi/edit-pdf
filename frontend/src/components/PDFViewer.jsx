import { useState, useCallback, useRef, useEffect } from 'react';
import FileUpload from './FileUpload';
import FabricCanvas from './FabricCanvas';
import PageSidebar from './PageSidebar';
import Toolbar from './Toolbar';
import { uploadPDF, exportAllPages, getFonts, uploadImage } from '../services/api';
import useCanvasStore from '../stores/canvasStore';

function PDFViewer() {
  const [fileId, setFileId] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageSizes, setPageSizes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [selectionSnapshot, setSelectionSnapshot] = useState(null);
  const [fonts, setFonts] = useState([]);

  const selectedObjRef = useRef(null);
  const activeCanvasRef = useRef(null);
  const pageRefs = useRef({});
  const scrollContainerRef = useRef(null);
  const visiblePageRef = useRef(0);

  // zustand store
  const setStoreFileId = useCanvasStore(state => state.setFileId);
  const clearPages = useCanvasStore(state => state.clearPages);
  const setCurrentPageInStore = useCanvasStore(state => state.setCurrentPage);
  const updateObject = useCanvasStore(state => state.updateObject);

  // zundo temporal - undo/redo
  // temporal 是一个独立的 zustand store
  const temporalStore = useCanvasStore.temporal;
  const undo = temporalStore.getState().undo;
  const redo = temporalStore.getState().redo;
  const clear = temporalStore.getState().clear;

  // 使用 useState 来追踪 pastStates/futureStates 长度变化
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // 监听 temporal store 变化
  useEffect(() => {
    const unsubscribe = temporalStore.subscribe((state) => {
      setCanUndo(state.pastStates.length > 0);
      setCanRedo(state.futureStates.length > 0);
    });
    // 初始化时也检查一次
    const state = temporalStore.getState();
    setCanUndo(state.pastStates.length > 0);
    setCanRedo(state.futureStates.length > 0);
    return unsubscribe;
  }, [temporalStore]);

  const handleUpload = async (file) => {
    setLoading(true);
    setError(null);
    try {
      const result = await uploadPDF(file);
      setFileId(result.file_id);
      setPageCount(result.page_count);

      if (result.page_count === 1) {
        setPageSizes([{ width: result.page_width, height: result.page_height }]);
      } else {
        const sizes = Array.from({ length: result.page_count }, () => ({
          width: result.page_width,
          height: result.page_height,
        }));
        setPageSizes(sizes);
      }

      // 初始化 zustand store
      setStoreFileId(result.file_id);
      clear(); // 清空历史记录
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 追踪当前可见页
  useEffect(() => {
    if (!fileId || pageCount === 0) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const pages = container.querySelectorAll('[data-page]');
    if (pages.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
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
          setCurrentPageInStore(mostVisible);
        }
      },
      { root: container, threshold: 0.3 }
    );

    pages.forEach(p => observer.observe(p));
    return () => observer.disconnect();
  }, [fileId, pageCount, pageSizes, setCurrentPageInStore]);

  const handleUndo = useCallback(() => {
    undo();
  }, [undo]);

  const handleRedo = useCallback(() => {
    redo();
  }, [redo]);

  const scrollToPage = useCallback((pageNum) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-page="${pageNum}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
  }, [pageCount, handleUndo, handleRedo, scrollToPage]);

  const _buildSnapshot = (obj) => {
    const isPdfText = obj.type === 'PdfText' || obj.constructor?.type === 'PdfText';
    return {
      type: isPdfText ? 'PdfText' : obj.type,
      text: isPdfText ? obj.getText() : obj.text,
      fontSize: obj.fontSize,
      fontFamily: obj.fontFamily,
      fontWeight: obj.fontWeight,
      fontStyle: obj.fontStyle,
      fill: isPdfText ? obj.color : obj.fill,
      textAlign: obj.textAlign,
      opacity: obj.opacity,
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      angle: obj.angle,
      width: obj.width,
      _newElement: obj._pdfData?.isNew || obj._newElement,
      _elementType: obj._elementType,
      _elementProps: obj._elementProps ? { ...obj._elementProps } : null,
      _originalFontName: obj._pdfData?.originalFontName || null,
    };
  };

  const handleSelectionChange = useCallback((obj, canvas) => {
    selectedObjRef.current = obj;
    activeCanvasRef.current = canvas;
    if (obj) {
      setSelectionSnapshot(_buildSnapshot(obj));
    } else {
      setSelectionSnapshot(null);
    }
  }, []);

  // 加载字体列表
  useEffect(() => {
    if (!fileId) return;
    getFonts().then(setFonts).catch(console.error);
  }, [fileId]);

  const handleAddText = useCallback(() => {
    const ref = pageRefs.current[visiblePageRef.current];
    if (ref) ref.addNewText();
  }, []);

  const handleAddImage = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ref = pageRefs.current[visiblePageRef.current];
    if (!ref || !fileId) return;

    try {
      const result = await uploadImage(fileId, file);
      const imageUrl = `/images/${fileId}_${result.image_id}${result.ext}`;
      ref.addNewImage(imageUrl, result.image_id, result.ext);
    } catch (err) {
      console.error('Upload image failed:', err);
    }

    e.target.value = '';
  }, [fileId]);

  const handleDelete = useCallback(() => {
    const obj = selectedObjRef.current;
    const canvas = activeCanvasRef.current;
    if (!obj || !canvas) return;
    canvas.remove(obj);
    canvas.requestRenderAll();
    selectedObjRef.current = null;
    activeCanvasRef.current = null;
    setSelectionSnapshot(null);
  }, []);

  const handlePropertyChange = useCallback((prop, value) => {
    const obj = selectedObjRef.current;
    const canvas = activeCanvasRef.current;
    if (!obj || !canvas) return;

    if (obj.updateProperty) {
      obj.updateProperty(prop, value);
    } else {
      if (prop === 'fontFamily') {
        obj.set('fontFamily', `${value}, Arial, sans-serif`);
        if (obj._elementProps) {
          obj._elementProps = { ...obj._elementProps, fontFamily: value };
        }
      } else if (prop === 'fontSize') {
        obj.set('fontSize', value);
        if (obj._elementProps) {
          obj._elementProps = { ...obj._elementProps, fontSize: value };
        }
      } else {
        obj.set(prop, value);
      }
    }

    if (obj._pdfData) obj._pdfData._edited = true;

    // 属性修改后更新 zustand 状态
    const objId = obj._pdfData?.id || obj._newId;
    if (objId) {
      const isPdfText = obj.type === 'PdfText' || obj.constructor?.type === 'PdfText';
      const updates = {
        left: obj.left,
        top: obj.top,
        width: obj.width,
        height: obj.height,
      };
      // 添加属性特定的更新
      if (isPdfText) {
        if (prop === 'fontFamily') updates.fontFamily = obj.fontFamily;
        else if (prop === 'fontSize') updates.fontSize = obj.fontSize;
        else if (prop === 'fontWeight') updates.fontWeight = value;
        else if (prop === 'fontStyle') updates.fontStyle = value;
        else if (prop === 'fill') updates.color = value;
        else if (prop === 'textAlign') updates.textAlign = value;
      }
      updateObject(visiblePageRef.current, objId, updates);
    }

    canvas.requestRenderAll();
    setSelectionSnapshot(_buildSnapshot(obj));
  }, [updateObject]);

  const handleExport = async () => {
    if (!fileId) return;
    setLoading(true);
    setError(null);
    try {
      const pagesEdits = {};
      for (let i = 0; i < pageCount; i++) {
        const ref = pageRefs.current[i];
        if (ref) {
          const edits = ref.collectEdits();
          if (edits.paragraph_edits.length > 0 || edits.image_edits.length > 0 || edits.drawing_edits.length > 0 || (edits.new_elements && edits.new_elements.length > 0)) {
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
    clearPages();
    clear(); // 清空历史记录
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

      {/* 操作栏 */}
      <Toolbar
        selectionSnapshot={selectionSnapshot}
        fonts={fonts}
        onAddText={handleAddText}
        onAddImage={handleAddImage}
        onDelete={handleDelete}
        onPropertyChange={handlePropertyChange}
      />

      {/* 主体：侧边栏 + 滚动区域 */}
      <div className="flex flex-1 overflow-hidden">
        <PageSidebar
          fileId={fileId}
          pageCount={pageCount}
          currentPage={currentPage}
          onPageClick={scrollToPage}
        />

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4 md:space-y-6 md:pb-8 pb-24"
        >
          {pageSizes.map((size, i) => (
            <div key={i} className="flex justify-center">
              <FabricCanvas
                ref={el => { if (el) pageRefs.current[i] = el; }}
                fileId={fileId}
                pageNum={i}
                pageWidth={size.width}
                pageHeight={size.height}
                onSelectionChange={handleSelectionChange}
                hideBackground
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default PDFViewer;
