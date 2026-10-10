interface Props {
  title: string
  phase: number
  description: string
  note?: string
}

export default function ComingSoon({ title, phase, description, note }: Props) {
  return (
    <section className="mx-auto max-w-xl rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">Planned for Phase {phase}</p>
      <p className="mt-3 text-sm text-slate-600">{description}</p>
      {note && <p className="mt-3 text-xs text-slate-500">{note}</p>}
    </section>
  )
}
