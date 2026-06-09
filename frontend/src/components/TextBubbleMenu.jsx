import { useState, useEffect } from 'react';
import { BubbleMenu } from '@tiptap/react';

/**
 * TipTap 气泡菜单组件
 * 选中文字时显示快速样式操作
 */
function TextBubbleMenu({ editor, onStyleChange }) {
  const [activeStyles, setActiveStyles] = useState({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
  });

  useEffect(() => {
    if (!editor) return;

    const updateActiveStyles = () => {
      setActiveStyles({
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strikethrough: editor.isActive('strike'),
      });
    };

    editor.on('transaction', updateActiveStyles);
    return () => {
      editor.off('transaction', updateActiveStyles);
    };
  }, [editor]);

  if (!editor) return null;

  const handleStyleToggle = (style) => {
    editor.chain().focus();
    switch (style) {
      case 'bold':
        editor.chain().toggleBold().run();
        break;
      case 'italic':
        editor.chain().toggleItalic().run();
        break;
      case 'underline':
        editor.chain().toggleUnderline().run();
        break;
      case 'strikethrough':
        editor.chain().toggleStrike().run();
        break;
    }
    if (onStyleChange) {
      onStyleChange(style, !activeStyles[style]);
    }
  };

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{
        duration: 150,
        placement: 'top',
      }}
      className="bubble-menu"
    >
      <button
        type="button"
        onClick={() => handleStyleToggle('bold')}
        className={`bubble-menu-btn ${activeStyles.bold ? 'is-active' : ''}`}
        title="加粗"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        onClick={() => handleStyleToggle('italic')}
        className={`bubble-menu-btn ${activeStyles.italic ? 'is-active' : ''}`}
        title="斜体"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        onClick={() => handleStyleToggle('underline')}
        className={`bubble-menu-btn ${activeStyles.underline ? 'is-active' : ''}`}
        title="下划线"
      >
        <u>U</u>
      </button>
      <button
        type="button"
        onClick={() => handleStyleToggle('strikethrough')}
        className={`bubble-menu-btn ${activeStyles.strikethrough ? 'is-active' : ''}`}
        title="删除线"
      >
        <s>S</s>
      </button>
    </BubbleMenu>
  );
}

export default TextBubbleMenu;
