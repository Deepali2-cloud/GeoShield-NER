export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-lg bg-navy-700 text-lg text-accent">▲</span>
      <span>
        <span className={`block text-base font-bold leading-tight ${dark ? 'text-white' : 'text-navy-900'}`}>GeoShield-NER</span>
        <span className={`block text-[11px] leading-tight ${dark ? 'text-slate-300' : 'text-slate-500'}`}>Landslide risk indicator · Northeast India</span>
      </span>
    </div>
  )
}

/** Static status: this build only runs against a local Worker + local D1 with illustrative demo data. */
export function StatusChip() {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700"
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
      Demo / local data · local API
    </span>
  )
}

export function TopBar() {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div className="lg:hidden"><Brand /></div>
      <h1 className="sr-only lg:not-sr-only lg:text-base lg:font-semibold lg:text-navy-900">
        Monitoring dashboard
      </h1>
      <StatusChip />
    </header>
  )
}
