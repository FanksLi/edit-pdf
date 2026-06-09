import { useState } from 'react'
import { convertToPdf } from '../services/api'

const SUPPORTED_FORMATS = [
  { key: 'docx', label: 'Word', ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { key: 'xlsx', label: 'Excel', ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { key: 'pptx', label: 'PPT', ext: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  { key: 'jpg', label: 'JPG', ext: '.jpg', mime: 'image/jpeg' },
  { key: 'png', label: 'PNG', ext: '.png', mime: 'image/png' },
]

function ToPdfPage() {
  const [file, setFile] = useState(null)
  const [converting, setConverting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState('')

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0])
  }

  const handleFile = (f) => {
    const ext = f.name.split('.').pop().toLowerCase()
    const supportedExts = SUPPORTED_FORMATS.map(fmt => fmt.key)

    if (!supportedExts.includes(ext)) {
      setError(`不支持的格式 .${ext}，支持：docx, xlsx, pptx, jpg, jpeg, png`)
      return
    }
    setError('')
    setFile(f)
  }

  const handleConvert = async () => {
    if (!file) return
    setConverting(true)
    setError('')
    try {
      const blob = await convertToPdf(file)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name.replace(/\.[^.]+$/, '') + '.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e.message || '转换失败')
    } finally {
      setConverting(false)
    }
  }

  const supportedExts = SUPPORTED_FORMATS.map(fmt => `.${fmt.key}`).join(',')

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-52px)] p-8 bg-gray-50">
      <h1 className="text-2xl font-bold text-gray-800 mb-8">文件转换为 PDF</h1>

      {/* 上传区域 */}
      <div
        className={`flex flex-col items-center justify-center w-full max-w-md p-8 border-2 border-dashed rounded-lg transition-colors ${
          dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept={supportedExts}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="hidden"
          id="topdf-upload"
          disabled={converting}
        />
        <label
          htmlFor="topdf-upload"
          className={`cursor-pointer px-4 py-2 rounded font-medium text-white ${
            converting ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'
          }`}
        >
          选择文件
        </label>
        <p className="mt-4 text-gray-500 text-sm">或拖拽文件到此处</p>
        <p className="mt-2 text-gray-400 text-xs">支持：Word, Excel, PPT, JPG, PNG</p>
        {file && (
          <p className="mt-2 text-sm text-green-600 font-medium">
            已选择: {file.name}
          </p>
        )}
      </div>

      {/* 转换按钮 */}
      <button
        onClick={handleConvert}
        disabled={!file || converting}
        className={`mt-6 px-8 py-3 rounded-lg font-medium text-white transition-colors ${
          !file || converting
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-green-600 hover:bg-green-700'
        }`}
      >
        {converting ? '转换中...' : '转换为 PDF'}
      </button>

      {error && <p className="mt-4 text-red-500 text-sm">{error}</p>}
    </div>
  )
}

export default ToPdfPage
