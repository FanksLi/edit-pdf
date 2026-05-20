import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, Textbox, FabricImage, Rect } from 'fabric';
import { pdfToCanvas, canvasToPdf } from '../utils/coordinate';
import { getPageText, getPageRender } from '../services/api';

function hexToRgb(hex) {
  if (!hex || !hex.startsWith('#')) return [0, 0, 0];
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

const PageCanvas = forwardRef(function PageCanvas({ fileId, pageNum, pageWidth, pageHeight, onSelectionChange }, ref) {
  const canvasElRef = useRef(null);
  const containerRef = useRef(null);
  const fabricRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const [loaded, setLoaded] = useState(false);
  const [content, setContent] = useState(null); // { paragraphs, images, drawings }
  const [renderSize, setRenderSize] = useState(null);
  const loadRequestedRef = useRef(false);

  const DPI = 150;
  const scale = DPI / 72;

  // 计算 canvas 尺寸
  const canvasWidth = Math.round(pageWidth * scale);
  const canvasHeight = Math.round(pageHeight * scale);

  // 暴露方法
  useImperativeHandle(ref, () => ({
    collectEdits() {
      const canvas = fabricRef.current;
      if (!canvas) return { paragraph_edits: [], image_edits: [], drawing_edits: [] };

      const paragraphEdits = [];
      const imageEdits = [];
      const drawingEdits = [];

      for (const obj of canvas.getObjects()) {
        if (!obj._pdfData) continue;
        const pdf = obj._pdfData;

        if (pdf.originalText !== undefined) {
          const newBbox = canvasToPdf(obj.left, obj.top, obj.getScaledWidth(), obj.getScaledHeight(), scale);
          const textChanged = obj.text !== pdf.originalText;
          const posChanged = Math.abs(newBbox[0] - pdf.originalBbox[0]) > 0.5
            || Math.abs(newBbox[1] - pdf.originalBbox[1]) > 0.5;

          if (textChanged || posChanged) {
            const originalLines = pdf.originalText.split('\n').length;
            const currentLines = obj.text.split('\n').length;
            const lineCountDelta = currentLines - originalLines;
            const newBottom = newBbox[3];
            const oldBottom = pdf.originalBbox[3];
            const textExpandDelta = lineCountDelta * pdf.lineHeight;
            const geoDelta = newBottom - oldBottom;
            const heightDelta = posChanged
              ? Math.max(0, geoDelta, textExpandDelta)
              : textExpandDelta;

            paragraphEdits.push({
              bbox: pdf.originalBbox,
              new_bbox: posChanged ? newBbox : undefined,
              newText: obj.text,
              fontSize: pdf.originalFontSize,
              fontName: pdf.originalFontName,
              color: pdf.originalColor,
              height_delta: Math.max(0, heightDelta),
              lineHeight: pdf.lineHeight,
            });
          }
        } else if (pdf.xref !== undefined) {
          const newBbox = canvasToPdf(obj.left, obj.top, obj.getScaledWidth(), obj.getScaledHeight(), scale);
          const posChanged = newBbox.some((v, i) => Math.abs(v - pdf.originalBbox[i]) > 0.5);
          if (posChanged) {
            imageEdits.push({
              xref: pdf.xref,
              old_bbox: pdf.originalBbox,
              new_bbox: newBbox,
              image_data: '',
            });
          }
        } else if (pdf.originalRect !== undefined) {
          const newBbox = canvasToPdf(obj.left, obj.top, obj.getScaledWidth(), obj.getScaledHeight(), scale);
          const posChanged = newBbox.some((v, i) => Math.abs(v - pdf.originalRect[i]) > 0.5);
          if (posChanged) {
            drawingEdits.push({
              old_bbox: pdf.originalRect,
              new_bbox: newBbox,
              fill: pdf.fill,
              stroke: pdf.stroke,
            });
          }
        }
      }

      // 收集新增元素
      const newElements = [];
      for (const obj of canvas.getObjects()) {
        if (!obj._newElement) continue;

        const pdfBbox = canvasToPdf(obj.left, obj.top, obj.getScaledWidth(), obj.getScaledHeight(), scale);

        if (obj._elementType === 'text') {
          newElements.push({
            type: 'text',
            bbox: pdfBbox,
            text: obj.text,
            font_name: obj._elementProps?.fontFamily || 'Roboto',
            font_size: (obj._elementProps?.fontSize || obj.fontSize) / scale,
            color: hexToRgb(obj.fill),
            font_weight: obj.fontWeight === 'bold' ? 'bold' : 'normal',
            font_style: obj.fontStyle === 'italic' ? 'italic' : 'normal',
          });
        } else if (obj._elementType === 'image') {
          newElements.push({
            type: 'image',
            bbox: pdfBbox,
            image_id: obj._elementProps?.imageId,
            ext: obj._elementProps?.ext,
            opacity: obj.opacity ?? 1,
          });
        }
      }

      return {
        paragraph_edits: paragraphEdits,
        image_edits: imageEdits,
        drawing_edits: drawingEdits,
        new_elements: newElements,
      };
    },

    undo() {
      if (undoStackRef.current.length === 0) return false;
      const canvas = fabricRef.current;
      if (!canvas) return false;

      const snapshot = undoStackRef.current.pop();
      redoStackRef.current.push(_takeSnapshot(canvas));
      _restoreSnapshot(canvas, snapshot);
      return true;
    },

    redo() {
      if (redoStackRef.current.length === 0) return false;
      const canvas = fabricRef.current;
      if (!canvas) return false;

      const snapshot = redoStackRef.current.pop();
      undoStackRef.current.push(_takeSnapshot(canvas));
      _restoreSnapshot(canvas, snapshot);
      return true;
    },

    canUndo() {
      return undoStackRef.current.length > 0;
    },

    canRedo() {
      return redoStackRef.current.length > 0;
    },

    addNewText() {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const textObj = new Textbox('输入文字', {
        left: canvas.width / 2 - 100,
        top: canvas.height / 2 - 20,
        width: 200,
        fontSize: 16 * scale,
        fontFamily: 'Roboto, Arial, sans-serif',
        fill: '#000000',
        editable: true,
        originX: 'left',
        originY: 'top',
        splitByGrapheme: true,
      });
      textObj._newElement = true;
      textObj._elementType = 'text';
      textObj._elementProps = {
        fontFamily: 'Roboto',
        fontSize: 16 * scale,
      };
      canvas.add(textObj);
      canvas.setActiveObject(textObj);
      textObj.enterEditing();
      canvas.requestRenderAll();
      saveSnapshot();
    },

    async addNewImage(imageUrl, imageId, ext) {
      const canvas = fabricRef.current;
      if (!canvas) return;

      try {
        const imgObj = await FabricImage.fromURL(imageUrl);
        const maxDim = 200;
        const ratio = Math.min(maxDim / imgObj.width, maxDim / imgObj.height, 1);
        imgObj.set({
          left: canvas.width / 2 - (imgObj.width * ratio) / 2,
          top: canvas.height / 2 - (imgObj.height * ratio) / 2,
          scaleX: ratio,
          scaleY: ratio,
          originX: 'left',
          originY: 'top',
          strokeWidth: 0,
        });
        imgObj._newElement = true;
        imgObj._elementType = 'image';
        imgObj._elementProps = {
          imageId: imageId,
          ext: ext,
          opacity: 1,
          originalWidth: imgObj.width,
          originalHeight: imgObj.height,
        };
        canvas.add(imgObj);
        canvas.setActiveObject(imgObj);
        canvas.requestRenderAll();
        saveSnapshot();
      } catch (e) {
        console.error('Failed to add image:', e);
      }
    },
  }));

  const _takeSnapshot = (canvas) => {
    return canvas.getObjects()
      .filter(o => o._pdfData)
      .map(o => ({
        snapshotId: o._pdfData.snapshotId,
        left: o.left,
        top: o.top,
        scaleX: o.scaleX,
        scaleY: o.scaleY,
        angle: o.angle,
        text: o.text,
        width: o.width,
      }));
  };

  const _restoreSnapshot = (canvas, snapshot) => {
    for (const objData of snapshot) {
      const obj = canvas.getObjects().find(o => o._pdfData?.snapshotId === objData.snapshotId);
      if (!obj) continue;
      obj.set(objData);
      obj.setCoords();
    }
    canvas.requestRenderAll();
  };

  const saveSnapshot = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    undoStackRef.current.push(_takeSnapshot(canvas));
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, []);

  // IntersectionObserver 懒加载
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loaded && !loadRequestedRef.current) {
          loadRequestedRef.current = true;
          _loadContent();
        }
      },
      { rootMargin: '200px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [fileId, pageNum]);

  const _loadContent = async () => {
    try {
      const [textData, renderData] = await Promise.all([
        getPageText(fileId, pageNum),
        getPageRender(fileId, pageNum),
      ]);

      setRenderSize({ width: renderData.width, height: renderData.height });
      setContent({
        paragraphs: textData.paragraphs || [],
        images: textData.images || [],
        drawings: textData.drawings || [],
      });
      setLoaded(true);
    } catch (e) {
      console.error(`Failed to load page ${pageNum}:`, e);
    }
  };

  // 创建 Fabric canvas + 加载内容
  useEffect(() => {
    if (!loaded || !content || !renderSize) return;

    if (fabricRef.current) {
      fabricRef.current.dispose();
      fabricRef.current = null;
    }

    const canvas = new Canvas(canvasElRef.current, {
      width: renderSize.width,
      height: renderSize.height,
      selection: true,
      preserveObjectStacking: true,
      renderOnAddRemove: false,
      backgroundColor: '#ffffff',
    });
    fabricRef.current = canvas;
    undoStackRef.current = [];
    redoStackRef.current = [];

    let snapshotId = 0;

    canvas.on('object:modified', () => saveSnapshot());
    canvas.on('text:editing:exited', (e) => {
      const obj = e.target;
      if (obj._pdfData && obj.text !== obj._pdfData.originalText) {
        saveSnapshot();
      }
    });

    // 选中事件上报
    canvas.on('selection:created', (e) => {
      if (onSelectionChange) onSelectionChange(e.selected?.[0] || null, canvas);
    });
    canvas.on('selection:updated', (e) => {
      if (onSelectionChange) onSelectionChange(e.selected?.[0] || null, canvas);
    });
    canvas.on('selection:cleared', () => {
      if (onSelectionChange) onSelectionChange(null, canvas);
    });

    const loadElements = async () => {
      const elements = [];

      for (const d of (content.drawings || [])) {
        elements.push({ type: 'drawing', z_index: d.z_index, data: d });
      }
      for (const para of content.paragraphs) {
        elements.push({ type: 'text', z_index: para.z_index, data: para });
      }
      for (const img of content.images) {
        elements.push({ type: 'image', z_index: img.z_index, data: img });
      }

      elements.sort((a, b) => {
        if (a.z_index !== b.z_index) return a.z_index - b.z_index;
        const order = { drawing: 0, text: 1, image: 2 };
        return (order[a.type] || 0) - (order[b.type] || 0);
      });

      for (const el of elements) {
        const sid = ++snapshotId;
        if (el.type === 'drawing') {
          _addDrawing(canvas, el.data, sid);
        } else if (el.type === 'text') {
          _addParagraph(canvas, el.data, sid);
        } else if (el.type === 'image') {
          await _addImage(canvas, el.data, sid);
        }
      }

      canvas.requestRenderAll();
    };

    const _addDrawing = (canvas, d, sid) => {
      const pos = pdfToCanvas(d.rect, scale);
      const fill = d.fill ? `rgb(${Math.round(d.fill[0] * 255)},${Math.round(d.fill[1] * 255)},${Math.round(d.fill[2] * 255)})` : null;
      const stroke = d.stroke ? `rgb(${Math.round(d.stroke[0] * 255)},${Math.round(d.stroke[1] * 255)},${Math.round(d.stroke[2] * 255)})` : null;
      const rect = new Rect({
        left: pos.left, top: pos.top, width: pos.width, height: pos.height,
        fill, stroke, strokeWidth: 0, originX: 'left', originY: 'top',
      });
      rect._pdfData = { snapshotId: sid, originalRect: [...d.rect], fill: d.fill, stroke: d.stroke };
      canvas.add(rect);
    };

    const _addParagraph = (canvas, para, sid) => {
      const pos = pdfToCanvas(para.bbox, scale);
      const r = Math.round(para.color[0] * 255);
      const g = Math.round(para.color[1] * 255);
      const b = Math.round(para.color[2] * 255);
      const numLines = para.text.split('\n').length;
      const lineHeightRatio = numLines > 1
        ? pos.height / (numLines * para.fontSize * scale)
        : 1.2;

      const textObj = new Textbox(para.text, {
        left: pos.left, top: pos.top, width: pos.width * 1.07,
        fontSize: para.fontSize * scale, lineHeight: lineHeightRatio,
        fill: `rgb(${r},${g},${b})`, fontFamily: 'Helvetica, Arial, sans-serif',
        editable: true, originX: 'left', originY: 'top', splitByGrapheme: true,
      });
      textObj._pdfData = {
        snapshotId: sid, originalBbox: [...para.bbox], originalFontSize: para.fontSize,
        originalFontName: para.fontName, originalText: para.text,
        originalColor: [...para.color], originalHeight: para.bbox[3] - para.bbox[1],
        lineHeight: para.lineHeight,
      };
      canvas.add(textObj);
    };

    const _addImage = async (canvas, img, sid) => {
      try {
        const pos = pdfToCanvas(img.bbox, scale);
        const imgObj = await FabricImage.fromURL(img.image_url);
        imgObj.set({ left: pos.left, top: pos.top, originX: 'left', originY: 'top', strokeWidth: 0 });
        imgObj.scaleX = pos.width / imgObj.width;
        imgObj.scaleY = pos.height / imgObj.height;
        imgObj._pdfData = { snapshotId: sid, xref: img.xref, originalBbox: [...img.bbox], imageUrl: img.image_url };
        canvas.add(imgObj);
      } catch (e) {
        console.error('Failed to load image:', e);
      }
    };

    loadElements();

    return () => {
      canvas.off('selection:created');
      canvas.off('selection:updated');
      canvas.off('selection:cleared');
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
  }, [loaded, content, renderSize, saveSnapshot]);

  return (
    <div
      ref={containerRef}
      data-page={pageNum}
      className="relative bg-white shadow-md"
      style={{ width: canvasWidth, height: canvasHeight, margin: '0 auto' }}
    >
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
          加载中...
        </div>
      ) : (
        <canvas ref={canvasElRef} />
      )}
    </div>
  );
});

export default PageCanvas;
