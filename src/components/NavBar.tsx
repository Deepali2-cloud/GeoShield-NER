import { NavLink } from 'react-router-dom'

const ITEMS = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/report', label: 'Report hazard', icon: '✎', end: false },
  { to: '/admin', label: 'Admin', icon: '⚙', end: false },
]

export function SidebarNav() {
  return (
    <nav aria-label="Primary" className="mt-6 flex flex-col gap-1">
      {ITEMS.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end={i.end}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
            }`
          }
        >
          <span aria-hidden="true">{i.icon}</span>
          {i.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function BottomNav() {
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white lg:hidden">
      {ITEMS.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end={i.end}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium ${isActive ? 'text-navy-800' : 'text-slate-500'}`
          }
        >
          <span aria-hidden="true" className="text-base">{i.icon}</span>
          {i.label}
        </NavLink>
      ))}
    </nav>
  )
}
