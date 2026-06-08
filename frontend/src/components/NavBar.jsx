import { NavLink } from 'react-router-dom'

function NavBar() {
  const linkClass = ({ isActive }) =>
    `px-4 py-2 rounded text-sm font-medium transition-colors ${
      isActive ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'
    }`

  return (
    <nav className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200">
      <span className="text-lg font-bold text-gray-800 mr-4">PDF 工具</span>
      <NavLink to="/" className={linkClass}>编辑 PDF</NavLink>
      <NavLink to="/convert" className={linkClass}>PDF 转换</NavLink>
    </nav>
  )
}

export default NavBar
