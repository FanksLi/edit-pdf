import { useState, useRef, useEffect } from 'react';
import { pdfToScreen } from '../utils/coordinate';

function TextBlock({ span, pageHeight, renderHeight, onEdit }) {
  const screenPos = pdfToScreen(span.bbox, pageHeight, renderHeight);
  const scale = renderHeight / pageHeight;
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(span.text);
  const editableRef = useRef(null);

  // 进入编辑模式时聚焦并选中文字
  useEffect(() => {
    if (isEditing && editableRef.current) {
      editableRef.current.focus();
      // 选中所有文字
      const range = document.createRange();
      range.selectNodeContents(editableRef.current);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [isEditing]);

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const saveEdit = () => {
    setIsEditing(false);
    const newText = editableRef.current?.innerText.trim() || text;
    if (newText !== span.text) {
      onEdit({
        bbox: span.bbox,
        newText: newText,
        fontSize: span.fontSize,
        origin: span.origin,
      });
    } else {
      setText(span.text);
    }
  };

  const cancelEdit = () => {
    setText(span.text);
    setIsEditing(false);
  };

  const handleBlur = () => {
    saveEdit();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
    if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  return (
    <div
      className={`
        absolute cursor-pointer
        transition-all duration-150
        ${isEditing
          ? 'border-2 border-blue-500 bg-white/90 z-10 shadow-sm'
          : 'border border-red-400/50 bg-transparent'}
      `}
      style={{
        left: screenPos.left,
        top: screenPos.top,
        minWidth: screenPos.width,
        height: screenPos.height,
        fontSize: span.fontSize * scale,
        lineHeight: '1.2',
      }}
      onDoubleClick={handleDoubleClick}
      title={`PDF bbox: [${span.bbox.join(', ')}]`}
    >
      <span
        ref={editableRef}
        contentEditable={isEditing}
        suppressContentEditableWarning
        className={`
          block h-full px-1 outline-none whitespace-nowrap
          ${isEditing ? 'text-black select-text cursor-text' : 'text-black/0 select-none'}
        `}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      >
        {text}
      </span>
    </div>
  );
}

export default TextBlock;
