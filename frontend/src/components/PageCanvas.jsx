import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, FabricImage, Rect } from 'fabric';
import { pdfToCanvas, canvasToPdf } from '../utils/coordinate';
import { getPageText, getPageRender } from '../services/api';

function hexToRgb(hex) {
  if (!hex || !hex.startsWith('#')) return [0, 0, 0];
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

const FONT_MAP = {
  'LiberationSerif': "'Liberation_Serif'",
  'LiberationSans': "'Liberation_Sans'",
  'Arimo': "'Arimo'",
  'Caladea': "'Caladea'",
  'Carlito': "'Carlito'",
  'Cousine': "'Cousine'",
  'Roboto': "'Roboto'",
  'Tinos': "'Tinos'",
  'SimHei': "'SimHei'",
  'OpenSans': "'Open_Sans'",
  'RobotoMono': "'Roboto_Mono'",
};

function resolvePdfFont(pdfFontName) {
  const base = pdfFontName.replace(/-(BoldItalic|Bold|Italic)$/, '');
  const cssFamily = FONT_MAP[base] || "'Liberation_Serif'";
  const isBold = pdfFontName.includes('Bold');
  const isItalic = pdfFontName.includes('Italic');
  return {
    fontFamily: `${cssFamily}, 'Liberation_Serif', serif`,
    fontWeight: isBold ? 'bold' : 'normal',
    fontStyle: isItalic ? 'italic' : 'normal',
  };
}

const PageCanvas = forwardRef(function PageCanvas({ fileId, pageNum, pageWidth, pageHeight, onSelectionChange, hideBackground }, ref) {
  const canvasElRef = useRef(null);
  const containerRef = useRef(null);
  const fabricRef = useRef(null);
  const textElsRef = useRef({});
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const [loaded, setLoaded] = useState(false);
  const [content, setContent] = useState(null);
  const [renderSize, setRenderSize] = useState(null);
  const [renderImageUrl, setRenderImageUrl] = useState(null);
  const [textElements, setTextElements] = useState([]);
  const loadRequestedRef = useRef(false);
  const dragRef = useRef(null); // { id, startX, startY, origLeft, origTop }

  const DPI = 150;
  const scale = DPI / 72;

  const canvasWidth = Math.round(pageWidth * scale);
  const canvasHeight = Math.round(pageHeight * scale);

  useImperativeHandle(ref, () => ({
    collectEdits() {
      const canvas = fabricRef.current;
      const paragraphEdits = [];
      const imageEdits = [];
      const drawingEdits = [];

      // 收集文字编辑
      for (const el of textElements) {
        const div = textElsRef.current[el.id];
        if (!div) continue;

        const newText = div.innerText || '';
        const textChanged = newText !== el.originalText;
        const posChanged = Math.abs(el.left - el.originalLeft) > 1 || Math.abs(el.top - el.originalTop) > 1;

        if (textChanged || posChanged) {
          let newBbox = undefined;
          if (posChanged) {
            newBbox = canvasToPdf(el.left, el.top, el.width, el.height, scale);
          }
          paragraphEdits.push({
            bbox: el.originalBbox,
            new_bbox: newBbox,
            newText: textChanged ? newText : el.originalText,
            fontSize: el.fontSize,
            fontName: el.fontName,
            color: el.color,
            height_delta: 0,
            lineHeight: el.lineHeight,
            textAlign: el.textAlign || 'left',
          });
        }
      }

      // 收集图片/绘图编辑
      if (canvas) {
        for (const obj of canvas.getObjects()) {
          if (!obj._pdfData) continue;
          const pdf = obj._pdfData;

          if (pdf.xref !== undefined) {
            const newBbox = canvasToPdf(obj.left, obj.top, obj.getScaledWidth(), obj.getScaledHeight(), scale);
            const posChanged = newBbox.some((v, i) => Math.abs(v - pdf.originalBbox[i]) > 0.5);
            if (posChanged) {
              imageEdits.push({
                xref: pdf.xref,
                old_bbox: pdf.originalBbox,
                new_bbox: newBbox,
                image_data: '',
                angle: obj.angle || 0,
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
      }

      return { paragraph_edits: paragraphEdits, image_edits: imageEdits, drawing_edits: drawingEdits, new_elements: [] };
    },

    undo() {
      if (undoStackRef.current.length === 0) return false;
      const snapshot = undoStackRef.current.pop();
      redoStackRef.current.push(_takeTextSnapshot());
      _restoreTextSnapshot(snapshot);
      return true;
    },

    redo() {
      if (redoStackRef.current.length === 0) return false;
      const snapshot = redoStackRef.current.pop();
      undoStackRef.current.push(_takeTextSnapshot());
      _restoreTextSnapshot(snapshot);
      return true;
    },

    canUndo() {
      return undoStackRef.current.length > 0;
    },

    canRedo() {
      return redoStackRef.current.length > 0;
    },

    addNewText() {
      const id = `new-${Date.now()}`;
      const left = canvasWidth / 2 - 100;
      const top = canvasHeight / 2 - 20;
      const newEl = {
        id,
        left,
        top,
        originalLeft: left,
        originalTop: top,
        width: 200,
        height: 40,
        text: '输入文字',
        originalText: '输入文字',
        fontSize: 16,
        fontFamily: 'Roboto, Arial, sans-serif',
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: [0, 0, 0],
        lineHeight: 1.2,
        isNew: true,
      };
      setTextElements(prev => [...prev, newEl]);
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
        canvas.add(imgObj);
        canvas.setActiveObject(imgObj);
        canvas.requestRenderAll();
        saveSnapshot();
      } catch (e) {
        console.error('Failed to add image:', e);
      }
    },
  }));

  const _takeTextSnapshot = () => {
    return textElements.map(el => {
      const div = textElsRef.current[el.id];
      return {
        id: el.id,
        text: div?.innerText || el.text,
      };
    });
  };

  const _restoreTextSnapshot = (snapshot) => {
    for (const snap of snapshot) {
      const div = textElsRef.current[snap.id];
      if (div && div.innerText !== snap.text) {
        div.innerText = snap.text;
      }
    }
  };

  const saveSnapshot = useCallback(() => {
    undoStackRef.current.push(_takeTextSnapshot());
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, [textElements]);

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
      setRenderImageUrl(renderData.image_url);
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

  // 创建 Fabric canvas + 加载图片/绘图
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

    canvas.on('object:modified', () => {
      saveSnapshot();
      const active = canvas.getActiveObject();
      if (active && onSelectionChange) onSelectionChange(active, canvas);
    });

    canvas.on('selection:created', (e) => {
      const obj = e.selected?.[0];
      if (onSelectionChange) onSelectionChange(obj || null, canvas);
    });
    canvas.on('selection:updated', (e) => {
      if (onSelectionChange) onSelectionChange(e.selected?.[0] || null, canvas);
    });
    canvas.on('selection:cleared', () => {
      if (onSelectionChange) onSelectionChange(null, canvas);
    });

    const loadElements = async () => {
      await document.fonts.ready;

      if (renderImageUrl && !hideBackground) {
        try {
          const bgImg = await FabricImage.fromURL(renderImageUrl);
          bgImg.set({
            left: 0, top: 0,
            originX: 'left', originY: 'top',
            scaleX: canvas.width / bgImg.width,
            scaleY: canvas.height / bgImg.height,
          });
          canvas.backgroundImage = bgImg;
        } catch (e) {
          console.error('Failed to load background:', e);
        }
      }

      const elements = [];

      for (const d of (content.drawings || [])) {
        elements.push({ type: 'drawing', z_index: d.z_index, data: d });
      }
      for (const img of content.images) {
        elements.push({ type: 'image', z_index: img.z_index, data: img });
      }

      elements.sort((a, b) => a.z_index - b.z_index);

      for (const el of elements) {
        const sid = ++snapshotId;
        if (el.type === 'drawing') {
          _addDrawing(canvas, el.data, sid);
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
        opacity: 0.3,
      });
      rect._pdfData = { snapshotId: sid, originalRect: [...d.rect], fill: d.fill, stroke: d.stroke };
      canvas.add(rect);
    };

    const _addImage = async (canvas, img, sid) => {
      try {
        const pos = pdfToCanvas(img.bbox, scale);
        const imgObj = await FabricImage.fromURL(img.image_url);
        imgObj.set({ left: pos.left, top: pos.top, originX: 'left', originY: 'top', strokeWidth: 0, opacity: 0.3 });
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
  }, [loaded, content, renderSize, renderImageUrl, saveSnapshot]);

  // 构建文字 HTML 元素
  useEffect(() => {
    if (!loaded || !content) return;

    const paragraphs = content.paragraphs || [];
    const elements = paragraphs.map((para, idx) => {
      const pos = pdfToCanvas(para.bbox, scale);
      const fontProps = resolvePdfFont(para.fontName);
      const r = Math.round(para.color[0] * 255);
      const g = Math.round(para.color[1] * 255);
      const b = Math.round(para.color[2] * 255);
      const cleanText = para.text.split('\n')
        .map(l => l.replace(/[\s\u00A0\u200B-\u200F\u2028-\u202F\uFEFF]+$/g, '').trim())
        .map(l => l.replace(/\s{2,}/g, ' '))
        .filter(l => l.length > 0)
        .join('\n');

      const numLines = cleanText.split('\n').length;
      let lineHeightRatio = 1.2;
      if (numLines > 1) {
        lineHeightRatio = pos.height / (numLines * para.fontSize * scale);
        if (lineHeightRatio < 0.8 || lineHeightRatio > 3.0) lineHeightRatio = 1.2;
      }

      return {
        id: `para-${idx}`,
        left: pos.left,
        top: pos.top,
        originalLeft: pos.left,
        originalTop: pos.top,
        width: pos.width,
        height: pos.height,
        text: cleanText,
        originalText: cleanText,
        fontSize: para.fontSize * scale,
        fontFamily: fontProps.fontFamily,
        fontWeight: fontProps.fontWeight,
        fontStyle: fontProps.fontStyle,
        color: [r, g, b],
        lineHeight: lineHeightRatio,
        originalBbox: [...para.bbox],
        textAlign: para.textAlign || 'left',
        isNew: false,
      };
    });

    setTextElements(elements);
  }, [loaded, content]);

  const handleDragStart = (e, elId) => {
    e.preventDefault();
    e.stopPropagation();
    const el = textElements.find(x => x.id === elId);
    if (!el) return;
    dragRef.current = {
      id: elId,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: el.left,
      origTop: el.top,
    };

    const onMouseMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      const newLeft = d.origLeft + dx;
      const newTop = d.origTop + dy;
      setTextElements(prev => prev.map(x =>
        x.id === d.id ? { ...x, left: newLeft, top: newTop } : x
      ));
    };

    const onMouseUp = () => {
      dragRef.current = null;
      saveSnapshot();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleTextFocus = (elId) => {
    if (onSelectionChange) {
      const el = textElements.find(e => e.id === elId);
      if (el) onSelectionChange({ type: 'text', _pdfData: el }, null);
    }
  };

  const handleTextBlur = (elId) => {
    const div = textElsRef.current[elId];
    const el = textElements.find(e => e.id === elId);
    if (!div || !el) return;

    if (div.innerText !== el.originalText) {
      saveSnapshot();
    }
  };

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
        <>
          <canvas ref={canvasElRef} />
          {textElements.map(el => (
            <div
              key={el.id}
              style={{
                position: 'absolute',
                left: el.left,
                top: el.top,
                width: el.width,
                height: el.height,
                zIndex: 10,
              }}
            >
              <div
                onMouseDown={(e) => handleDragStart(e, el.id)}
                style={{
                  position: 'absolute',
                  top: -4,
                  left: 0,
                  right: 0,
                  height: 6,
                  cursor: 'move',
                  zIndex: 11,
                }}
              />
              <div
                ref={d => { if (d) textElsRef.current[el.id] = d; }}
                contentEditable
                suppressContentEditableWarning
                style={{
                  display: 'inline-block',
                  minWidth: '10px',
                  minHeight: '100%',
                  fontSize: el.fontSize,
                  fontFamily: el.fontFamily,
                  fontWeight: el.fontWeight,
                  fontStyle: el.fontStyle,
                  lineHeight: el.lineHeight,
                  textAlign: el.textAlign || 'left',
                  color: `rgb(${el.color[0]},${el.color[1]},${el.color[2]})`,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  padding: 0,
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
                onFocus={() => handleTextFocus(el.id)}
                onBlur={() => handleTextBlur(el.id)}
              >{el.text}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
});

export default PageCanvas;