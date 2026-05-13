/**
 * PDF 坐标转屏幕坐标
 * PyMuPDF 返回的 bbox 坐标系: 左上角原点，Y 向下（与屏幕一致）
 * 只需做 scale 缩放，无需翻转 Y 轴
 *
 * @param {number[]} pdfBbox - PyMuPDF bbox [x0, y0, x1, y1]
 * @param {number} pageHeight - PDF 页面高度
 * @param {number} renderHeight - 渲染图片高度
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function pdfToScreen(pdfBbox, pageHeight, renderHeight) {
  const [x0, y0, x1, y1] = pdfBbox;
  const scale = renderHeight / pageHeight;
  return {
    left: x0 * scale,
    top: y0 * scale,
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
  const y0 = top * scale;
  const x1 = x0 + width * scale;
  const y1 = y0 + height * scale;
  return [x0, y0, x1, y1];
}