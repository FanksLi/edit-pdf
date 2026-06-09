import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, FabricImage, Rect, ActiveSelection, Line } from 'fabric';
import PdfTextObject from '../objects/PdfTextObject';
import TipTapEditor from './TipTapEditor';
import { pdfToCanvas, canvasToPdf } from '../utils/coordinate';
import { getPageText, getPageRender } from '../services/api';
import useCanvasStore from '../stores/canvasStore';

const FONT_MAP = {
  LiberationSerif: "'Liberation_Serif'",
  LiberationSans: "'Liberation_Serif'",
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

/**
 * 将 TipTap JSON 转换为后端 inlineStyles 格式
 * @param {Object} richContent - TipTap getJSON() 返回的对象
 * @param {Object} baseStyles - 基础样式 { color, fontSize }
 * @returns {Array} inlineStyles 数组
 */
function convertTipTapToInlineStyles(richContent, baseStyles = {}, scale = 1) {
  if (!richContent || richContent.type !== 'doc') return [];

  const inlineStyles = [];
  let charIndex = 0;

  // 遍历文档内容
  for (const block of richContent.content || []) {
    if (block.type !== 'paragraph') continue;

    for (const node of block.content || []) {
      if (node.type !== 'text') continue;

      const textLength = node.text?.length || 0;
      const start = charIndex;
      const end = charIndex + textLength;

      // 解析 marks（样式标记）
      if (node.marks && node.marks.length > 0) {
        const style = { start, end };

        for (const mark of node.marks) {
          if (mark.type === 'bold') {
            style.bold = true;
          } else if (mark.type === 'italic') {
            style.italic = true;
          } else if (mark.type === 'underline') {
            style.underline = true;
          } else if (mark.type === 'strike') {
            style.strikethrough = true;
          } else if (mark.type === 'textStyle' && mark.attrs) {
            // 颜色
            if (mark.attrs.color) {
              // 解析颜色：#ff0000 或 rgb(255,0,0)
              const colorStr = mark.attrs.color;
              if (colorStr.startsWith('#')) {
                const hex = colorStr.slice(1);
                style.color = [
                  parseInt(hex.slice(0, 2), 16) / 255,
                  parseInt(hex.slice(2, 4), 16) / 255,
                  parseInt(hex.slice(4, 6), 16) / 255,
                ];
              } else if (colorStr.startsWith('rgb(')) {
                const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                if (match) {
                  style.color = [
                    parseInt(match[1]) / 255,
                    parseInt(match[2]) / 255,
                    parseInt(match[3]) / 255,
                  ];
                }
              }
            }
            // 字号（px 转 pt，保留一位小数）
            if (mark.attrs.fontSize) {
              const sizeStr = mark.attrs.fontSize;
              const sizeMatch = sizeStr.match(/(\d+(?:\.\d+)?)/);
              if (sizeMatch) {
                // TipTap 存的是 px 值，后端需要 pt 值
                const ptValue = parseFloat(sizeMatch[1]) / scale;
                style.fontSize = Math.round(ptValue * 10) / 10;
              }
            }
            // 字体
            if (mark.attrs.fontFamily) {
              style.fontFamily = mark.attrs.fontFamily;
            }
          }
        }

        // 只添加有实际样式变化的条目
        if (style.bold || style.italic || style.underline || style.strikethrough
            || style.color || style.fontSize || style.fontFamily) {
          inlineStyles.push(style);
        }
      }

      charIndex += textLength;
    }
  }

  return inlineStyles;
}

/**
 * 将后端 inlineSpans 转换为 TipTap JSON 内容
 * @param {string} text - 纯文本内容
 * @param {Array} inlineSpans - 后端返回的内联样式数组
 * @param {number} scale - 用于 fontSize pt 转 px
 * @returns {Object} TipTap JSON 文档
 */
function convertInlineSpansToTipTap(text, inlineSpans, scale = 1) {
  // 按 \n 分割为多行，每行作为一个段落
  const lines = text.split('\n');

  if (!inlineSpans || inlineSpans.length === 0) {
    return {
      type: 'doc',
      content: lines.map(line => ({
        type: 'paragraph',
        content: [{ type: 'text', text: line }],
      })),
    };
  }

  // 按 start 排序
  const sortedSpans = [...inlineSpans].sort((a, b) => a.start - b.start);

  // 计算每行的起始偏移
  let lineOffsets = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    lineOffsets.push(lineOffsets[i] + lines[i].length + 1); // +1 for \n
  }

  // 为每行构建内容
  const paragraphs = lines.map((line, lineIdx) => {
    const lineStart = lineOffsets[lineIdx];
    const lineEnd = lineStart + line.length;
    const textNodes = [];
    let currentPos = lineStart;

    // 找到与当前行有交集的 spans
    for (const span of sortedSpans) {
      const spanStart = span.start;
      const spanEnd = span.end;

      // 跳过完全在当前行之前的 span
      if (spanEnd <= lineStart) continue;
      // 跳过完全在当前行之后的 span
      if (spanStart >= lineEnd) break;

      // 样式前的普通文本
      if (spanStart > currentPos) {
        const plainStart = currentPos;
        const plainEnd = Math.min(spanStart, lineEnd);
        if (plainEnd > plainStart) {
          textNodes.push({ type: 'text', text: text.slice(plainStart, plainEnd) });
        }
      }

      // 带样式的文本
      const styleStart = Math.max(spanStart, lineStart);
      const styleEnd = Math.min(spanEnd, lineEnd);
      if (styleEnd > styleStart) {
        const node = { type: 'text', text: text.slice(styleStart, styleEnd) };
        const textStyleAttrs = {};

        if (span.color) {
          const r = Math.round(span.color[0] * 255);
          const g = Math.round(span.color[1] * 255);
          const b = Math.round(span.color[2] * 255);
          textStyleAttrs.color = `rgb(${r},${g},${b})`;
        }

        if (span.fontSize) {
          const fontSizePx = Math.round(span.fontSize * scale * 10) / 10;
          textStyleAttrs.fontSize = `${fontSizePx}px`;
        }

        if (span.fontFamily) {
          textStyleAttrs.fontFamily = span.fontFamily;
        }

        if (Object.keys(textStyleAttrs).length > 0) {
          node.marks = [{ type: 'textStyle', attrs: textStyleAttrs }];
        }
        textNodes.push(node);
      }

      currentPos = Math.max(currentPos, spanEnd);
    }

    // 剩余文本
    if (currentPos < lineEnd) {
      textNodes.push({ type: 'text', text: text.slice(currentPos, lineEnd) });
    }

    return {
      type: 'paragraph',
      content: textNodes.length > 0 ? textNodes : [{ type: 'text', text: '' }],
    };
  });

  return {
    type: 'doc',
    content: paragraphs,
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
  const imageLayerRef = useRef(null); // 新增：图片 DOM 层
  const contentRef = useRef(null);
  const loadRequestedRef = useRef(false);
  const isRestoringRef = useRef(false); // 防止恢复时循环触发
  const isLocalUpdateRef = useRef(false); // 标记本地更新，不需要恢复 Fabric 对象

  const [loaded, setLoaded] = useState(false);
  const [renderSize, setRenderSize] = useState(null);

  const canvasWidth = Math.round(pageWidth * SCALE);
  const canvasHeight = Math.round(pageHeight * SCALE);

  // zustand store actions
  const initPage = useCanvasStore(state => state.initPage);
  const updateObject = useCanvasStore(state => state.updateObject);
  const addObject = useCanvasStore(state => state.addObject);
  const removeObject = useCanvasStore(state => state.removeObject);
  const getPageObjects = useCanvasStore(state => state.getPageObjects);

  // zundo temporal 控制 - 用 ref 保持稳定引用
  const pauseRef = useRef(null);
  const resumeRef = useRef(null);

  // 初始化时获取 pause/resume 方法
  useEffect(() => {
    const temporalState = useCanvasStore.temporal.getState();
    pauseRef.current = temporalState.pause;
    resumeRef.current = temporalState.resume;
  }, []);

  // ─── Imperative API ────────────────────────────────────

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
          // TipTap getText() 在段落间返回双换行，需要替换为单换行
          const currentText = obj.getText().replace(/\n\n/g, '\n');
          const b = obj.getBounding();
          const newBbox = canvasToPdf(b.left, b.top, b.width, b.height, SCALE);
          const textChanged = currentText !== pdf.originalText;

          // 检测位置变化（x, y）
          const posChanged = Math.abs(newBbox[0] - pdf.originalBbox[0]) > 0.5
            || Math.abs(newBbox[1] - pdf.originalBbox[1]) > 0.5;

          // 检测尺寸变化（宽度、高度）
          const sizeChanged = Math.abs(newBbox[2] - pdf.originalBbox[2]) > 0.5
            || Math.abs(newBbox[3] - pdf.originalBbox[3]) > 0.5;

          let newColor = [...pdf.originalColor];
          let colorChanged = false;
          if (obj.color) {
            // 支持 rgb(...) 和 #xxxxxx 格式
            if (obj.color.startsWith('rgb(')) {
              const match = obj.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
              if (match) {
                const r = parseInt(match[1]) / 255;
                const g = parseInt(match[2]) / 255;
                const b = parseInt(match[3]) / 255;
                newColor = [r, g, b];
                colorChanged = pdf.originalColor.some((v, i) => Math.abs(newColor[i] - v) > 0.01);
              }
            } else if (obj.color.startsWith('#')) {
              // 解析 #xxxxxx 格式
              const hex = obj.color.slice(1);
              const r = parseInt(hex.slice(0, 2), 16) / 255;
              const g = parseInt(hex.slice(2, 4), 16) / 255;
              const b = parseInt(hex.slice(4, 6), 16) / 255;
              newColor = [r, g, b];
              colorChanged = pdf.originalColor.some((v, i) => Math.abs(newColor[i] - v) > 0.01);
            }
          }

          const currentFontSize = obj.fontSize / SCALE;
          const fontSizeChanged = Math.abs(currentFontSize - pdf.originalFontSize) > 0.1;

          // 获取富文本内容（包含内联样式）
          const richContent = obj.getRichContent();
          // 转换为后端期望的 inlineStyles 格式
          const inlineStyles = convertTipTapToInlineStyles(richContent, {}, SCALE);
          // 检测是否有内联样式变化
          const hasInlineStyles = inlineStyles.length > 0;

          if (textChanged || posChanged || colorChanged || sizeChanged || fontSizeChanged || hasInlineStyles) {
            const originalLines = pdf.originalText.split('\n').length;
            const currentLines = currentText.split('\n').length;
            const lineCountDelta = currentLines - originalLines;
            const newBottom = newBbox[1] + newBbox[3];
            const oldBottom = pdf.originalBbox[1] + pdf.originalBbox[3];
            const textExpandDelta = lineCountDelta * pdf.lineHeight;
            const geoDelta = newBottom - oldBottom;
            const heightDelta = Math.max(0, geoDelta, textExpandDelta);

            paragraphEdits.push({
              bbox: pdf.originalBbox,
              new_bbox: (posChanged || sizeChanged) ? newBbox : undefined,
              newText: currentText,
              fontSize: currentFontSize,
              originalFontSize: pdf.originalFontSize,
              fontName: pdf.originalFontName,
              color: newColor,
              originalColor: pdf.originalColor,
              height_delta: heightDelta,
              lineHeight: pdf.lineHeight,
              inlineStyles: inlineStyles.length > 0 ? inlineStyles : undefined,
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

      const newElements = [];
      for (const obj of canvas.getObjects()) {
        if (obj._newElement && obj._elementType === 'image') {
          const pos = canvasToPdf(obj.left, obj.top, obj.getScaledWidth(), obj.getScaledHeight(), SCALE);
          newElements.push({
            type: 'image',
            bbox: pos,
            image_id: obj._imageId,
            ext: obj._ext,
            angle: obj.angle || 0,
          });
        }
      }

      return { paragraph_edits: paragraphEdits, image_edits: imageEdits, drawing_edits: drawingEdits, new_elements: newElements };
    },

    addNewText() {
      const canvas = fabricRef.current;
      const textLayer = textLayerRef.current;
      if (!canvas || !textLayer) return;

      const id = `new-${Date.now()}`;
      const left = canvasWidth / 2 - 100;
      const top = canvasHeight / 2 - 20;

      // 获取新的 z_index
      const newZIndex = (canvas._maxZIndex || 0) + 1;
      canvas._maxZIndex = newZIndex;

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

      // 将新添加的文字置于顶层
      canvas.bringObjectToFront(textObj);

      // 创建 TipTap 编辑器容器
      const tipTapContainer = document.createElement('div');
      tipTapContainer.className = 'tiptap-wrapper';
      tipTapContainer.style.cssText = `
        position: absolute;
        left: ${left}px;
        top: ${top}px;
        width: 200px;
        min-height: 40px;
        min-width: 10px;
        background: transparent;
        pointer-events: none;
        z-index: ${newZIndex};
      `;
      tipTapContainer.dataset.textId = id;
      textLayer.appendChild(tipTapContainer);

      // 使用 createRoot 渲染 TipTap 组件
      const editorRef = { current: null };
      const root = createRoot(tipTapContainer);

      const handleEditorReady = () => {
        _attachTipTapEvents(textObj, editorRef);
        // 初始化时测量内容宽度，避免文字被挤压
        requestAnimationFrame(() => {
          textObj._measureAndExpandWidth?.();
        });
      };

      const handleBlur = (text, html, richContent) => {
        if (textObj._editing) {
          textObj.exitEditing();

          const canvasInstance = fabricRef.current;
          if (canvasInstance) canvasInstance.requestRenderAll();

          const textAfterEdit = textObj.getText();
          const richContentAfterEdit = textObj.getRichContent();
          const heightAfterEdit = textObj.height;
          const objId = textObj._pdfData?.id || textObj._newId;
          if (objId) {
            isLocalUpdateRef.current = true;
            const topLeft = textObj.topLeft;
            updateObject(pageNum, objId, {
              text: textAfterEdit,
              richContent: richContentAfterEdit,
              left: topLeft.x,
              top: topLeft.y,
              width: textObj.width,
              height: heightAfterEdit,
            });
          }
        }
      };

      root.render(
        <TipTapEditor
          ref={(el) => { editorRef.current = el; }}
          content="输入文字"
          fontSize={16}
          fontFamily="'Roboto', Arial, sans-serif"
          fontWeight="normal"
          fontStyle="normal"
          color="#000000"
          textAlign="left"
          lineHeight={1.2}
          width={200}
          height={40}
          onEditorReady={handleEditorReady}
          onBlur={handleBlur}
        />
      );

      // 存储 root 引用以便清理
      textObj._tipTapRoot = root;
      textObj._tipTapContainer = tipTapContainer;

      canvas.setActiveObject(textObj);
      canvas.requestRenderAll();

      // 同步到 zustand
      addObject(pageNum, _objectToState(textObj));
    },

    async addNewImage(imageUrl, imageId, ext) {
      const canvas = fabricRef.current;
      const textLayer = textLayerRef.current;
      if (!canvas || !textLayer) return;

      try {
        const imgObj = await FabricImage.fromURL(imageUrl);
        const maxDim = 200;
        const ratio = Math.min(maxDim / imgObj.width, maxDim / imgObj.height, 1);

        const left = canvas.width / 2 - (imgObj.width * ratio) / 2;
        const top = canvas.height / 2 - (imgObj.height * ratio) / 2;
        const width = imgObj.width * ratio;
        const height = imgObj.height * ratio;

        // 获取新的 z_index
        const newZIndex = (canvas._maxZIndex || 0) + 1;
        canvas._maxZIndex = newZIndex;

        // Fabric 对象用于交互，设置为透明
        imgObj.set({
          left,
          top,
          scaleX: ratio,
          scaleY: ratio,
          originX: 'left',
          originY: 'top',
          strokeWidth: 0,
          opacity: 0, // 透明，只用做交互区域
        });
        imgObj._newElement = true;
        imgObj._elementType = 'image';
        imgObj._imageId = imageId;
        imgObj._ext = ext;
        canvas.add(imgObj);
        canvas.setActiveObject(imgObj);
        canvas.requestRenderAll();

        // 创建 DOM 图片元素，添加到文字层
        const imgEl = document.createElement('img');
        imgEl.src = imageUrl;
        imgEl.style.cssText = `
          position: absolute;
          left: ${left}px;
          top: ${top}px;
          width: ${width}px;
          height: ${height}px;
          pointer-events: none;
          z-index: ${newZIndex};
        `;
        imgEl.dataset.imageId = imageId;
        textLayer.appendChild(imgEl);
        imgObj._domElement = imgEl;
        imgObj._imageUrl = imageUrl;

        // 同步到 zustand
        addObject(pageNum, _objectToState(imgObj));
      } catch (e) {
        console.error('Failed to add image:', e);
      }
    },
  }));

  // ─── Helper: Fabric Object → Store State ────────────────────────────────

  const _objectToState = (obj) => {
    const isText = obj instanceof PdfTextObject;
    // 对于 PdfTextObject，使用左上角坐标（因为 originX/originY 是 center）
    const left = isText ? obj.topLeft.x : obj.left;
    const top = isText ? obj.topLeft.y : obj.top;

    return {
      id: obj._pdfData?.id || obj._newId || `obj-${Date.now()}`,
      type: isText ? 'text' : (obj._elementType || 'image'),
      left,
      top,
      width: obj.width,
      height: obj.height,
      scaleX: obj.scaleX || 1,
      scaleY: obj.scaleY || 1,
      angle: obj.angle || 0,
      // 文字属性
      text: isText ? obj.getText() : undefined,
      fontSize: isText ? obj.fontSize : undefined,
      fontFamily: isText ? obj.fontFamily : undefined,
      fontWeight: isText ? obj.fontWeight : undefined,
      fontStyle: isText ? obj.fontStyle : undefined,
      color: isText ? obj.color : undefined,
      lineHeight: isText ? obj.lineHeight : undefined,
      textAlign: isText ? obj.textAlign : undefined,
      // 富文本内容（TipTap JSON）
      richContent: isText ? obj.getRichContent() : undefined,
      // 图片属性
      imageUrl: obj._pdfData?.imageUrl,
      imageId: obj._imageId,
      ext: obj._ext,
      _newElement: obj._newElement,
      _elementType: obj._elementType,
      _pdfData: obj._pdfData ? { ...obj._pdfData } : null,
    };
  };

  // ─── DOM helpers ────────────────────────────────────────────────────────

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
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: '1',
    });
    div.innerText = text;
    return div;
  };

  // ─── TipTap 编辑器事件处理 ────────────────────────────────────────────────────

  const _attachTipTapEvents = (textObj, editorRef) => {
    // 存储编辑器引用到 PdfTextObject
    textObj.bindEditor(editorRef);

    // 监听键盘事件
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && textObj._editing) {
        e.preventDefault();
        textObj.exitEditing();

        const canvas = fabricRef.current;
        if (canvas) canvas.requestRenderAll();

        const textAfterEdit = textObj.getText();
        const richContentAfterEdit = textObj.getRichContent();
        const heightAfterEdit = textObj.height;
        const objId = textObj._pdfData?.id || textObj._newId;
        if (objId) {
          isLocalUpdateRef.current = true;
          const topLeft = textObj.topLeft;
          updateObject(pageNum, objId, {
            text: textAfterEdit,
            richContent: richContentAfterEdit,
            left: topLeft.x,
            top: topLeft.y,
            width: textObj.width,
            height: heightAfterEdit,
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // 返回清理函数
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  };

  // TipTap 内容更新时同步高度和宽度
  const handleTipTapUpdate = (textObj, updateInfo) => {
    if (!textObj._editing) return;

    const { scrollHeight, contentWidth } = updateInfo;
    const container = textObj._tipTapContainer;
    const editorInstance = textObj._editorRef?.current;
    const editorEl = editorInstance?.getEditor?.()?.options?.element;

    let needsSync = false;

    // 宽度变化（文字换行超出或字体变大）
    const currentWidth = textObj.width * (textObj.scaleX || 1);
    // 只允许宽度明显增加（容差 10px），防止测量误差导致频繁调整
    if (contentWidth && contentWidth > currentWidth + 10 && contentWidth < 2000) {
      const deltaWidth = contentWidth - currentWidth;
      textObj.set({ width: contentWidth, left: textObj.left + deltaWidth / 2 });
      textObj.setCoords();
      needsSync = true;
    }

    // 高度变化时同步更新
    if (scrollHeight !== textObj.height) {
      const delta = scrollHeight - textObj.height;
      textObj.set({ height: scrollHeight, top: textObj.top + delta / 2 });
      textObj.setCoords();
      needsSync = true;
    }

    // 同步位置和尺寸到 DOM
    if (needsSync) {
      textObj.syncToDOM();
      textObj.canvas?.requestRenderAll();
    }
  };

  // ─── Lazy loading ────────────────────────────────────────────────────────

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
        tables: textData.tables || [],
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

  // ─── Main canvas setup ────────────────────────────────────────────────────

  useEffect(() => {
    if (!loaded || !renderSize) return;

    if (fabricRef.current) {
      fabricRef.current.dispose();
      fabricRef.current = null;
    }

    const canvas = new Canvas(canvasElRef.current, {
      width: renderSize.width,
      height: renderSize.height,
      selection: false,
      preserveObjectStacking: true,
      renderOnAddRemove: false,
      backgroundColor: '#ffffff',
    });
    fabricRef.current = canvas;

    const content = contentRef.current;
    const textLayer = textLayerRef.current;
    if (textLayer) textLayer.innerHTML = '';

    // ─── Events ────────────────────────────────────────────────────────────

    canvas.on('object:moving', (e) => {
      const obj = e.target;
      if (obj.syncToDOM) obj.syncToDOM();
      // 同步图片 DOM 元素位置
      if (obj._domElement) {
        const width = obj.width * (obj.scaleX || 1);
        const height = obj.height * (obj.scaleY || 1);
        obj._domElement.style.left = `${obj.left}px`;
        obj._domElement.style.top = `${obj.top}px`;
        obj._domElement.style.width = `${width}px`;
        obj._domElement.style.height = `${height}px`;
      }
    });

    canvas.on('object:scaling', (e) => {
      const obj = e.target;
      if (obj.syncToDOM) obj.syncToDOM();
      // 同步图片 DOM 元素尺寸和位置
      if (obj._domElement) {
        const width = obj.width * (obj.scaleX || 1);
        const height = obj.height * (obj.scaleY || 1);
        obj._domElement.style.left = `${obj.left}px`;
        obj._domElement.style.top = `${obj.top}px`;
        obj._domElement.style.width = `${width}px`;
        obj._domElement.style.height = `${height}px`;
      }
      // 同步 TipTap 编辑器宽度并重新排版
      if (obj._editorRef?.current) {
        const editorInstance = obj._editorRef.current;
        const editor = editorInstance.getEditor?.();
        const editorEl = editor?.options?.element;
        const container = obj._tipTapContainer;
        if (editorEl && container && editor) {
          const width = obj.width * (obj.scaleX || 1);

          editorEl.style.width = '100%';
          editorEl.style.minHeight = 'auto';
          container.style.width = `${width}px`;
          container.style.minHeight = 'auto';

          if (editor._pauseMeasure) editor._pauseMeasure();

          const html = editor.getHTML();
          editor.commands.setContent(html, false);

          setTimeout(() => {
            const newHeight = editorEl.scrollHeight;
            const currentHeight = obj.height;

            if (newHeight !== currentHeight && newHeight > 0) {
              const delta = newHeight - currentHeight;
              obj.set({ height: newHeight, top: obj.top + delta / 2 });
              obj.setCoords();
              container.style.minHeight = `${newHeight}px`;
              obj.canvas?.requestRenderAll();
            }
            if (editor._resumeMeasure) editor._resumeMeasure();
          }, 50);
        }
      }
    });

    canvas.on('object:modified', (e) => {
      if (isRestoringRef.current) return;

      const obj = e.target;
      if (!obj) return;

      // 对于 PdfTextObject，将 scale 合并到 width/height
      if (obj instanceof PdfTextObject) {
        const newWidth = obj.width * (obj.scaleX || 1);
        const newHeight = obj.height * (obj.scaleY || 1);
        obj.set({
          width: newWidth,
          height: newHeight,
          scaleX: 1,
          scaleY: 1,
        });
        obj.setCoords();
        obj.syncToDOM();
      }

      // 更新 zustand 状态（zundo 会自动保存历史）
      const objId = obj._pdfData?.id || obj._newId;
      if (objId) {
        // 对于 PdfTextObject，使用左上角坐标（和 _objectToState 保持一致）
        const isText = obj instanceof PdfTextObject;
        const left = isText ? obj.topLeft.x : obj.left;
        const top = isText ? obj.topLeft.y : obj.top;

        // 标记为本地更新，不需要恢复 Fabric 对象
        isLocalUpdateRef.current = true;
        updateObject(pageNum, objId, {
          left,
          top,
          scaleX: obj.scaleX || 1,
          scaleY: obj.scaleY || 1,
          angle: obj.angle || 0,
          width: obj.width,
          height: obj.height,
        });
      }

      const active = canvas.getActiveObject();
      if (active && onSelectionChange) onSelectionChange(active, canvas);
    });

    // 框选时过滤掉表格单元格
    const filterTableCells = (e) => {
      const selected = e.selected || [];
      const filtered = selected.filter(obj => !obj._pdfData?.tableId);

      if (filtered.length === 0) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        if (onSelectionChange) onSelectionChange(null, canvas);
      } else if (filtered.length !== selected.length) {
        if (filtered.length === 1) {
          canvas.setActiveObject(filtered[0]);
        } else {
          const activeSelection = new ActiveSelection(filtered, { canvas });
          canvas.setActiveObject(activeSelection);
        }
        canvas.requestRenderAll();
        if (onSelectionChange) onSelectionChange(filtered[0] || null, canvas);
      } else {
        if (onSelectionChange) onSelectionChange(selected[0] || null, canvas);
      }
    };

    canvas.on('selection:created', filterTableCells);
    canvas.on('selection:updated', filterTableCells);
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
      const obj = e.target;
      // 清理 TipTap 组件
      if (obj._tipTapRoot) {
        obj._tipTapRoot.unmount();
        obj._tipTapRoot = null;
      }
      if (obj._tipTapContainer) {
        obj._tipTapContainer.remove();
        obj._tipTapContainer = null;
      }
      if (obj.destroy) obj.destroy();
    });

    // ─── Load elements ──────────────────────────────────────────────────────

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

      // 收集所有元素并按 z_index 排序
      const allElements = [];

      // Drawings (non-table only)
      for (const d of (content.drawings || [])) {
        if (!d.tableId) {
          allElements.push({ type: 'drawing', z_index: d.z_index || 0, data: d });
        }
      }

      // Tables (添加表格单元格)
      for (const table of (content.tables || [])) {
        for (const row of (table.rows || [])) {
          for (const cell of (row.cells || [])) {
            cell.tableId = table.id;
            allElements.push({ type: 'tableCell', z_index: cell.z_index || 0, data: cell });
          }
        }
      }

      // Images
      for (const img of (content.images || [])) {
        allElements.push({ type: 'image', z_index: img.z_index || 0, data: img });
      }

      // Text
      const paragraphs = content.paragraphs || [];
      for (let idx = 0; idx < paragraphs.length; idx++) {
        const para = paragraphs[idx];
        allElements.push({ type: 'text', z_index: para.z_index || 0, data: para, idx });
      }

      // 按 z_index 排序
      allElements.sort((a, b) => a.z_index - b.z_index);

      // 记录最大 z_index，用于新添加的元素
      let maxZIndex = allElements.length > 0 ? Math.max(...allElements.map(e => e.z_index)) : 0;
      canvas._maxZIndex = maxZIndex;

      // 按顺序渲染所有元素
      const objectsState = [];
      for (const el of allElements) {
        if (el.type === 'drawing') {
          _addDrawingToLayer(textLayer, el.data, el.z_index);
        } else if (el.type === 'tableCell') {
          _addTableCellToLayer(textLayer, el.data, el.z_index);
        } else if (el.type === 'image') {
          await _addImageToLayer(canvas, textLayer, el.data, el.z_index);
        } else if (el.type === 'text') {
          const obj = _addParagraphToLayer(canvas, textLayer, el.data, el.idx, el.z_index);
          if (obj) objectsState.push(_objectToState(obj));
        }
      }

      canvas.requestRenderAll();

      // 初始化 zustand store（暂停历史记录，避免初始化被记录）
      const temporalState = useCanvasStore.temporal.getState();
      temporalState.pause();
      initPage(pageNum, objectsState);
      temporalState.resume();
    };

    // ─── 按 z_index 渲染到 DOM 层的函数 ────────────────────────────────────────

    const _addDrawingToLayer = (layer, d, zIndex) => {
      const pos = pdfToCanvas(d.rect, SCALE);
      const fill = d.fill ? `rgb(${Math.round(d.fill[0] * 255)},${Math.round(d.fill[1] * 255)},${Math.round(d.fill[2] * 255)})` : null;
      const stroke = d.stroke ? `rgb(${Math.round(d.stroke[0] * 255)},${Math.round(d.stroke[1] * 255)},${Math.round(d.stroke[2] * 255)})` : null;

      const div = document.createElement('div');
      div.style.cssText = `
        position: absolute;
        left: ${pos.left}px;
        top: ${pos.top}px;
        width: ${Math.max(pos.width, 1)}px;
        height: ${Math.max(pos.height, 1)}px;
        background: ${fill || 'transparent'};
        border: ${stroke ? `1px solid ${stroke}` : 'none'};
        opacity: 0.3;
        pointer-events: none;
        z-index: ${zIndex};
      `;
      div.dataset.drawingId = `draw-${d.rect.join('-')}`;
      layer.appendChild(div);
    };

    const _addTableCellToLayer = (layer, cell, zIndex) => {
      const pos = pdfToCanvas(cell.rect, SCALE);
      const fill = cell.fill ? `rgb(${Math.round(cell.fill[0] * 255)},${Math.round(cell.fill[1] * 255)},${Math.round(cell.fill[2] * 255)})` : null;

      const div = document.createElement('div');
      div.style.cssText = `
        position: absolute;
        left: ${pos.left}px;
        top: ${pos.top}px;
        width: ${pos.width}px;
        height: ${pos.height}px;
        background: ${fill || 'transparent'};
        border: none;
        opacity: 0.3;
        pointer-events: none;
        z-index: ${zIndex};
      `;
      div.dataset.cellId = cell.id;
      div.dataset.tableId = cell.tableId;
      layer.appendChild(div);
    };

    const _addImageToLayer = async (canvas, layer, img, zIndex) => {
      try {
        const pos = pdfToCanvas(img.bbox, SCALE);

        // Fabric 对象用于交互，设置为透明
        const imgObj = await FabricImage.fromURL(img.image_url);
        imgObj.set({
          left: pos.left,
          top: pos.top,
          scaleX: pos.width / imgObj.width,
          scaleY: pos.height / imgObj.height,
          originX: 'left',
          originY: 'top',
          strokeWidth: 0,
          opacity: 0,
        });
        imgObj._pdfData = {
          id: `img-${img.xref}`,
          xref: img.xref,
          originalBbox: [...img.bbox],
          imageUrl: img.image_url,
        };
        canvas.add(imgObj);

        // DOM 元素用于显示（不透明，与导出效果一致）
        const imgEl = document.createElement('img');
        imgEl.src = img.image_url;
        imgEl.style.cssText = `
          position: absolute;
          left: ${pos.left}px;
          top: ${pos.top}px;
          width: ${pos.width}px;
          height: ${pos.height}px;
          pointer-events: none;
          z-index: ${zIndex};
        `;
        imgEl.dataset.imageXref = img.xref;
        imgObj._domElement = imgEl;
        layer.appendChild(imgEl);
      } catch (e) {
        console.error('Failed to load image:', e);
      }
    };

    const _addParagraphToLayer = (canvas, layer, para, idx, zIndex) => {
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

      // 转换 inlineSpans 为 TipTap JSON
      const initialContent = convertInlineSpansToTipTap(cleanText, para.inlineSpans, SCALE);

      const textObj = new PdfTextObject({
        left: pos.left,
        top: pos.top,
        width: pos.width,
        height: pos.height,
        text: cleanText,
        fontSize: para.fontSize * SCALE,
        fontFamily: fontProps.fontFamily,
        fontWeight: fontProps.fontWeight,
        fontStyle: fontProps.fontStyle,
        color: colorStr,
        lineHeight: lineHeightRatio,
        textAlign: para.textAlign || 'left',
        _richContent: initialContent,
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

      // 创建 TipTap 编辑器容器
      const tipTapContainer = document.createElement('div');
      tipTapContainer.className = 'tiptap-wrapper';
      tipTapContainer.style.cssText = `
        position: absolute;
        left: ${pos.left}px;
        top: ${pos.top}px;
        min-width: ${pos.width}px;
        min-height: ${pos.height}px;
        background: transparent;
        pointer-events: none;
        overflow: visible;
        z-index: ${zIndex};
      `;
      tipTapContainer.dataset.textId = `para-${idx}`;
      layer.appendChild(tipTapContainer);

      // 使用 createRoot 渲染 TipTap 组件
      const editorRef = { current: null };
      const root = createRoot(tipTapContainer);

      const handleEditorReady = () => {
        // 编辑器准备好后绑定到 PdfTextObject
        _attachTipTapEvents(textObj, editorRef);
        // 初始化时测量内容宽度，避免文字被挤压
        requestAnimationFrame(() => {
          textObj._measureAndExpandWidth?.();
        });
      };

      const handleBlur = (text, html, richContent) => {
        // 编辑器失焦时的处理
        if (textObj._editing) {
          textObj.exitEditing();

          const canvasInstance = fabricRef.current;
          if (canvasInstance) canvasInstance.requestRenderAll();

          const textAfterEdit = textObj.getText();
          const richContentAfterEdit = textObj.getRichContent();
          const heightAfterEdit = textObj.height;
          const objId = textObj._pdfData?.id || textObj._newId;
          if (objId) {
            isLocalUpdateRef.current = true;
            const topLeft = textObj.topLeft;
            updateObject(pageNum, objId, {
              text: textAfterEdit,
              richContent: richContentAfterEdit,
              left: topLeft.x,
              top: topLeft.y,
              width: textObj.width,
              height: heightAfterEdit,
            });
          }
        }
      };

      const handleUpdate = (updateInfo) => {
        // TipTap 内容更新时同步高度
        handleTipTapUpdate(textObj, updateInfo);
      };

      const handleStyleChange = (style, value) => {
        // 样式变化时更新 PdfTextObject
        if (style === 'color') {
          textObj.color = value;
        } else if (style === 'fontSize') {
          textObj.fontSize = value * SCALE;
        } else if (style === 'fontFamily') {
          textObj.fontFamily = value;
        }
      };

      root.render(
        <TipTapEditor
          ref={(el) => { editorRef.current = el; }}
          content={initialContent}
          fontSize={para.fontSize * SCALE}
          fontFamily={fontProps.fontFamily}
          fontWeight={fontProps.fontWeight}
          fontStyle={fontProps.fontStyle}
          color={colorStr}
          textAlign={para.textAlign || 'left'}
          lineHeight={lineHeightRatio}
          width={pos.width}
          height={pos.height}
          onEditorReady={handleEditorReady}
          onBlur={handleBlur}
          onUpdate={handleUpdate}
          onStyleChange={handleStyleChange}
          scale={SCALE}
        />
      );

      // 存储 root 引用以便清理
      textObj._tipTapRoot = root;
      textObj._tipTapContainer = tipTapContainer;

      return textObj;
    };

    // ─── 旧的渲染函数（保留用于兼容） ────────────────────────────────────────

    const _addDrawing = (canvas, d, skipTableCheck = false) => {
      if (!skipTableCheck && d.tableId) return;

      const pos = pdfToCanvas(d.rect, SCALE);
      const fill = d.fill ? `rgb(${Math.round(d.fill[0] * 255)},${Math.round(d.fill[1] * 255)},${Math.round(d.fill[2] * 255)})` : null;
      const stroke = d.stroke ? `rgb(${Math.round(d.stroke[0] * 255)},${Math.round(d.stroke[1] * 255)},${Math.round(d.stroke[2] * 255)})` : null;

      const isLine = pos.width < 1 || pos.height < 1;

      if (isLine && stroke) {
        const line = new Line([pos.left, pos.top, pos.left + pos.width, pos.top + pos.height], {
          stroke,
          strokeWidth: 1,
          selectable: false,
          evented: false,
        });
        line._pdfData = {
          id: `draw-${d.rect.join('-')}`,
          originalRect: [...d.rect], fill: d.fill, stroke: d.stroke,
        };
        canvas.add(line);
      } else {
        const rect = new Rect({
          left: pos.left, top: pos.top, width: pos.width, height: pos.height,
          fill, stroke, strokeWidth: stroke ? 1 : 0, originX: 'left', originY: 'top', opacity: 0.3,
        });
        rect._pdfData = {
          id: `draw-${d.rect.join('-')}`,
          originalRect: [...d.rect], fill: d.fill, stroke: d.stroke,
        };
        canvas.add(rect);
      }
    };

    const _addTableCell = (canvas, cell) => {
      const pos = pdfToCanvas(cell.rect, SCALE);
      const fill = cell.fill ? `rgb(${Math.round(cell.fill[0] * 255)},${Math.round(cell.fill[1] * 255)},${Math.round(cell.fill[2] * 255)})` : null;
      const stroke = cell.stroke ? `rgb(${Math.round(cell.stroke[0] * 255)},${Math.round(cell.stroke[1] * 255)},${Math.round(cell.stroke[2] * 255)})` : null;
      const rect = new Rect({
        left: pos.left, top: pos.top, width: pos.width, height: pos.height,
        fill, stroke, strokeWidth: 0, originX: 'left', originY: 'top', opacity: 0.3,
        selectable: false,
        evented: false,
      });
      rect._pdfData = {
        id: cell.id,
        originalRect: [...cell.rect],
        fill: cell.fill,
        stroke: cell.stroke,
        tableId: cell.tableId,
      };
      canvas.add(rect);
    };

    const _addTable = (canvas, table) => {
      for (const row of (table.rows || [])) {
        for (const cell of (row.cells || [])) {
          cell.tableId = table.id;
          _addTableCell(canvas, cell);
        }
      }
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

      return textObj;
    };

    loadElements();

    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
      if (textLayer) textLayer.innerHTML = '';
    };
  }, [loaded, renderSize, hideBackground, onSelectionChange, pageNum, initPage, updateObject]);

  // ─── 监听 zustand 状态变化（撤销/重做时恢复） ─────────────────────────────

  useEffect(() => {
    if (!loaded || !fabricRef.current) return;

    const unsubscribe = useCanvasStore.subscribe((state, prevState) => {
      // 如果是本地更新，跳过恢复
      if (isLocalUpdateRef.current) {
        isLocalUpdateRef.current = false;
        return;
      }

      const prevObjects = prevState.pages[pageNum]?.objects || [];
      const currentObjects = state.pages[pageNum]?.objects || [];

      // 比较对象数组内容是否变化
      if (prevObjects.length === currentObjects.length) {
        let hasChange = false;
        for (let i = 0; i < prevObjects.length; i++) {
          const prev = prevObjects[i];
          const curr = currentObjects[i];
          if (prev.id !== curr.id ||
              prev.left !== curr.left ||
              prev.top !== curr.top ||
              prev.scaleX !== curr.scaleX ||
              prev.scaleY !== curr.scaleY ||
              prev.text !== curr.text ||
              prev.fontSize !== curr.fontSize ||
              prev.color !== curr.color ||
              JSON.stringify(prev.richContent) !== JSON.stringify(curr.richContent)) {
            hasChange = true;
            break;
          }
        }
        if (!hasChange) return;
      }

      isRestoringRef.current = true;

      const canvas = fabricRef.current;
      const fabricObjects = canvas.getObjects();

      // 恢复每个对象的状态
      currentObjects.forEach((stateObj) => {
        const fabricObj = fabricObjects.find(o =>
          (o._pdfData?.id === stateObj.id) || (o._newId === stateObj.id)
        );

        if (fabricObj) {
          // 恢复位置和尺寸
          // 对于 PdfTextObject，需要将左上角坐标转换为中心点坐标
          if (fabricObj instanceof PdfTextObject) {
            const centerLeft = stateObj.left + (fabricObj.width * (stateObj.scaleX || 1)) / 2;
            const centerTop = stateObj.top + (fabricObj.height * (stateObj.scaleY || 1)) / 2;
            fabricObj.set({
              left: centerLeft,
              top: centerTop,
              scaleX: stateObj.scaleX || 1,
              scaleY: stateObj.scaleY || 1,
              angle: stateObj.angle || 0,
            });
          } else {
            fabricObj.set({
              left: stateObj.left,
              top: stateObj.top,
              scaleX: stateObj.scaleX || 1,
              scaleY: stateObj.scaleY || 1,
              angle: stateObj.angle || 0,
            });
          }
          fabricObj.setCoords();

          // 恢复文字内容
          if (fabricObj instanceof PdfTextObject) {
            // 恢复文字内容
            if (stateObj.text !== undefined && fabricObj.getText() !== stateObj.text) {
              fabricObj.text = stateObj.text;
              if (fabricObj._textElement) {
                fabricObj._textElement.innerText = stateObj.text;
              }
            }
            // 恢复富文本内容（JSON 格式）
            if (stateObj.richContent !== undefined) {
              fabricObj._richContent = stateObj.richContent;
              // 如果有 TipTap 编辑器，尝试恢复内容
              if (fabricObj._editorRef?.current) {
                fabricObj._editorRef.current.setContent(stateObj.richContent);
              }
            }
            // 恢复字体属性
            if (stateObj.fontSize !== undefined) {
              fabricObj.fontSize = stateObj.fontSize;
              if (fabricObj._textElement) {
                fabricObj._textElement.style.fontSize = `${stateObj.fontSize}px`;
              }
            }
            if (stateObj.fontFamily !== undefined) {
              fabricObj.fontFamily = stateObj.fontFamily;
              if (fabricObj._textElement) {
                fabricObj._textElement.style.fontFamily = stateObj.fontFamily;
              }
            }
            if (stateObj.color !== undefined) {
              fabricObj.color = stateObj.color;
              if (fabricObj._textElement) {
                fabricObj._textElement.style.color = stateObj.color;
              }
            }
            fabricObj.syncToDOM();
          }
        }
      });

      canvas.requestRenderAll();

      // 立即重置标记
      isRestoringRef.current = false;
    });

    return () => unsubscribe();
  }, [loaded, pageNum]);

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
          <canvas ref={canvasElRef} style={{ position: 'absolute', left: 0, top: 0, zIndex: 1 }} />
          <div
            ref={textLayerRef}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          />
        </>
      )}
    </div>
  );
});

export default FabricCanvas;
