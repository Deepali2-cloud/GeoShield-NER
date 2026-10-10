import { Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import Admin from './pages/Admin'
import Dashboard from './pages/Dashboard'
import Reports from './pages/Reports'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="report" element={<Reports />} />
        <Route path="admin" element={<Admin />} />
        <Route path="*" element={<p className="p-6 text-sm text-slate-600">Page not found.</p>} />
      </Route>
    </Routes>
  )
}
