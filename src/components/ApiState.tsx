import type { ApiError } from '../api/zonesApi'

export function LoadingState() {
  return (
    <section role="status" aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
      Loading monitoring zones…
    </section>
  )
}

const TITLES: Record<ApiError['kind'], string> = {
  network: 'Cannot reach the API',
  http: 'The API returned an error',
  'invalid-response': 'The API response could not be used',
}

export function ErrorState({ error, onRetry }: { error: ApiError | string; onRetry: () => void }) {
  const title = typeof error === 'string' ? 'An error occurred' : TITLES[error.kind]
  const message = typeof error === 'string' ? error : error.message

  return (
    <section role="alert" className="rounded-xl border border-red-300 bg-red-50 p-5 text-red-900">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm">{message}</p>
      <p className="mt-1 text-xs">Zone data could not be loaded. No placeholder or cached zones are shown.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-red-400 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100"
      >
        Retry
      </button>
    </section>
  )
}

export function EmptyState() {
  return (
    <section aria-label="No zones" className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
      <p className="font-medium text-slate-800">No monitoring zones found</p>
      <p className="mt-1 text-xs">The database has no zones yet. Seed it with <code>npm run db:seed:local</code>, then reload.</p>
    </section>
  )
}
