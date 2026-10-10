import { Outlet } from 'react-router-dom'
import { BottomNav, SidebarNav } from './NavBar'
import { DisclaimerBanner } from './DisclaimerBanner'
import { Brand, TopBar } from './TopBar'

export function AppShell() {
  return (
    <div className="flex min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to main content
      </a>
      <aside className="hidden w-64 shrink-0 flex-col bg-navy-900 p-5 lg:flex">
        <Brand dark />
        <SidebarNav />
        <p className="mt-auto text-[11px] leading-snug text-slate-400">
          Educational prototype. Values shown in this build are illustrative demo data.
        </p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
        <DisclaimerBanner />
        <TopBar />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
