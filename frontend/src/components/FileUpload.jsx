import { useState } from 'react';

function FileUpload({ onUpload, loading }) {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file) => {
    if (file.type !== 'application/pdf') {
      alert('请上传 PDF 文件');
      return;
    }
    onUpload(file);
  };

  return (
    <div
      className={`
        flex flex-col items-center justify-center
        w-full max-w-md p-8 mx-auto
        border-2 border-dashed rounded-lg
        transition-colors duration-200
        ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'}
      `}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleChange}
        className="hidden"
        id="pdf-upload"
        disabled={loading}
      />
      <label
        htmlFor="pdf-upload"
        className={`
          cursor-pointer px-4 py-2 rounded
          ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'}
          text-white font-medium
        `}
      >
        {loading ? '上传中...' : '选择 PDF 文件'}
      </label>
      <p className="mt-4 text-gray-500 text-sm">
        或拖拽 PDF 文件到此处
      </p>
    </div>
  );
}

export default FileUpload;