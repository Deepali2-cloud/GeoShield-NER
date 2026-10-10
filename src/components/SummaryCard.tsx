interface Props {
  label: string
  value: React.ReactNode
  hint?: string
}

export function SummaryCard({ label, value, hint }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1.5 text-2xl font-semibold text-navy-900">{value}</div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
