import { useEffect, useRef, useCallback } from 'react';
import { Canvas, Textbox, FabricImage } from 'fabric';
import { pdfToCanvas, canvasToPdf } from '../utils/coordinate';

function FabricCanvas({ renderSize, paragraphs, images, pageHeight, onEditsReady }) {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const dirtyRef = useRef(new Set());

  const DPI = 150;
  const scale = DPI / 72;

  // 构建 canvas
  useEffect(() => {
    if (!canvasElRef.current || !renderSize.width) return;

    // 清理旧 canvas
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

    // 加载画布内容
    const loadCanvas = async () => {
      try {
        // 添加段落文字对象
        paragraphs.forEach((para) => {
          const pos = pdfToCanvas(para.bbox, scale);
          const r = Math.round(para.color[0] * 255);
          const g = Math.round(para.color[1] * 255);
          const b = Math.round(para.color[2] * 255);

          // 反算 lineHeight 比值，使 Textbox 总高度 = PDF bbox 高度
          // Fabric.js height ≈ numLines * fontSize * ratio，要让它 = pos.height
          const numLines = para.text.split('\n').length;
          const lineHeightRatio = numLines > 1
            ? pos.height / (numLines * para.fontSize * scale)
            : 1.2;

          const textObj = new Textbox(para.text, {
            left: pos.left,
            top: pos.top,
            width: pos.width * 1.2,
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
        });

        // 添加图片对象
        for (const img of images) {
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
        }

        canvas.requestRenderAll();
      } catch (e) {
        console.error('Canvas load error:', e);
      }
    };

    loadCanvas();

    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
  }, [renderSize, paragraphs, images]);

  // 事件监听
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onModified = (e) => {
      dirtyRef.current.add(e.target);
    };

    const onEditingExited = (e) => {
      const obj = e.target;
      if (obj._pdfData && obj.text !== obj._pdfData.originalText) {
        dirtyRef.current.add(obj);
        submitEdits();
      }
    };

    canvas.on('object:modified', onModified);
    canvas.on('text:editing:exited', onEditingExited);

    return () => {
      canvas.off('object:modified', onModified);
      canvas.off('text:editing:exited', onEditingExited);
    };
  }, []);

  const submitEdits = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !onEditsReady) return;

    const paragraphEdits = [];
    const imageEdits = [];

    for (const obj of dirtyRef.current) {
      if (!obj._pdfData) continue;

      if (obj._pdfData.originalText !== undefined) {
        // 段落文字编辑
        const pdf = obj._pdfData;
        const currentHeightPdf = obj.getScaledHeight() / scale;
        const heightDelta = Math.max(0, currentHeightPdf - pdf.originalHeight);

        paragraphEdits.push({
          bbox: pdf.originalBbox,
          newText: obj.text,
          fontSize: pdf.originalFontSize,
          fontName: pdf.originalFontName,
          color: pdf.originalColor,
          height_delta: heightDelta,
        });
      } else if (obj._pdfData.xref !== undefined) {
        // 图片编辑
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

  return (
    <canvas ref={canvasElRef} />
  );
}

export default FabricCanvas;
