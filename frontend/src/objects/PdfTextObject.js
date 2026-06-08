import { Rect, classRegistry } from 'fabric';

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
      ...options,
      left: centerLeft,
      top: centerTop,
    });
    this.text = options.text || '';
    this.fontSize = options.fontSize || 16;
    this.fontFamily = options.fontFamily || 'Arial';
    this.fontWeight = options.fontWeight || 'normal';
    this.fontStyle = options.fontStyle || 'normal';
    this.color = options.color || '#000000';
    this.lineHeight = options.lineHeight || 1.2;
    this.textAlign = options.textAlign || 'left';
    this._textElement = null;
    this._editing = false;
    this._pdfData = options._pdfData || null;
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

  bindElement(el) {
    this._textElement = el;
    this.syncToDOM();
  }

  syncToDOM() {
    const el = this._textElement;
    if (!el) return;
    const tl = this.topLeft;
    el.style.left = `${tl.x}px`;
    el.style.top = `${tl.y}px`;
    el.style.width = `${this.width * (this.scaleX || 1)}px`;
    el.style.height = `${this.height * (this.scaleY || 1)}px`;
  }

  enterEditing() {
    if (this._editing) return;
    this._editing = true;
    this._originalHeight = this.height;
    this.lockMovementX = true;
    this.lockMovementY = true;
    this.lockScalingX = true;
    this.lockScalingY = true;
    this.lockRotation = true;
    this.hasControls = false;
    const el = this._textElement;
    if (el) {
      el.style.pointerEvents = 'auto';
      el.style.overflow = 'visible';
      el.style.height = 'auto';
      el.style.background = 'rgba(59,130,246,0.05)';
      el.contentEditable = 'plaintext-only';
      el.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  exitEditing() {
    if (!this._editing) return;
    this._editing = false;
    this.lockMovementX = false;
    this.lockMovementY = false;
    this.lockScalingX = false;
    this.lockScalingY = false;
    this.lockRotation = false;
    this.hasControls = true;
    const el = this._textElement;
    if (el) {
      this.text = el.innerText || '';
      el.style.pointerEvents = 'none';
      el.style.overflow = 'hidden';
      el.style.background = 'transparent';
      el.contentEditable = 'false';
    }
    // Restore original height
    if (this._originalHeight != null) {
      this.set('height', this._originalHeight);
      delete this._originalHeight;
    }
    this.syncToDOM();
  }

  /** Grow the Fabric object to match DOM element scrollHeight during editing */
  syncHeight() {
    const el = this._textElement;
    if (!el || !this._editing) return;
    const scrollH = el.scrollHeight;
    const origH = this._originalHeight || this.height;
    if (scrollH > origH) {
      // Keep top edge fixed: adjust center downward by half the growth
      const growth = scrollH - this.height;
      this.set({ height: scrollH, top: this.top + growth / 2 });
      this.setCoords();
      this.canvas?.requestRenderAll();
    }
  }

  getText() {
    return this._textElement?.innerText || this.text;
  }

  /** Get scaled bounding box in top-left coordinates */
  getBounding() {
    const tl = this.topLeft;
    return {
      left: tl.x,
      top: tl.y,
      width: this.width * (this.scaleX || 1),
      height: this.height * (this.scaleY || 1),
    };
  }

  updateProperty(prop, value) {
    const el = this._textElement;
    switch (prop) {
      case 'fontFamily':
        this.fontFamily = value;
        if (el) el.style.fontFamily = value;
        break;
      case 'fontSize':
        this.fontSize = value;
        if (el) el.style.fontSize = `${value}px`;
        break;
      case 'fontWeight':
        this.fontWeight = value;
        if (el) el.style.fontWeight = value;
        break;
      case 'fontStyle':
        this.fontStyle = value;
        if (el) el.style.fontStyle = value;
        break;
      case 'fill':
        this.color = value;
        if (el) el.style.color = value;
        break;
      case 'textAlign':
        this.textAlign = value;
        if (el) el.style.textAlign = value;
        break;
      case 'scaleX':
        this.set('scaleX', value);
        this.syncToDOM();
        break;
      case 'scaleY':
        this.set('scaleY', value);
        this.syncToDOM();
        break;
    }
  }

  destroy() {
    if (this._textElement) {
      this._textElement.remove();
      this._textElement = null;
    }
  }
}

classRegistry.setClass(PdfTextObject, 'PdfText');

export default PdfTextObject;
