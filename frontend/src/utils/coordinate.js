/**
 * PDF bbox 坐标转 Fabric Canvas 像素坐标
 * PyMuPDF 和 Fabric.js 都是左上角原点 Y-down，只需 scale
 */
export function pdfToCanvas(pdfBbox, scale) {
  const [x0, y0, x1, y1] = pdfBbox;
  return {
    left: x0 * scale,
    top: y0 * scale,
    width: (x1 - x0) * scale,
    height: (y1 - y0) * scale,
  };
}

/**
 * Fabric Canvas 像素坐标转 PDF bbox
 */
export function canvasToPdf(left, top, width, height, scale) {
  const inv = 1 / scale;
  return [left * inv, top * inv, (left + width) * inv, (top + height) * inv];
}
