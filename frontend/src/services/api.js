const API_BASE = '/api/pdf';

/**
 * 上传 PDF 文件
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
 * 获取页面段落和图片数据
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
 */
export async function getPageRender(fileId, pageNum, dpi = 150) {
  const res = await fetch(`${API_BASE}/${fileId}/page/${pageNum}/render?dpi=${dpi}`);
  if (!res.ok) {
    throw new Error('Get render failed');
  }
  return res.json();
}

/**
 * 修改页面（段落 + 图片）
 */
export async function modifyPage(fileId, pageNum, paragraphEdits = [], imageEdits = []) {
  const res = await fetch(`${API_BASE}/${fileId}/page/${pageNum}/modify?dpi=150`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paragraph_edits: paragraphEdits, image_edits: imageEdits }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Modify failed' }));
    throw new Error(error.error || 'Modify failed');
  }
  return res.json();
}

/**
 * 多页统一导出：接收所有页的编辑，一次性导出完整 PDF
 */
export async function exportAllPages(fileId, pagesEdits) {
  const res = await fetch(`${API_BASE}/${fileId}/export_all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages: pagesEdits }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Export failed' }));
    throw new Error(error.detail || 'Export failed');
  }
  return res.blob();
}

/**
 * 获取页面缩略图（低 DPI 渲染）
 */
export async function getPageThumbnail(fileId, pageNum) {
  return getPageRender(fileId, pageNum, 50);
}

/**
 * 获取可用字体列表
 */
export async function getFonts() {
  const res = await fetch(`${API_BASE}/fonts`);
  if (!res.ok) {
    throw new Error('Get fonts failed');
  }
  return res.json();
}

/**
 * 上传图片
 */
export async function uploadImage(fileId, file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/${fileId}/upload_image`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Upload image failed' }));
    throw new Error(error.error || 'Upload image failed');
  }
  return res.json();
}
