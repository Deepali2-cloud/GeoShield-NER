export function DemoDataNotice({ children }: { children?: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
      <span aria-hidden="true">ⓘ</span>
      {children ?? 'Illustrative demo data. Not measured, not live, not a validated prediction.'}
    </p>
  )
}
