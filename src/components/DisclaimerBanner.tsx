import { DISCLAIMER } from '../utils/riskDisplay'

export function DisclaimerBanner() {
  return (
    <div role="note" className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950 sm:text-sm">
      <span aria-hidden="true" className="font-bold">⚠</span>
      <p>{DISCLAIMER}</p>
    </div>
  )
}
