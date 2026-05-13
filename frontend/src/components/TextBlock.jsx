import { useState, useRef, useEffect } from 'react';
import { pdfToScreen } from '../utils/coordinate';

function TextBlock({ span, pageHeight, renderHeight, onEdit }) {
  const screenPos = pdfToScreen(span.bbox, pageHeight, renderHeight);
  const scale = renderHeight / pageHeight;
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(span.text);
  const inputRef = useRef(null);

  // 进入编辑模式时聚焦
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (text !== span.text) {
      onEdit({
        bbox: span.bbox,
        newText: text,
        fontSize: span.fontSize,
        origin: span.origin,
      });
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBlur();
    }
    if (e.key === 'Escape') {
      setText(span.text);
      setIsEditing(false);
    }
  };

  return (
    <div
      className={`
        absolute cursor-pointer select-none
        transition-all duration-150
        ${isEditing
          ? 'border-2 border-blue-500 bg-white z-10 shadow-sm'
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
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-auto min-w-full h-full px-1 outline-none text-black bg-transparent"
          style={{ fontSize: 'inherit', lineHeight: 'inherit' }}
        />
      ) : (
        <span className="opacity-0 block whitespace-nowrap">{text}</span>
      )}
    </div>
  );
}

export default TextBlock;