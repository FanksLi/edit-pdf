import { useEffect, useRef, useCallback } from 'react';
import { Canvas, Textbox, FabricImage, Rect } from 'fabric';
import { pdfToCanvas, canvasToPdf } from '../utils/coordinate';

function FabricCanvas({ renderSize, paragraphs, images, drawings, pageHeight, onEditsReady }) {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const dirtyRef = useRef(new Set());
  const submitRef = useRef(null);

  const DPI = 150;
  const scale = DPI / 72;

  // 提交编辑逻辑
  const submitEdits = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !onEditsReady) return;

    const paragraphEdits = [];
    const imageEdits = [];

    for (const obj of dirtyRef.current) {
      if (!obj._pdfData) continue;

      if (obj._pdfData.originalText !== undefined) {
        const pdf = obj._pdfData;

        // 正确计算 height_delta：基于行数变化，而不是 Textbox 视觉高度
        const originalLines = pdf.originalText.split('\n').length;
        const currentLines = obj.text.split('\n').length;
        const lineCountDelta = currentLines - originalLines;

        // height_delta = 行数变化 × lineHeight（PDF 坐标）
        const heightDelta = lineCountDelta * pdf.lineHeight;

        paragraphEdits.push({
          bbox: pdf.originalBbox,
          newText: obj.text,
          fontSize: pdf.originalFontSize,
          fontName: pdf.originalFontName,
          color: pdf.originalColor,
          height_delta: Math.max(0, heightDelta), // 只下推，不上拉
          lineHeight: pdf.lineHeight,
        });
      } else if (obj._pdfData.xref !== undefined) {
        const newBbox = canvasToPdf(obj.left, obj.top, obj.getScaledWidth(), obj.getScaledHeight(), scale);
        imageEdits.push({
          xref: obj._pdfData.xref,
          old_bbox: obj._pdfData.originalBbox,
          new_bbox: newBbox,
          image_data: '',
        });
      }
    }

    if (paragraphEdits.length > 0 || imageEdits.length > 0) {
      onEditsReady({ paragraph_edits: paragraphEdits, image_edits: imageEdits });
    }
    dirtyRef.current = new Set();
  }, [onEditsReady, scale]);

  // 保持 ref 指向最新
  submitRef.current = submitEdits;

  // 构建 canvas + 事件监听（每次 canvas 重建时重新注册事件）
  useEffect(() => {
    if (!canvasElRef.current || !renderSize.width) return;

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
    dirtyRef.current = new Set();

    // 注册事件
    const onModified = (e) => {
      dirtyRef.current.add(e.target);
    };

    const onEditingExited = (e) => {
      const obj = e.target;
      if (obj._pdfData && obj.text !== obj._pdfData.originalText) {
        dirtyRef.current.add(obj);
        submitRef.current?.();
      }
    };

    canvas.on('object:modified', onModified);
    canvas.on('text:editing:exited', onEditingExited);

    // 加载内容（按 z_index 排序：drawings → paragraphs → images）
    const loadCanvas = async () => {
      try {
        const elements = [];

        for (const d of (drawings || [])) {
          elements.push({ type: 'drawing', z_index: d.z_index, data: d });
        }

        for (const para of paragraphs) {
          elements.push({ type: 'text', z_index: para.z_index, data: para });
        }

        for (const img of images) {
          elements.push({ type: 'image', z_index: img.z_index, data: img });
        }

        // 按 z_index 排序，同 z_index 时 drawing < text < image
        elements.sort((a, b) => {
          if (a.z_index !== b.z_index) return a.z_index - b.z_index;
          const order = { drawing: 0, text: 1, image: 2 };
          return (order[a.type] || 0) - (order[b.type] || 0);
        });

        // 按排序顺序添加到 canvas（先添加 = 底层）
        for (const el of elements) {
          if (el.type === 'drawing') {
            _addDrawing(canvas, el.data);
          } else if (el.type === 'text') {
            _addParagraph(canvas, el.data);
          } else if (el.type === 'image') {
            await _addImage(canvas, el.data);
          }
        }

        canvas.requestRenderAll();
      } catch (e) {
        console.error('Canvas load error:', e);
      }
    };

    // 添加绘图元素（可选中拖拽）
    const _addDrawing = (canvas, d) => {
      const pos = pdfToCanvas(d.rect, scale);
      const fill = d.fill ? `rgb(${Math.round(d.fill[0] * 255)},${Math.round(d.fill[1] * 255)},${Math.round(d.fill[2] * 255)})` : null;
      const stroke = d.stroke ? `rgb(${Math.round(d.stroke[0] * 255)},${Math.round(d.stroke[1] * 255)},${Math.round(d.stroke[2] * 255)})` : null;

      const rect = new Rect({
        left: pos.left,
        top: pos.top,
        width: pos.width,
        height: pos.height,
        fill,
        stroke,
        strokeWidth: 0,
        originX: 'left',
        originY: 'top',
      });
      canvas.add(rect);
    };

    // 添加段落文字
    const _addParagraph = (canvas, para) => {
      const pos = pdfToCanvas(para.bbox, scale);
      const r = Math.round(para.color[0] * 255);
      const g = Math.round(para.color[1] * 255);
      const b = Math.round(para.color[2] * 255);

      const numLines = para.text.split('\n').length;
      const lineHeightRatio = numLines > 1
        ? pos.height / (numLines * para.fontSize * scale)
        : 1.2;

      const textObj = new Textbox(para.text, {
        left: pos.left,
        top: pos.top,
        width: pos.width * 1.07,
        fontSize: para.fontSize * scale,
        lineHeight: lineHeightRatio,
        fill: `rgb(${r},${g},${b})`,
        fontFamily: 'Helvetica, Arial, sans-serif',
        editable: true,
        originX: 'left',
        originY: 'top',
        splitByGrapheme: true,
      });
      textObj._pdfData = {
        originalBbox: [...para.bbox],
        originalFontSize: para.fontSize,
        originalFontName: para.fontName,
        originalText: para.text,
        originalColor: [...para.color],
        originalHeight: para.bbox[3] - para.bbox[1],
        lineHeight: para.lineHeight,
      };
      canvas.add(textObj);
    };

    // 添加图片
    const _addImage = async (canvas, img) => {
      try {
        const pos = pdfToCanvas(img.bbox, scale);
        const imgObj = await FabricImage.fromURL(img.image_url);
        imgObj.set({
          left: pos.left,
          top: pos.top,
          originX: 'left',
          originY: 'top',
          strokeWidth: 0,
        });
        imgObj.scaleX = pos.width / imgObj.width;
        imgObj.scaleY = pos.height / imgObj.height;
        imgObj._pdfData = {
          xref: img.xref,
          originalBbox: [...img.bbox],
          imageUrl: img.image_url,
        };
        canvas.add(imgObj);
      } catch (e) {
        console.error('Failed to load image:', e);
      }
    };

    loadCanvas();

    return () => {
      canvas.off('object:modified', onModified);
      canvas.off('text:editing:exited', onEditingExited);
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
  }, [renderSize, paragraphs, images, drawings]);

  return (
    <canvas ref={canvasElRef} />
  );
}

export default FabricCanvas;
