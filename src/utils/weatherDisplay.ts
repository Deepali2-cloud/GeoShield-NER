import type { WeatherStatus, WeatherWindow } from '../types/weather'

const fmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
})

/** "10 Oct, 03:30 UTC". Always UTC and always labelled, so the same instant reads the same everywhere. */
export function formatUtc(iso: string): string {
  return `${fmt.format(new Date(iso)).replace(',', '')} UTC`.replace(/\s+/g, ' ')
}

export function formatWindow(w: WeatherWindow): string {
  return `${formatUtc(w.start)} → ${formatUtc(w.end)}`
}

export function formatMm(mm: number): string {
  return `${mm.toFixed(1)} mm`
}

export function formatAge(seconds: number): string {
  if (seconds < 60) return 'under a minute'
  const m = Math.round(seconds / 60)
  if (m < 90) return `${m} min`
  const h = Math.round((seconds / 3600) * 10) / 10
  return `${h} h`
}

export const STATUS_LABEL: Record<WeatherStatus, string> = { live: 'Live', stale: 'Stale', unavailable: 'Unavailable' }
