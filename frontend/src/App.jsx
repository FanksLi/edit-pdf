import { Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar'
import EditorPage from './pages/EditorPage'
import ConvertPage from './pages/ConvertPage'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <Routes>
        <Route path="/" element={<EditorPage />} />
        <Route path="/convert" element={<ConvertPage />} />
      </Routes>
    </div>
  )
}

export default App
