import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import { TextStyle } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';

// 扩展 TextStyle 添加 fontSize 属性和命令
const CustomTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: element => element.style.fontSize?.replace(/['"]+/g, ''),
        renderHTML: attributes => {
          if (!attributes.fontSize) return {};
          return { style: `font-size: ${attributes.fontSize}` };
        },
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setFontSize: fontSize => ({ chain }) => {
        return chain().setMark('textStyle', { fontSize }).run();
      },
    };
  },
});

/**
 * TipTap 富文本编辑器组件
 * 用于 PDF 文本段落的局部样式编辑
 */
const TipTapEditor = forwardRef(function TipTapEditor(
  {
    content,
    fontSize,
    fontFamily,
    fontWeight,
    fontStyle,
    color,
    textAlign,
    lineHeight,
    width,
    height,
    onEditorReady,
    onBlur,
    onStyleChange,
    onUpdate,
    scale,
  },
  ref
) {
  const containerRef = useRef(null);
  const isInitializedRef = useRef(false);
  const [isEditable, setIsEditable] = useState(false);

  // 处理 content：支持 JSON 对象或 HTML 字符串
  const getInitialContent = () => {
    if (!content) {
      return { type: 'doc', content: [] };
    }
    // 如果是 JSON 对象（带 type 属性），直接使用
    if (typeof content === 'object' && content.type) {
      return content;
    }
    // 如果是 HTML 字符串，转换为简单 JSON
    if (typeof content === 'string') {
      const plainText = content.replace(/<\/?p>/g, '');
      return {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: plainText }],
        }],
      };
    }
    return { type: 'doc', content: [] };
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        dropcursor: false,
        gapcursor: false,
      }),
      CustomTextStyle,
      Color,
      FontFamily,
    ],
    content: getInitialContent(),
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        style: `
          font-size: ${fontSize || 16}px;
          font-family: ${fontFamily || 'Arial, sans-serif'};
          font-weight: ${fontWeight || 'normal'};
          font-style: ${fontStyle || 'normal'};
          color: ${color || '#000000'};
          text-align: ${textAlign || 'left'};
          line-height: ${lineHeight || 1.2};
          min-width: 10px;
          min-height: ${height ? `${height}px` : 'auto'};
          background: transparent;
          outline: none;
          padding: 0;
          margin: 0;
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow: visible;
        `,
      },
    },
    onBlur: ({ editor }) => {
      if (onBlur) {
        onBlur(editor.getText(), editor.getHTML(), editor.getJSON());
      }
    },
    onUpdate: ({ editor }) => {
      // 内容更新时通知父组件
      if (onUpdate) {
        // 延迟测量，确保 DOM 已重绘
        requestAnimationFrame(() => {
          const element = editor.options.element;
          const scrollHeight = element?.scrollHeight || height;

          // 测量实际内容宽度（遍历所有文本节点）
          let maxLineWidth = 0;
          const doc = editor.state.doc;
          doc.descendants((node, pos) => {
            if (node.isText) {
              // 创建临时 span 测量宽度
              const span = document.createElement('span');
              span.style.cssText = `
                position: absolute;
                visibility: hidden;
                white-space: pre;
                font-size: ${element.style.fontSize};
                font-family: ${element.style.fontFamily};
                font-weight: ${element.style.fontWeight};
                font-style: ${element.style.fontStyle};
              `;
              span.textContent = node.text;
              document.body.appendChild(span);
              const w = span.offsetWidth;
              document.body.removeChild(span);
              if (w > maxLineWidth) maxLineWidth = w;
            }
          });

          onUpdate({
            text: editor.getText(),
            html: editor.getHTML(),
            json: editor.getJSON(),
            scrollHeight,
            contentWidth: maxLineWidth + 4, // 加一点 padding
          });
        });
      }
    },
  });

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    // 获取纯文本内容
    getText: () => {
      return editor?.getText() || '';
    },
    // 获取 HTML 内容（包含样式）
    getHTML: () => {
      return editor?.getHTML() || '';
    },
    // 获取 JSON 内容（用于状态存储）
    getJSON: () => {
      return editor?.getJSON() || null;
    },
    // 设置内容
    setContent: (html) => {
      if (editor) {
        editor.commands.setContent(html);
      }
    },
    // 进入编辑模式
    enterEditing: () => {
      if (editor) {
        editor.setEditable(true);
        editor.commands.focus();
      }
    },
    // 退出编辑模式
    exitEditing: () => {
      if (editor) {
        editor.setEditable(false);
        editor.commands.blur();
      }
    },
    // 应用样式到选中文字
    applyStyle: (style, value) => {
      if (!editor) return;

      switch (style) {
        case 'bold':
          editor.chain().focus().toggleBold().run();
          break;
        case 'italic':
          editor.chain().focus().toggleItalic().run();
          break;
        case 'underline':
          editor.chain().focus().toggleUnderline().run();
          break;
        case 'strikethrough':
          editor.chain().focus().toggleStrike().run();
          break;
        case 'color':
          editor.chain().focus().setColor(value).run();
          break;
        case 'fontFamily':
          editor.chain().focus().setFontFamily(value).run();
          break;
        case 'fontSize':
          editor.chain().focus().setFontSize(value).run();
          break;
        case 'textAlign':
          editor.chain().focus().setTextAlign(value).run();
          break;
        default:
          break;
      }
    },
    // 获取当前选中的样式
    getActiveStyles: () => {
      if (!editor) return {};
      return {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strikethrough: editor.isActive('strike'),
        color: editor.getAttributes('textStyle').color || null,
        fontFamily: editor.getAttributes('textStyle').fontFamily || null,
        fontSize: editor.getAttributes('textStyle').fontSize || null,
        textAlign: editor.getAttributes('paragraph').textAlign || 'left',
      };
    },
    // 检查是否有选中文字
    hasSelection: () => {
      if (!editor) return false;
      const { from, to } = editor.state.selection;
      return from !== to;
    },
    // 获取编辑器实例
    getEditor: () => editor,
  }));

  // 更新全局样式属性
  useEffect(() => {
    if (!editor || !editor.options.element) return;

    const element = editor.options.element;
    if (fontSize !== undefined) {
      element.style.fontSize = `${fontSize}px`;
    }
    if (fontFamily !== undefined) {
      element.style.fontFamily = fontFamily;
    }
    if (fontWeight !== undefined) {
      element.style.fontWeight = fontWeight;
    }
    if (fontStyle !== undefined) {
      element.style.fontStyle = fontStyle;
    }
    if (color !== undefined) {
      element.style.color = color;
    }
    if (textAlign !== undefined) {
      element.style.textAlign = textAlign;
    }
    if (lineHeight !== undefined) {
      element.style.lineHeight = String(lineHeight);
    }
    if (width !== undefined) {
      element.style.width = `${width}px`;
    }
    if (height !== undefined) {
      element.style.minHeight = `${height}px`;
    }
  }, [editor, fontSize, fontFamily, fontWeight, fontStyle, color, textAlign, lineHeight, width, height]);

  // 通知父组件编辑器已准备好
  useEffect(() => {
    if (editor && onEditorReady && !isInitializedRef.current) {
      isInitializedRef.current = true;
      onEditorReady();
    }
  }, [editor, onEditorReady]);

  // 监听编辑器可编辑状态变化
  useEffect(() => {
    if (!editor) return;

    const updateEditable = () => {
      setIsEditable(editor.isEditable);
    };

    editor.on('transaction', updateEditable);
    updateEditable();

    return () => {
      editor.off('transaction', updateEditable);
    };
  }, [editor]);

  // 监听编辑器尺寸变化，测量实际内容宽度
  useEffect(() => {
    if (!editor || !onUpdate) return;

    const element = editor.options.element;
    if (!element) return;

    // 标记是否正在调整尺寸（防止 scaling 时的 setContent 触发测量）
    let isResizing = false;

    const measureContentSize = () => {
      // 只在编辑模式下且不在调整尺寸时测量宽度
      if (!editor.isEditable || isResizing) return;

      const textContent = editor.getText();
      if (!textContent) return;

      const lines = textContent.split('\n');
      let maxLineWidth = 0;

      // 从编辑器内部找到带 font-size 样式的 span
      const styledSpan = element.querySelector('span[style*="font-size"]');
      const computedStyle = window.getComputedStyle(styledSpan || element);
      const actualFontSize = computedStyle.fontSize;

      const span = document.createElement('span');
      span.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: pre;
        font-size: ${actualFontSize};
        font-family: ${computedStyle.fontFamily};
        font-weight: ${computedStyle.fontWeight};
        font-style: ${computedStyle.fontStyle};
      `;
      document.body.appendChild(span);

      for (const line of lines) {
        span.textContent = line || ' ';
        const w = span.offsetWidth;
        if (w > maxLineWidth) maxLineWidth = w;
      }

      document.body.removeChild(span);

      onUpdate({
        text: editor.getText(),
        html: editor.getHTML(),
        json: editor.getJSON(),
        scrollHeight: element.scrollHeight,
        contentWidth: maxLineWidth + 8,
      });
    };

    const handleTransaction = () => {
      // 双重延迟确保 DOM 渲染完成
      requestAnimationFrame(() => {
        setTimeout(measureContentSize, 50);
      });
    };

    editor.on('transaction', handleTransaction);
    measureContentSize();

    // 暴露控制方法给外部
    const editorApi = editor;
    editorApi._pauseMeasure = () => { isResizing = true; };
    editorApi._resumeMeasure = () => { isResizing = false; };

    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor, onUpdate]);

  return (
    <div
      ref={containerRef}
      className="tiptap-container"
      style={{
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <EditorContent editor={editor} />
      {editor && (
        <TextBubbleMenu
          editor={editor}
          onStyleChange={onStyleChange}
          initialFontFamily={fontFamily}
          initialFontSize={fontSize}
          scale={scale}
        />
      )}
    </div>
  );
});

/**
 * 自定义下拉组件 - 不会清除编辑器选区
 */
function CustomDropdown({ value, options, onChange, placeholder, width }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value);

  return (
    <div
      ref={ref}
      style={{ position: 'relative', minWidth: width || '60px' }}
      onMouseDown={(e) => {
        // 阻止默认行为，防止清除编辑器选区
        e.preventDefault();
      }}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        style={{
          width: '100%',
          padding: '2px 4px',
          fontSize: '12px',
          background: '#374151',
          border: '1px solid #4b5563',
          borderRadius: '4px',
          color: '#fff',
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedOption?.label || placeholder}
        </span>
        <span style={{ marginLeft: '4px' }}>▼</span>
      </button>
      {isOpen && (
        <div
          className="bubble-menu-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 10000,
            background: '#374151',
            border: '1px solid #4b5563',
            borderRadius: '4px',
            marginTop: '2px',
            maxHeight: '200px',
            overflowY: 'auto',
            minWidth: width || '60px',
          }}
        >
          {options.map(option => (
            <div
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              style={{
                padding: '4px 8px',
                cursor: 'pointer',
                color: '#fff',
                background: option.value === value ? '#4b5563' : 'transparent',
                fontSize: '12px',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => e.target.style.background = '#4b5563'}
              onMouseLeave={(e) => e.target.style.background = option.value === value ? '#4b5563' : 'transparent'}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 内嵌气泡菜单组件
 * 交互逻辑：
 * - 进入编辑模式就显示，固定在段落顶部
 * - 无选中 → 操作影响整个段落
 * - 有选中 → 操作只影响选中部分
 * - 点击外部或 Escape → 退出编辑
 */
function TextBubbleMenu({ editor, onStyleChange, initialFontFamily, initialFontSize, scale }) {
  // 从 CSS fontFamily 字符串中提取匹配的字体名
  const extractFontName = (cssFontFamily) => {
    if (!cssFontFamily) return 'Arimo';
    // 匹配 fonts 列表中的字体
    const fonts = [
      'Arimo', 'Caladea', 'Carlito', 'Cousine', 'Liberation_Serif',
      'Open_Sans', 'Roboto', 'Roboto_Mono', 'SimHei', 'Tinos'
    ];
    for (const font of fonts) {
      if (cssFontFamily.includes(font) || cssFontFamily.includes(font.replace(/_/g, ' '))) {
        return font;
      }
    }
    return 'Arimo';
  };

  // 将像素值转换为 pt 值（用于显示），四舍五入到小数点后一位
  const pxToPt = (px) => {
    if (!scale) return px;
    return Math.round((px / scale) * 10) / 10;
  };

  const [activeStyles, setActiveStyles] = useState({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
  });
  // 初始字体从 props 提取，字体大小转换为 pt 显示
  const initialFont = extractFontName(initialFontFamily);
  const initialSizePt = pxToPt(initialFontSize || 16);
  const [currentFont, setCurrentFont] = useState(initialFont);
  const [currentFontSizePt, setCurrentFontSizePt] = useState(initialSizePt);
  const [position, setPosition] = useState({ top: -1000, left: 0 });
  const [hasSelection, setHasSelection] = useState(false);
  const menuRef = useRef(null);
  const savedSelectionRef = useRef(null);
  // 保存初始值，用于 attrs 为空时的回退
  const initialFontRef = useRef(initialFont);
  const initialSizePtRef = useRef(initialSizePt);

  // 字体列表 - 与后端 localFont 目录及 Toolbar FONT_OPTIONS 保持一致
  const fonts = [
    { value: 'Arimo', label: 'Arimo' },
    { value: 'Caladea', label: 'Caladea' },
    { value: 'Carlito', label: 'Carlito' },
    { value: 'Cousine', label: 'Cousine' },
    { value: 'Liberation_Serif', label: 'Liberation Serif' },
    { value: 'Open_Sans', label: 'Open Sans' },
    { value: 'Roboto', label: 'Roboto' },
    { value: 'Roboto_Mono', label: 'Roboto Mono' },
    { value: 'SimHei', label: '黑体' },
    { value: 'Tinos', label: 'Tinos' },
  ];

  // 基础字体大小列表（pt 单位）
  const baseFontSizes = [5, 5.5, 6, 6.5, 7.5, 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 26, 28, 36, 48, 56, 72];

  // 动态生成字体大小选项：如果当前值不在列表中，添加进去
  const fontSizes = baseFontSizes.includes(currentFontSizePt)
    ? baseFontSizes
    : [...baseFontSizes, currentFontSizePt].sort((a, b) => a - b);

  // 更新菜单位置
  const updateMenuPosition = useCallback(() => {
    if (!editor) return;

    const editorElement = editor.options.element;
    if (!editorElement) return;

    const menuWidth = 320;
    const menuHeight = 36;

    // 有选中：跟随选中文字
    if (hasSelection) {
      try {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const rects = range.getClientRects();
          if (rects.length > 0) {
            const rect = rects[0];
            const left = rect.left + (rect.width / 2) - (menuWidth / 2);
            const top = rect.top - menuHeight - 8;
            setPosition({ left: Math.max(10, left), top: Math.max(10, top) });
            return;
          }
        }
      } catch (e) {
        console.error('Failed to get selection position:', e);
      }
    }

    // 无选中：固定在编辑器上方
    const rect = editorElement.getBoundingClientRect();
    const left = rect.left + (rect.width / 2) - (menuWidth / 2);
    const top = rect.top - menuHeight - 8;
    setPosition({ left: Math.max(10, left), top: Math.max(10, top) });
  }, [editor, hasSelection]);

  // 监听编辑器状态变化
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      const { from, to } = editor.state.selection;
      const selection = from !== to;
      setHasSelection(selection);

      if (selection) {
        savedSelectionRef.current = { from, to };
      }

      // 更新样式状态
      setActiveStyles({
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strikethrough: editor.isActive('strike'),
      });

      // 获取当前字体和大小
      // attrs 可能为空（初始状态无 textStyle mark），使用初始值作为回退
      const attrs = editor.getAttributes('textStyle');
      const fontFromAttrs = attrs.fontFamily;
      const sizeFromAttrs = attrs.fontSize;

      // 如果 attrs 中有字体，提取字体名；否则使用初始值
      if (fontFromAttrs) {
        setCurrentFont(extractFontName(fontFromAttrs));
      } else {
        setCurrentFont(initialFontRef.current);
      }

      // 如果 attrs 中有字体大小，转换为 pt；否则使用初始值
      if (sizeFromAttrs) {
        // 解析浮点数值，如 "21.875px" -> 21.875
        const pxValue = parseFloat(sizeFromAttrs);
        setCurrentFontSizePt(pxToPt(pxValue));
      } else {
        setCurrentFontSizePt(initialSizePtRef.current);
      }

      // 更新菜单位置
      updateMenuPosition();
    };

    editor.on('transaction', handleUpdate);
    handleUpdate();

    return () => {
      editor.off('transaction', handleUpdate);
    };
  }, [editor, updateMenuPosition]);

  // 监听窗口大小变化，更新菜单位置
  useEffect(() => {
    if (!editor?.isEditable) return;

    const handleResize = () => updateMenuPosition();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [editor, updateMenuPosition]);

  // 应用样式：有选中 → 影响选中部分；无选中 → 影响整个段落
  const applyStyle = useCallback((fn) => {
    if (hasSelection && savedSelectionRef.current) {
      // 有选中：恢复选区后应用
      const { from, to } = savedSelectionRef.current;
      editor.chain().setTextSelection({ from, to }).run();
      fn();
    } else {
      // 无选中：全选段落后应用
      const { from, to } = editor.state.selection;
      const $from = editor.state.doc.resolve(from);
      const paragraphStart = $from.before($from.depth);
      const paragraphEnd = $from.after($from.depth);

      editor.chain()
        .setTextSelection({ from: paragraphStart, to: paragraphEnd })
        .run();
      fn();

      // 恢复光标位置
      editor.commands.setTextSelection(from);
    }
  }, [editor, hasSelection]);

  const handleStyleToggle = (style) => {
    applyStyle(() => {
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
    });
    if (onStyleChange) {
      onStyleChange(style, !activeStyles[style]);
    }
  };

  const handleFontChange = (fontFamily) => {
    applyStyle(() => {
      editor.chain().setFontFamily(fontFamily).run();
    });
    // 只有在没有选中文字（段落级样式）时才同步到 obj.fontFamily
    const { from, to } = editor.state.selection;
    if (onStyleChange && from === to) {
      onStyleChange('fontFamily', fontFamily);
    }
  };

  const handleFontSizeChange = (fontSizePt) => {
    // pt 转 px 应用到编辑器，用 toFixed 避免浮点精度问题
    const fontSizePx = (fontSizePt * (scale || 1)).toFixed(3);
    applyStyle(() => {
      editor.chain().setFontSize(`${fontSizePx}px`).run();
    });
    // 只有在没有选中文字（段落级样式）时才同步到 obj.fontSize
    const { from, to } = editor.state.selection;
    if (onStyleChange && from === to) {
      onStyleChange('fontSize', fontSizePt);
    }
  };

  const handleColorChange = (color) => {
    applyStyle(() => {
      editor.chain().setColor(color).run();
    });
    // 只有在没有选中文字（段落级样式）时才同步到 obj.color
    // 有选中文字时是局部样式，不需要更新段落级颜色
    const { from, to } = editor.state.selection;
    if (onStyleChange && from === to) {
      onStyleChange('color', color);
    }
  };

  // 下拉框交互时保存选区
  const handleSelectMouseDown = (e) => {
    e.stopPropagation();
    const { from, to } = editor.state.selection;
    if (from !== to) {
      savedSelectionRef.current = { from, to };
    }
  };

  // 点击外部退出编辑模式
  useEffect(() => {
    if (!editor?.isEditable) return;

    const handleClick = (e) => {
      const menuEl = menuRef.current;
      const editorEl = editor?.options.element;

      if (menuEl?.contains(e.target) || editorEl?.contains(e.target)) {
        return;
      }

      if (e.target === document.body || e.target === document.documentElement) {
        return;
      }

      editor.setEditable(false);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        editor.setEditable(false);
      }
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor]);

  if (!editor || !editor.isEditable) {
    return null;
  }

  if (typeof document === 'undefined') {
    return null;
  }

  const menuContent = (
    <div
      ref={menuRef}
      className="bubble-menu"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: `${position.left}px`,
        top: `${position.top}px`,
        zIndex: 9999,
        gap: '6px',
      }}
    >
      {/* 字体选择 */}
      <CustomDropdown
        value={currentFont}
        options={fonts}
        onChange={handleFontChange}
        placeholder="字体"
        width="80px"
      />

      {/* 字体大小 */}
      <CustomDropdown
        value={currentFontSizePt}
        options={fontSizes.map(s => ({ value: s, label: `${s}pt` }))}
        onChange={handleFontSizeChange}
        placeholder="大小"
        width="60px"
      />

      {/* 颜色选择 */}
      <div
        className="bubble-menu-color-wrapper"
        onMouseDown={(e) => e.preventDefault()}
        style={{
          position: 'relative',
          display: 'inline-block',
        }}
      >
        <input
          type="color"
          onChange={(e) => handleColorChange(e.target.value)}
          onMouseDown={(e) => e.preventDefault()}
          className="bubble-menu-color"
          title="颜色"
          style={{
            width: '24px',
            height: '24px',
            padding: 0,
            border: '1px solid #4b5563',
            borderRadius: '4px',
            cursor: 'pointer',
            background: 'transparent',
          }}
        />
      </div>

      {/* 分隔线 */}
      <div style={{
        width: '1px',
        height: '24px',
        background: '#4b5563',
        margin: '0 4px',
      }} />

      {/* 样式按钮 */}
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
    </div>
  );

  return createPortal(menuContent, document.body);
}

export default TipTapEditor;
