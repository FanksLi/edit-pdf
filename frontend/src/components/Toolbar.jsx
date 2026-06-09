import { useRef } from 'react';

const FONT_OPTIONS = [
  { family: 'Arimo', display_name: 'Arimo' },
  { family: 'Caladea', display_name: 'Caladea' },
  { family: 'Carlito', display_name: 'Carlito' },
  { family: 'Cousine', display_name: 'Cousine' },
  { family: 'Liberation_Serif', display_name: 'Liberation Serif' },
  { family: 'Open_Sans', display_name: 'Open Sans' },
  { family: 'Roboto', display_name: 'Roboto' },
  { family: 'Roboto_Mono', display_name: 'Roboto Mono' },
  { family: 'SimHei', display_name: 'SimHei (黑体)' },
  { family: 'Tinos', display_name: 'Tinos' },
];

function Toolbar({
  selectionSnapshot,
  fonts,
  onAddText,
  onAddImage,
  onDelete,
  onPropertyChange,
  // 新增：局部样式回调
  onInlineStyleChange,
  // 新增：当前编辑状态
  editingState,
}) {
  const fileInputRef = useRef(null);

  // 检测是否正在编辑文本
  const isEditingText = editingState?.isEditing && editingState?.hasSelection;

  // 如果正在编辑且有选中文字，显示局部样式工具
  if (isEditingText) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-200 overflow-x-auto">
        <span className="text-xs text-blue-600 font-medium">选中文字样式:</span>

        {/* 粗体 */}
        <button
          onClick={() => onInlineStyleChange?.('bold')}
          className={`px-2 py-1 rounded text-sm font-bold ${
            editingState?.activeStyles?.bold
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
          } cursor-pointer`}
          title="粗体"
        >
          B
        </button>

        {/* 斜体 */}
        <button
          onClick={() => onInlineStyleChange?.('italic')}
          className={`px-2 py-1 rounded text-sm italic ${
            editingState?.activeStyles?.italic
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
          } cursor-pointer`}
          title="斜体"
        >
          I
        </button>

        {/* 下划线 */}
        <button
          onClick={() => onInlineStyleChange?.('underline')}
          className={`px-2 py-1 rounded text-sm underline ${
            editingState?.activeStyles?.underline
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
          } cursor-pointer`}
          title="下划线"
        >
          U
        </button>

        {/* 删除线 */}
        <button
          onClick={() => onInlineStyleChange?.('strikethrough')}
          className={`px-2 py-1 rounded text-sm line-through ${
            editingState?.activeStyles?.strikethrough
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
          } cursor-pointer`}
          title="删除线"
        >
          S
        </button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* 颜色 */}
        <input
          type="color"
          value={editingState?.activeStyles?.color || '#000000'}
          onChange={(e) => onInlineStyleChange?.('color', e.target.value)}
          className="w-8 h-8 border border-gray-300 rounded cursor-pointer"
          title="文字颜色"
        />

        <div className="flex-1" />

        <span className="text-xs text-gray-500">选择文字后可修改局部样式</span>
      </div>
    );
  }

  if (!selectionSnapshot) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto">
        <button
          onClick={onAddText}
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-medium whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          文本
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded text-sm font-medium whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          图片
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onAddImage}
        />
      </div>
    );
  }

  const isNewElement = selectionSnapshot?._newElement;
  const isText = selectionSnapshot?.type === 'textbox' || selectionSnapshot?.type === 'i-text' || selectionSnapshot?.type === 'PdfText';
  const isImage = selectionSnapshot?.type === 'image';

  if (isText) {
    const currentFont = selectionSnapshot?._elementProps?.fontFamily
      || selectionSnapshot?._originalFontName
      || 'Roboto';
    const fontInfo = fonts?.find(f => f.family === currentFont);
    const variants = fontInfo?.variants || ['regular'];
    const supportsBold = variants.includes('bold') || variants.includes('bolditalic');
    const supportsItalic = variants.includes('italic') || variants.includes('bolditalic');

    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto">
        {/* 字体选择 */}
        <select
          value={FONT_OPTIONS.some(f => f.family === currentFont) ? currentFont : ''}
          onChange={(e) => onPropertyChange('fontFamily', e.target.value)}
          className="px-2 py-1 border border-gray-300 rounded text-sm bg-white max-w-[140px]"
        >
          {!FONT_OPTIONS.some(f => f.family === currentFont) && (
            <option value="" disabled>{currentFont}</option>
          )}
          {FONT_OPTIONS.map(f => (
            <option key={f.family} value={f.family}>{f.display_name}</option>
          ))}
        </select>

        {/* 字号 */}
        <input
          type="number"
          value={Math.round((selectionSnapshot?.fontSize || 16) / (150 / 72))}
          onChange={(e) => {
            const pdfSize = parseFloat(e.target.value) || 12;
            onPropertyChange('fontSize', pdfSize * (150 / 72));
          }}
          className="w-14 px-2 py-1 border border-gray-300 rounded text-sm text-center"
          min="6"
          max="72"
        />

        {/* 粗体 */}
        <button
          onClick={() => onPropertyChange('fontWeight', selectionSnapshot?.fontWeight === 'bold' ? 'normal' : 'bold')}
          disabled={!supportsBold}
          className={`px-2 py-1 rounded text-sm font-bold ${
            selectionSnapshot?.fontWeight === 'bold'
              ? 'bg-gray-700 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          } ${!supportsBold ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
          title={supportsBold ? '粗体' : '该字体不支持粗体'}
        >
          B
        </button>

        {/* 斜体 */}
        <button
          onClick={() => onPropertyChange('fontStyle', selectionSnapshot?.fontStyle === 'italic' ? 'normal' : 'italic')}
          disabled={!supportsItalic}
          className={`px-2 py-1 rounded text-sm italic ${
            selectionSnapshot?.fontStyle === 'italic'
              ? 'bg-gray-700 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          } ${!supportsItalic ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
          title={supportsItalic ? '斜体' : '该字体不支持斜体'}
        >
          I
        </button>

        {/* 颜色 */}
        <input
          type="color"
          value={selectionSnapshot?.fill || '#000000'}
          onChange={(e) => onPropertyChange('fill', e.target.value)}
          className="w-8 h-8 border border-gray-300 rounded cursor-pointer"
          title="文字颜色"
        />

        {/* 对齐 */}
        {isNewElement && (
          <>
            <button
              onClick={() => onPropertyChange('textAlign', 'left')}
              className={`px-2 py-1 rounded text-sm ${
                selectionSnapshot?.textAlign === 'left' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              } cursor-pointer`}
              title="左对齐"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h18v2H3zm0 4h12v2H3zm0 4h18v2H3zm0 4h12v2H3z"/></svg>
            </button>
            <button
              onClick={() => onPropertyChange('textAlign', 'center')}
              className={`px-2 py-1 rounded text-sm ${
                selectionSnapshot?.textAlign === 'center' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              } cursor-pointer`}
              title="居中"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h18v2H3zm3 4h12v2H6zm-3 4h18v2H3zm3 4h12v2H6z"/></svg>
            </button>
            <button
              onClick={() => onPropertyChange('textAlign', 'right')}
              className={`px-2 py-1 rounded text-sm ${
                selectionSnapshot?.textAlign === 'right' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              } cursor-pointer`}
              title="右对齐"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h18v2H3zm6 4h12v2H9zm-6 4h18v2H3zm6 4h12v2H9z"/></svg>
            </button>
          </>
        )}

        <div className="flex-1" />

        {/* 删除 */}
        <button
          onClick={onDelete}
          className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-600 rounded text-sm cursor-pointer"
          title="删除"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    );
  }

  if (isImage) {
    const origW = selectionSnapshot?._elementProps?.originalWidth || selectionSnapshot?.width;
    const origH = selectionSnapshot?._elementProps?.originalHeight || selectionSnapshot?.height;
    const displayW = Math.round(origW * selectionSnapshot?.scaleX);
    const displayH = Math.round(origH * selectionSnapshot?.scaleY);
    const angle = Math.round(selectionSnapshot?.angle || 0);

    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto">
        {/* 宽度 */}
        <label className="flex items-center gap-1 text-sm text-gray-600 whitespace-nowrap">
          W
          <input
            type="number"
            value={displayW}
            onChange={(e) => {
              const newW = parseFloat(e.target.value) || 1;
              onPropertyChange('scaleX', newW / origW);
            }}
            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center"
          />
        </label>

        {/* 高度 */}
        <label className="flex items-center gap-1 text-sm text-gray-600 whitespace-nowrap">
          H
          <input
            type="number"
            value={displayH}
            onChange={(e) => {
              const newH = parseFloat(e.target.value) || 1;
              onPropertyChange('scaleY', newH / origH);
            }}
            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center"
          />
        </label>

        {/* 旋转 */}
        <label className="flex items-center gap-1 text-sm text-gray-600 whitespace-nowrap">
          旋转
          <input
            type="number"
            value={angle}
            onChange={(e) => onPropertyChange('angle', parseFloat(e.target.value) || 0)}
            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center"
          />
          °
        </label>

        <div className="flex-1" />

        {/* 删除 */}
        <button
          onClick={onDelete}
          className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-600 rounded text-sm cursor-pointer"
          title="删除"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    );
  }

  // Other element types (existing PDF elements)
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200">
      <span className="text-sm text-gray-500">已选中元素</span>
      <div className="flex-1" />
      <button
        onClick={onDelete}
        className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-600 rounded text-sm cursor-pointer"
        title="删除"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}

export default Toolbar;
