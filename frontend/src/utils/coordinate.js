/**
 * PDF 坐标转屏幕坐标
 * PDF: 左下角原点，Y 向上
 * Screen: 左上角原点，Y 向下
 *
 * @param {number[]} pdfBbox - PDF bbox [x0, y0, x1, y1]
 * @param {number} pageHeight - PDF 页面高度
 * @param {number} renderHeight - 渲染图片高度
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function pdfToScreen(pdfBbox, pageHeight, renderHeight) {
  const [x0, y0, x1, y1] = pdfBbox;
  const scale = renderHeight / pageHeight;
  return {
    left: x0 * scale,
    top: renderHeight - y1 * scale,
    width: (x1 - x0) * scale,
    height: (y1 - y0) * scale,
  };
}

/**
 * 屏幕坐标转 PDF 坐标（用于提交编辑）
 *
 * @param {{ left: number, top: number, width: number, height: number }} screenBox
 * @param {number} pageHeight
 * @param {number} renderHeight
 * @returns {number[]} PDF bbox [x0, y0, x1, y1]
 */
export function screenToPdf(screenBox, pageHeight, renderHeight) {
  const { left, top, width, height } = screenBox;
  const scale = pageHeight / renderHeight;
  const x0 = left * scale;
  const y1 = (renderHeight - top) * scale;
  const x1 = x0 + width * scale;
  const y0 = y1 - height * scale;
  return [x0, y0, x1, y1];
}