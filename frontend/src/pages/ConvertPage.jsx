import { useState } from 'react'
import { convertPDF } from '../services/api'

const FORMATS = [
  { key: 'docx', label: 'Word', desc: '.docx' },
  { key: 'xlsx', label: 'Excel', desc: '.xlsx' },
  { key: 'pptx', label: 'PPT', desc: '.pptx' },
]

function ConvertPage() {
  const [file, setFile] = useState(null)
  const [targetFormat, setTargetFormat] = useState('docx')
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
    if (f.type !== 'application/pdf') {
      setError('请上传 PDF 文件')
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
      const blob = await convertPDF(file, targetFormat)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name.replace(/\.pdf$/i, '') + `.${targetFormat}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e.message || '转换失败')
    } finally {
      setConverting(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-52px)] p-8 bg-gray-50">
      <h1 className="text-2xl font-bold text-gray-800 mb-8">PDF 转换为办公文档</h1>

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
          accept=".pdf,application/pdf"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="hidden"
          id="convert-upload"
          disabled={converting}
        />
        <label
          htmlFor="convert-upload"
          className={`cursor-pointer px-4 py-2 rounded font-medium text-white ${
            converting ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'
          }`}
        >
          选择 PDF 文件
        </label>
        <p className="mt-4 text-gray-500 text-sm">或拖拽 PDF 文件到此处</p>
        {file && (
          <p className="mt-2 text-sm text-green-600 font-medium">
            已选择: {file.name}
          </p>
        )}
      </div>

      {/* 格式选择 */}
      <div className="flex gap-3 mt-6">
        {FORMATS.map((fmt) => (
          <button
            key={fmt.key}
            onClick={() => setTargetFormat(fmt.key)}
            className={`px-5 py-2.5 rounded-lg border-2 font-medium transition-colors ${
              targetFormat === fmt.key
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            {fmt.label}
            <span className="text-xs text-gray-400 ml-1">{fmt.desc}</span>
          </button>
        ))}
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
        {converting ? '转换中...' : '开始转换'}
      </button>

      {error && <p className="mt-4 text-red-500 text-sm">{error}</p>}
    </div>
  )
}

export default ConvertPage
