import { useEffect, useRef, useCallback } from 'react';
import { Canvas, IText, FabricImage } from 'fabric';
import { pdfToCanvas, canvasToPdf } from '../utils/coordinate';

function FabricCanvas({ imageUrl, renderSize, textSpans, images, pageHeight, onEditsReady }) {
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
    });
    fabricRef.current = canvas;
    dirtyRef.current = new Set();

    // 加载背景图
    const loadCanvas = async () => {
      try {
        // 背景图
        const bgImg = await FabricImage.fromURL(imageUrl);
        canvas.backgroundImage = bgImg;

        // 添加文字对象
        textSpans.forEach((span) => {
          const pos = pdfToCanvas(span.bbox, scale);
          const r = Math.round(span.color[0] * 255);
          const g = Math.round(span.color[1] * 255);
          const b = Math.round(span.color[2] * 255);

          const textObj = new IText(span.text, {
            left: pos.left,
            top: pos.top,
            fontSize: span.fontSize * scale,
            fill: `rgb(${r},${g},${b})`,
            fontFamily: 'Helvetica, Arial, sans-serif',
            editable: true,
            originX: 'left',
            originY: 'top',
          });
          textObj._pdfData = {
            originalBbox: [...span.bbox],
            originalOrigin: [...span.origin],
            originalFontSize: span.fontSize,
            originalText: span.text,
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
            });
            imgObj.scaleToWidth(pos.width);
            imgObj.scaleToHeight(pos.height);
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
  }, [imageUrl, renderSize, textSpans, images]);

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

    const textEdits = [];
    const imageEdits = [];

    for (const obj of dirtyRef.current) {
      if (!obj._pdfData) continue;

      if (obj._pdfData.originalText !== undefined) {
        // 文字编辑
        const newBbox = canvasToPdf(obj.left, obj.top, obj.getScaledWidth(), obj.getScaledHeight(), scale);
        const newOrigin = [newBbox[0], obj._pdfData.originalOrigin[1]];
        // 如果文字被移动了，origin 也需要更新
        if (obj.left !== pdfToCanvas(obj._pdfData.originalBbox, scale).left) {
          newOrigin[1] = newBbox[3] - obj._pdfData.originalFontSize * 0.2;
        }

        textEdits.push({
          bbox: obj._pdfData.originalBbox,
          newText: obj.text,
          fontSize: obj._pdfData.originalFontSize,
          origin: newOrigin,
        });
      } else if (obj._pdfData.xref !== undefined) {
        // 图片编辑
        const newBbox = canvasToPdf(obj.left, obj.top, obj.getScaledWidth(), obj.getScaledHeight(), scale);
        imageEdits.push({
          xref: obj._pdfData.xref,
          old_bbox: obj._pdfData.originalBbox,
          new_bbox: newBbox,
          image_data: '', // 后端已通过 xref 提取
        });
      }
    }

    if (textEdits.length > 0 || imageEdits.length > 0) {
      onEditsReady({ text_edits: textEdits, image_edits: imageEdits });
    }
    dirtyRef.current = new Set();
  }, [onEditsReady, scale]);

  return (
    <canvas ref={canvasElRef} />
  );
}

export default FabricCanvas;
