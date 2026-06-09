import { Rect, classRegistry } from 'fabric';

/**
 * PdfTextObject - PDF 文本段落对象
 *
 * 作为 Fabric.js 的交互层，管理位置、尺寸和选择框
 * 实际文本渲染由 TipTap 编辑器完成
 */
class PdfTextObject extends Rect {
  static type = 'PdfText';

  constructor(options = {}) {
    // Convert left/top origin to center origin for Fabric
    const width = options.width || 100;
    const height = options.height || 40;
    const centerLeft = (options.left || 0) + width / 2;
    const centerTop = (options.top || 0) + height / 2;

    super({
      fill: 'rgba(0,0,0,0.001)',
      stroke: null,
      strokeWidth: 0,
      objectCaching: false,
      originX: 'center',
      originY: 'center',
      transparentCorners: false,
      cornerColor: '#3b82f6',
      cornerSize: 8,
      cornerStrokeColor: '#fff',
      borderColor: '#3b82f6',
      borderDashArray: [4, 4],
      padding: 4,
      strokeUniform: true,
      lockRotation: true,       // 锁定旋转
      ...options,
      left: centerLeft,
      top: centerTop,
    });

    // 删除旋转控制点
    delete this.controls.mtr;

    // 文本属性
    this.text = options.text || '';
    this.fontSize = options.fontSize || 16;
    this.fontFamily = options.fontFamily || 'Arial';
    this.fontWeight = options.fontWeight || 'normal';
    this.fontStyle = options.fontStyle || 'normal';
    this.color = options.color || '#000000';
    this.lineHeight = options.lineHeight || 1.2;
    this.textAlign = options.textAlign || 'left';

    // TipTap 编辑器引用
    this._editorRef = null;
    this._editing = false;

    // PDF 数据
    this._pdfData = options._pdfData || null;

    // 富文本内容（HTML 或 JSON）
    this._richContent = options._richContent || null;
  }

  _render(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.001)';
    ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
  }

  /** Get top-left position (for DOM element positioning) */
  get topLeft() {
    return {
      x: this.left - (this.width * (this.scaleX || 1)) / 2,
      y: this.top - (this.height * (this.scaleY || 1)) / 2,
    };
  }

  /**
   * 绑定 TipTap 编辑器引用
   * @param {Object} editorRef - TipTap 编辑器的 ref 对象
   */
  bindEditor(editorRef) {
    this._editorRef = editorRef;
    this.syncToDOM();
  }

  /**
   * 同步位置和尺寸到 DOM
   */
  syncToDOM() {
    // 直接更新 TipTap wrapper 容器（_tipTapContainer）
    const container = this._tipTapContainer;
    if (!container) return;

    const tl = this.topLeft;
    const w = this.width * (this.scaleX || 1);
    const h = this.height * (this.scaleY || 1);
    container.style.left = `${tl.x}px`;
    container.style.top = `${tl.y}px`;
    container.style.width = `${w}px`;
    container.style.minHeight = `${h}px`;

    // 同步 TipTap 编辑器元素宽度和溢出设置
    const editorEl = this._editorRef?.current?.getEditor?.()?.options?.element;
    if (editorEl) {
      editorEl.style.width = `${w}px`;
      editorEl.style.minHeight = `${h}px`;
      editorEl.style.overflow = 'visible';
    }
  }

  /**
   * 进入编辑模式
   */
  enterEditing() {
    if (this._editing) return;
    this._editing = true;
    this._originalHeight = this.height;
    this._originalWidth = this.width * (this.scaleX || 1);

    // 锁定 Fabric 对象的交互
    this.lockMovementX = true;
    this.lockMovementY = true;
    this.lockScalingX = true;
    this.lockScalingY = true;
    this.lockRotation = true;
    this.hasControls = false;

    // 激活 TipTap 编辑器
    if (this._editorRef?.current) {
      this._editorRef.current.enterEditing();

      // 设置容器可交互
      const containerEl = this._editorRef.current?.getEditor?.()?.options?.element?.parentElement;
      if (containerEl) {
        containerEl.style.pointerEvents = 'auto';
        containerEl.style.overflow = 'visible';
        containerEl.style.background = 'rgba(59,130,246,0.05)';
      }

      // 测量实际内容宽度，如果超出当前宽度则扩展
      this._measureAndExpandWidth();
    }
  }

  /**
   * 测量内容实际宽度，超出时扩展容器
   */
  _measureAndExpandWidth() {
    const editorEl = this._editorRef?.current?.getEditor?.()?.options?.element;
    if (!editorEl) return;

    let maxLineWidth = 0;
    const doc = this._editorRef?.current?.getEditor?.()?.state?.doc;
    if (!doc) return;

    const computedStyle = window.getComputedStyle(editorEl);
    const measureSpan = document.createElement('span');
    measureSpan.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: pre;
      font-size: ${computedStyle.fontSize};
      font-family: ${computedStyle.fontFamily};
      font-weight: ${computedStyle.fontWeight};
      font-style: ${computedStyle.fontStyle};
    `;
    document.body.appendChild(measureSpan);

    doc.descendants((node) => {
      if (node.isText && node.text) {
        measureSpan.textContent = node.text;
        const w = measureSpan.offsetWidth;
        if (w > maxLineWidth) maxLineWidth = w;
      }
    });

    document.body.removeChild(measureSpan);

    const currentWidth = this.width * (this.scaleX || 1);
    // 只有内容宽度明显超出当前宽度才扩展（容差 10px 避免测量误差）
    if (maxLineWidth > currentWidth + 10) {
      const newWidth = maxLineWidth + 8; // padding
      // 宽度增加时，保持左边缘固定，中心点向右移动
      const deltaWidth = newWidth - currentWidth;
      this.set({
        width: newWidth,
        scaleX: 1,
        left: this.left + deltaWidth / 2
      });
      this.setCoords();

      const container = this._tipTapContainer;
      if (container) {
        container.style.width = `${newWidth}px`;
      }
      editorEl.style.width = `${newWidth}px`;

      this.canvas?.requestRenderAll();
    }
  }

  /**
   * 退出编辑模式
   */
  exitEditing() {
    if (!this._editing) return;
    this._editing = false;

    // 解锁 Fabric 对象的交互
    this.lockMovementX = false;
    this.lockMovementY = false;
    this.lockScalingX = false;
    this.lockScalingY = false;
    this.lockRotation = false;
    this.hasControls = true;

    // 退出 TipTap 编辑器
    if (this._editorRef?.current) {
      // 获取编辑后的内容
      this.text = this._editorRef.current.getText() || '';
      this._richContent = this._editorRef.current.getJSON();

      this._editorRef.current.exitEditing();

      // 设置容器不可交互
      const containerEl = this._editorRef.current?.getEditor?.()?.options?.element?.parentElement;
      if (containerEl) {
        containerEl.style.pointerEvents = 'none';
        containerEl.style.overflow = 'visible';
        containerEl.style.background = 'transparent';
      }

      // 更新高度以匹配实际内容，保持顶部边缘固定
      const scrollH = containerEl?.scrollHeight || this.height;
      if (scrollH !== this.height) {
        const heightDelta = scrollH - this.height;
        this.set('height', scrollH);
        this.set('top', this.top + heightDelta / 2);
        this.setCoords();
      }
    }

    delete this._originalHeight;
    this.syncToDOM();
  }

  /**
   * 同步编辑器高度和宽度（编辑时调用）
   */
  syncHeight() {
    if (!this._tipTapContainer) return;

    const editorEl = this._editorRef?.current?.getEditor?.()?.options?.element;
    if (!editorEl) return;

    const scrollH = editorEl.scrollHeight;
    const origH = this._originalHeight || this.height;

    // 高度增加时更新
    if (scrollH > origH) {
      const growth = scrollH - this.height;
      this.set({ height: scrollH, top: this.top + growth / 2 });
      this._tipTapContainer.style.minHeight = `${scrollH}px`;
    }

    // 测量实际内容宽度
    let maxLineWidth = 0;
    const doc = this._editorRef?.current?.getEditor?.()?.state?.doc;
    if (doc) {
      doc.descendants((node) => {
        if (node.isText && node.text) {
          const span = document.createElement('span');
          span.style.cssText = `
            position: absolute;
            visibility: hidden;
            white-space: pre;
            font-size: ${editorEl.style.fontSize};
            font-family: ${editorEl.style.fontFamily};
            font-weight: ${editorEl.style.fontWeight};
            font-style: ${editorEl.style.fontStyle};
          `;
          span.textContent = node.text;
          document.body.appendChild(span);
          const w = span.offsetWidth;
          document.body.removeChild(span);
          if (w > maxLineWidth) maxLineWidth = w;
        }
      });
    }

    // 宽度超出时更新
    const currentWidth = this.width * (this.scaleX || 1);
    if (maxLineWidth > currentWidth) {
      const newWidth = maxLineWidth + 8; // 加 padding
      this.set({ width: newWidth });
      this._tipTapContainer.style.width = `${newWidth}px`;
    }

    this.setCoords();
    this.canvas?.requestRenderAll();
  }

  /**
   * 获取文本内容
   */
  getText() {
    if (this._editorRef?.current) {
      return this._editorRef.current.getText() || this.text;
    }
    return this.text;
  }

  /**
   * 获取富文本内容（JSON 格式）
   */
  getRichContent() {
    if (this._editorRef?.current) {
      return this._editorRef.current.getJSON();
    }
    return this._richContent;
  }

  /**
   * 设置富文本内容
   */
  setRichContent(json) {
    this._richContent = json;
    if (this._editorRef?.current) {
      // 使用 TipTap 的 setContent 命令来更新内容
      this._editorRef.current.setContent(json);
    }
  }

  /**
   * 获取缩放后的边界框（左上角坐标）
   */
  getBounding() {
    const tl = this.topLeft;
    return {
      left: tl.x,
      top: tl.y,
      width: this.width * (this.scaleX || 1),
      height: this.height * (this.scaleY || 1),
    };
  }

  /**
   * 更新属性
   */
  updateProperty(prop, value) {
    const editorRef = this._editorRef?.current;

    switch (prop) {
      case 'fontFamily':
        this.fontFamily = value;
        if (editorRef) {
          editorRef.applyStyle('fontFamily', value);
        }
        break;
      case 'fontSize':
        this.fontSize = value;
        if (editorRef) {
          editorRef.applyStyle('fontSize', value);
        }
        break;
      case 'fontWeight':
        this.fontWeight = value;
        if (editorRef) {
          editorRef.applyStyle('fontWeight', value);
        }
        break;
      case 'fontStyle':
        this.fontStyle = value;
        if (editorRef) {
          editorRef.applyStyle('fontStyle', value);
        }
        break;
      case 'fill':
        this.color = value;
        if (editorRef) {
          editorRef.applyStyle('color', value);
        }
        break;
      case 'textAlign':
        this.textAlign = value;
        if (editorRef) {
          editorRef.applyStyle('textAlign', value);
        }
        break;
      case 'scaleX':
        this.set('scaleX', value);
        this.syncToDOM();
        break;
      case 'scaleY':
        this.set('scaleY', value);
        this.syncToDOM();
        break;
      // TipTap 样式
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strikethrough':
        if (editorRef) {
          editorRef.applyStyle(prop, value);
        }
        break;
    }

    this.setCoords();
    this.canvas?.requestRenderAll();
  }

  /**
   * 应用样式到选中文字
   */
  applyStyleToSelection(style, value) {
    if (this._editorRef?.current) {
      this._editorRef.current.applyStyle(style, value);
    }
  }

  /**
   * 获取当前选中的样式
   */
  getActiveStyles() {
    if (this._editorRef?.current) {
      return this._editorRef.current.getActiveStyles();
    }
    return {};
  }

  /**
   * 检查是否有选中文字
   */
  hasSelection() {
    if (this._editorRef?.current) {
      return this._editorRef.current.hasSelection();
    }
    return false;
  }

  /**
   * 销毁对象
   */
  destroy() {
    if (this._editorRef?.current) {
      const editor = this._editorRef.current.getEditor?.();
      if (editor) {
        editor.destroy();
      }
    }
    this._editorRef = null;
  }
}

classRegistry.setClass(PdfTextObject, 'PdfText');

export default PdfTextObject;
