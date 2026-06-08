import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, FabricImage, Rect } from 'fabric';
import PdfTextObject from '../objects/PdfTextObject';
import { pdfToCanvas, canvasToPdf } from '../utils/coordinate';
import { getPageText, getPageRender } from '../services/api';

const FONT_MAP = {
  LiberationSerif: "'Liberation_Serif'",
  LiberationSans: "'Liberation_Sans'",
  Arimo: "'Arimo'",
  Caladea: "'Caladea'",
  Carlito: "'Carlito'",
  Cousine: "'Cousine'",
  Roboto: "'Roboto'",
  Tinos: "'Tinos'",
  SimHei: "'SimHei'",
  OpenSans: "'Open_Sans'",
  RobotoMono: "'Roboto_Mono'",
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

const DPI = 150;
const SCALE = DPI / 72;

const FabricCanvas = forwardRef(function FabricCanvas(
  { fileId, pageNum, pageWidth, pageHeight, onSelectionChange, hideBackground },
  ref
) {
  const containerRef = useRef(null);
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const textLayerRef = useRef(null);
  const contentRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const loadRequestedRef = useRef(false);

  const [loaded, setLoaded] = useState(false);
  const [renderSize, setRenderSize] = useState(null);

  const canvasWidth = Math.round(pageWidth * SCALE);
  const canvasHeight = Math.round(pageHeight * SCALE);

  // ─── Snapshot ───

  const _takeSnapshot = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return [];
    return canvas.getObjects()
      .filter(o => o._pdfData)
      .map(o => ({
        id: o._pdfData.id,
        left: o.left,
        top: o.top,
        scaleX: o.scaleX,
        scaleY: o.scaleY,
        width: o.width,
        text: o instanceof PdfTextObject ? o.getText() : undefined,
      }));
  }, []);

  const _restoreSnapshot = useCallback((snapshot) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    for (const snap of snapshot) {
      const obj = canvas.getObjects().find(o => o._pdfData?.id === snap.id);
      if (!obj) continue;
      obj.set({ left: snap.left, top: snap.top, scaleX: snap.scaleX, scaleY: snap.scaleY });
      if (obj instanceof PdfTextObject && snap.text !== undefined) {
        obj.text = snap.text;
        if (obj._textElement) obj._textElement.innerText = snap.text;
      }
      obj.setCoords();
      if (obj.syncToDOM) obj.syncToDOM();
    }
    canvas.requestRenderAll();
  }, []);

  const saveSnapshot = useCallback(() => {
    undoStackRef.current.push(_takeSnapshot());
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, [_takeSnapshot]);

  // ─── Imperative API ───

  useImperativeHandle(ref, () => ({
    collectEdits() {
      const canvas = fabricRef.current;
      if (!canvas) return { paragraph_edits: [], image_edits: [], drawing_edits: [], new_elements: [] };

      const paragraphEdits = [];
      const imageEdits = [];
      const drawingEdits = [];

      for (const obj of canvas.getObjects()) {
        if (!obj._pdfData) continue;
        const pdf = obj._pdfData;

        if (obj instanceof PdfTextObject) {
          const currentText = obj.getText();
          const b = obj.getBounding();
          const newBbox = canvasToPdf(b.left, b.top, b.width, b.height, SCALE);
          const textChanged = currentText !== pdf.originalText;
          const posChanged = Math.abs(newBbox[0] - pdf.originalBbox[0]) > 0.5
            || Math.abs(newBbox[1] - pdf.originalBbox[1]) > 0.5;

          if (textChanged || posChanged) {
            const originalLines = pdf.originalText.split('\n').length;
            const currentLines = currentText.split('\n').length;
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
              newText: currentText,
              fontSize: pdf.originalFontSize,
              fontName: pdf.originalFontName,
              color: pdf.originalColor,
              height_delta: Math.max(0, heightDelta),
              lineHeight: pdf.lineHeight,
            });
          }
        } else if (pdf.xref !== undefined) {
          const newBbox = canvasToPdf(obj.left, obj.top, obj.getScaledWidth(), obj.getScaledHeight(), SCALE);
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
          const newBbox = canvasToPdf(obj.left, obj.top, obj.getScaledWidth(), obj.getScaledHeight(), SCALE);
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

      return { paragraph_edits: paragraphEdits, image_edits: imageEdits, drawing_edits: drawingEdits, new_elements: [] };
    },

    undo() {
      if (undoStackRef.current.length === 0) return false;
      const snap = undoStackRef.current.pop();
      redoStackRef.current.push(_takeSnapshot());
      _restoreSnapshot(snap);
      return true;
    },

    redo() {
      if (redoStackRef.current.length === 0) return false;
      const snap = redoStackRef.current.pop();
      undoStackRef.current.push(_takeSnapshot());
      _restoreSnapshot(snap);
      return true;
    },

    canUndo() { return undoStackRef.current.length > 0; },
    canRedo() { return redoStackRef.current.length > 0; },

    addNewText() {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const id = `new-${Date.now()}`;
      const left = canvasWidth / 2 - 100;
      const top = canvasHeight / 2 - 20;

      const textObj = new PdfTextObject({
        left, top, width: 200, height: 40,
        text: '输入文字',
        fontSize: 16,
        fontFamily: "'Roboto', Arial, sans-serif",
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#000000',
        lineHeight: 1.2,
        _pdfData: {
          id,
          originalBbox: canvasToPdf(left, top, 200, 40, SCALE),
          originalText: '输入文字',
          originalFontSize: 12,
          originalFontName: 'Roboto',
          originalColor: [0, 0, 0],
          lineHeight: 14,
          isNew: true,
        },
      });
      canvas.add(textObj);

      // DOM element
      const div = _createTextDiv({
        left, top, width: 200, height: 40,
        text: '输入文字',
        fontSize: 16,
        fontFamily: "'Roboto', Arial, sans-serif",
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#000000',
        lineHeight: 1.2,
      });
      textLayerRef.current.appendChild(div);
      textObj.bindElement(div);
      _attachTextEvents(textObj, div);

      canvas.setActiveObject(textObj);
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
        canvas.add(imgObj);
        canvas.setActiveObject(imgObj);
        canvas.requestRenderAll();
        saveSnapshot();
      } catch (e) {
        console.error('Failed to add image:', e);
      }
    },
  }));

  // ─── DOM helpers ───

  const _createTextDiv = ({ left, top, width, height, text, fontSize, fontFamily, fontWeight, fontStyle, color, lineHeight }) => {
    const div = document.createElement('div');
    Object.assign(div.style, {
      position: 'absolute',
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: height ? `${height}px` : undefined,
      minWidth: '10px',
      fontSize: `${fontSize}px`,
      fontFamily,
      fontWeight,
      fontStyle,
      lineHeight: String(lineHeight),
      color,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      padding: '0',
      margin: '0',
      whiteSpace: 'pre',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: '1',
    });
    div.innerText = text;
    return div;
  };

  const _attachTextEvents = (textObj, div) => {
    div.addEventListener('blur', () => {
      if (textObj._editing) {
        textObj.exitEditing();
        saveSnapshot();
        const canvas = fabricRef.current;
        if (canvas) canvas.requestRenderAll();
      }
    });

    div.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && textObj._editing) {
        e.preventDefault();
        div.blur();
        return;
      }
      // Sync height after key input (Enter, Backspace, etc.)
      requestAnimationFrame(() => textObj.syncHeight());
    });

    div.addEventListener('input', () => {
      requestAnimationFrame(() => textObj.syncHeight());
    });
  };

  // ─── Lazy loading ───

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
      contentRef.current = {
        paragraphs: textData.paragraphs || [],
        images: textData.images || [],
        drawings: textData.drawings || [],
        renderImageUrl: renderData.image_url,
      };
      setLoaded(true);
    } catch (e) {
      console.error(`Failed to load page ${pageNum}:`, e);
    }
  };

  // ─── Main canvas setup ───

  useEffect(() => {
    if (!loaded || !renderSize) return;

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

    const content = contentRef.current;
    const textLayer = textLayerRef.current;
    if (textLayer) textLayer.innerHTML = '';

    // ─── Events ───

    canvas.on('object:moving', (e) => {
      if (e.target.syncToDOM) e.target.syncToDOM();
    });

    canvas.on('object:scaling', (e) => {
      if (e.target.syncToDOM) e.target.syncToDOM();
    });

    canvas.on('object:modified', () => {
      saveSnapshot();
      const active = canvas.getActiveObject();
      if (active && onSelectionChange) onSelectionChange(active, canvas);
    });

    canvas.on('selection:created', (e) => {
      if (onSelectionChange) onSelectionChange(e.selected?.[0] || null, canvas);
    });
    canvas.on('selection:updated', (e) => {
      if (onSelectionChange) onSelectionChange(e.selected?.[0] || null, canvas);
    });
    canvas.on('selection:cleared', () => {
      if (onSelectionChange) onSelectionChange(null, canvas);
    });

    canvas.on('mouse:dblclick', (e) => {
      const obj = e.target;
      if (obj instanceof PdfTextObject) {
        obj.enterEditing();
      }
    });

    canvas.on('object:removed', (e) => {
      if (e.target.destroy) e.target.destroy();
    });

    // ─── Load elements ───

    const loadElements = async () => {
      await document.fonts.ready;

      // Background
      if (content.renderImageUrl && !hideBackground) {
        try {
          const bgImg = await FabricImage.fromURL(content.renderImageUrl);
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

      // Sort by z_index
      const elements = [];
      for (const d of (content.drawings || [])) {
        elements.push({ type: 'drawing', z_index: d.z_index, data: d });
      }
      for (const img of content.images) {
        elements.push({ type: 'image', z_index: img.z_index, data: img });
      }
      elements.sort((a, b) => a.z_index - b.z_index);

      // Drawings
      for (const d of (content.drawings || [])) {
        _addDrawing(canvas, d);
      }

      // Images
      for (const el of elements) {
        if (el.type === 'image') {
          await _addImage(canvas, el.data);
        }
      }

      // Text (PdfTextObject + DOM)
      const paragraphs = content.paragraphs || [];
      for (let idx = 0; idx < paragraphs.length; idx++) {
        _addParagraph(canvas, textLayer, paragraphs[idx], idx);
      }

      canvas.requestRenderAll();
    };

    const _addDrawing = (canvas, d) => {
      const pos = pdfToCanvas(d.rect, SCALE);
      const fill = d.fill ? `rgb(${Math.round(d.fill[0] * 255)},${Math.round(d.fill[1] * 255)},${Math.round(d.fill[2] * 255)})` : null;
      const stroke = d.stroke ? `rgb(${Math.round(d.stroke[0] * 255)},${Math.round(d.stroke[1] * 255)},${Math.round(d.stroke[2] * 255)})` : null;
      const rect = new Rect({
        left: pos.left, top: pos.top, width: pos.width, height: pos.height,
        fill, stroke, strokeWidth: 0, originX: 'left', originY: 'top', opacity: 0.3,
      });
      rect._pdfData = {
        id: `draw-${d.rect.join('-')}`,
        originalRect: [...d.rect], fill: d.fill, stroke: d.stroke,
      };
      canvas.add(rect);
    };

    const _addImage = async (canvas, img) => {
      try {
        const pos = pdfToCanvas(img.bbox, SCALE);
        const imgObj = await FabricImage.fromURL(img.image_url);
        imgObj.set({ left: pos.left, top: pos.top, originX: 'left', originY: 'top', strokeWidth: 0, opacity: 0.3 });
        imgObj.scaleX = pos.width / imgObj.width;
        imgObj.scaleY = pos.height / imgObj.height;
        imgObj._pdfData = {
          id: `img-${img.xref}`,
          xref: img.xref, originalBbox: [...img.bbox], imageUrl: img.image_url,
        };
        canvas.add(imgObj);
      } catch (e) {
        console.error('Failed to load image:', e);
      }
    };

    const _addParagraph = (canvas, textLayer, para, idx) => {
      const pos = pdfToCanvas(para.bbox, SCALE);
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
        lineHeightRatio = pos.height / (numLines * para.fontSize * SCALE);
        if (lineHeightRatio < 0.8 || lineHeightRatio > 3.0) lineHeightRatio = 1.2;
      }

      const colorStr = `rgb(${r},${g},${b})`;

      // Fabric hit-area
      const textObj = new PdfTextObject({
        left: pos.left, top: pos.top,
        width: pos.width, height: pos.height,
        text: cleanText,
        fontSize: para.fontSize * SCALE,
        fontFamily: fontProps.fontFamily,
        fontWeight: fontProps.fontWeight,
        fontStyle: fontProps.fontStyle,
        color: colorStr,
        lineHeight: lineHeightRatio,
        textAlign: para.textAlign || 'left',
        _pdfData: {
          id: `para-${idx}`,
          originalBbox: [...para.bbox],
          originalFontSize: para.fontSize,
          originalFontName: para.fontName,
          originalText: cleanText,
          originalColor: [...para.color],
          originalHeight: para.bbox[3] - para.bbox[1],
          lineHeight: para.lineHeight,
        },
      });
      canvas.add(textObj);

      // DOM text element
      const div = _createTextDiv({
        left: pos.left, top: pos.top, width: pos.width, height: pos.height,
        text: cleanText,
        fontSize: para.fontSize * SCALE,
        fontFamily: fontProps.fontFamily,
        fontWeight: fontProps.fontWeight,
        fontStyle: fontProps.fontStyle,
        color: colorStr,
        lineHeight: lineHeightRatio,
      });
      textLayer.appendChild(div);
      textObj.bindElement(div);
      _attachTextEvents(textObj, div);
    };

    loadElements();

    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
      if (textLayer) textLayer.innerHTML = '';
    };
  }, [loaded, renderSize, hideBackground, saveSnapshot, onSelectionChange]);

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
          <div
            ref={textLayerRef}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        </>
      )}
    </div>
  );
});

export default FabricCanvas;
