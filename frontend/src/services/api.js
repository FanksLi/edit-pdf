const API_BASE = '/api/pdf';

/**
 * 上传 PDF 文件
 * @param {File} file
 * @returns {Promise<{ file_id: string, page_count: number, page_width: number, page_height: number }>}
 */
export async function uploadPDF(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error || 'Upload failed');
  }
  return res.json();
}

/**
 * 获取页面文字数据
 * @param {string} fileId
 * @param {number} pageNum
 * @returns {Promise<{ page_width: number, page_height: number, spans: Array, images: Array }>}
 */
export async function getPageText(fileId, pageNum) {
  const res = await fetch(`${API_BASE}/${fileId}/page/${pageNum}/text`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Get text failed' }));
    throw new Error(error.error || 'Get text failed');
  }
  return res.json();
}

/**
 * 获取页面渲染图片
 * @param {string} fileId
 * @param {number} pageNum
 * @param {number} dpi
 * @returns {Promise<{ image_url: string, width: number, height: number, dpi: number }>}
 */
export async function getPageRender(fileId, pageNum, dpi = 150) {
  const res = await fetch(`${API_BASE}/${fileId}/page/${pageNum}/render?dpi=${dpi}`);
  if (!res.ok) {
    throw new Error('Get render failed');
  }
  return res.json();
}

/**
 * 修改页面（文字 + 图片）
 * @param {string} fileId
 * @param {number} pageNum
 * @param {Array} textEdits
 * @param {Array} imageEdits
 * @returns {Promise<{ image_url: string, text_data: Array, images: Array }>}
 */
export async function modifyPage(fileId, pageNum, textEdits = [], imageEdits = []) {
  const res = await fetch(`${API_BASE}/${fileId}/page/${pageNum}/modify?dpi=150`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text_edits: textEdits, image_edits: imageEdits }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Modify failed' }));
    throw new Error(error.error || 'Modify failed');
  }
  return res.json();
}

/**
 * 导出修改后的 PDF
 * @param {string} fileId
 * @returns {Promise<Blob>}
 */
export async function exportPDF(fileId) {
  const res = await fetch(`${API_BASE}/${fileId}/export`);
  if (!res.ok) {
    throw new Error('Export failed');
  }
  return res.blob();
}
