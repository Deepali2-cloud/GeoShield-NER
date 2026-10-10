import { useState } from 'react'
import { createReport } from '../api/reportsApi'
import { REPORT_CATEGORIES } from '../types/api'
import type { ApiReport, ReportCategory } from '../types/api'
import type { Zone } from '../types'

interface ReportFormProps {
  zones: Zone[]
  onReportCreated?: (report: ApiReport) => void
}

interface FormErrors {
  zoneId?: string
  category?: string
  title?: string
  description?: string
  coordinates?: string
  general?: string
}

export function ReportForm({ zones, onReportCreated }: ReportFormProps) {
  const [zoneId, setZoneId] = useState('')
  const [category, setCategory] = useState<string>('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [successReport, setSuccessReport] = useState<ApiReport | null>(null)

  const validate = (): boolean => {
    const nextErrors: FormErrors = {}

    if (!zoneId) {
      nextErrors.zoneId = 'Please select a monitoring zone.'
    }
    if (!category || !REPORT_CATEGORIES.includes(category as ReportCategory)) {
      nextErrors.category = 'Please select a hazard category.'
    }
    if (!title.trim()) {
      nextErrors.title = 'Title is required.'
    } else if (title.trim().length > 120) {
      nextErrors.title = 'Title cannot exceed 120 characters.'
    }
    if (!description.trim()) {
      nextErrors.description = 'Description is required.'
    } else if (description.trim().length > 2000) {
      nextErrors.description = 'Description cannot exceed 2000 characters.'
    }

    const hasLat = latitude.trim().length > 0
    const hasLng = longitude.trim().length > 0

    if (hasLat !== hasLng) {
      nextErrors.coordinates = 'Both latitude and longitude must be provided, or both left blank.'
    } else if (hasLat && hasLng) {
      const latNum = Number(latitude)
      const lngNum = Number(longitude)
      if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
        nextErrors.coordinates = 'Latitude must be a valid number between -90 and 90.'
      } else if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
        nextErrors.coordinates = 'Longitude must be a valid number between -180 and 180.'
      }
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return

    if (!validate()) return

    setSubmitting(true)
    setErrors({})

    const latNum = latitude.trim() ? Number(latitude) : null
    const lngNum = longitude.trim() ? Number(longitude) : null

    try {
      const report = await createReport({
        zoneId,
        category: category as ReportCategory,
        title: title.trim(),
        description: description.trim(),
        latitude: latNum,
        longitude: lngNum,
      })

      setSuccessReport(report)
      // Reset fields on confirmed success
      setZoneId('')
      setCategory('')
      setTitle('')
      setDescription('')
      setLatitude('')
      setLongitude('')
      onReportCreated?.(report)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit report. Please check your connection and retry.'
      setErrors({ general: msg })
    } finally {
      setSubmitting(false)
    }
  }

  const handleResetSuccess = () => {
    setSuccessReport(null)
  }

  if (successReport) {
    return (
      <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-emerald-900">Hazard Report Submitted</h3>
            <p className="mt-1 text-sm text-emerald-800">
              Thank you for contributing. Your report has been saved to the database.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            Status: {successReport.status}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-2 rounded-lg border border-emerald-200 bg-white/70 p-4 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Report ID</dt>
            <dd className="font-mono font-medium text-slate-800 break-all">{successReport.id}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Submission Time</dt>
            <dd className="font-medium text-slate-800">{new Date(successReport.createdAt).toLocaleString()} UTC</dd>
          </div>
          <div>
            <dt className="text-slate-500">Hazard Type</dt>
            <dd className="font-medium text-slate-800">{successReport.category}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Coordinates</dt>
            <dd className="font-medium text-slate-800">
              {successReport.latitude !== null && successReport.longitude !== null
                ? `${successReport.latitude.toFixed(4)}, ${successReport.longitude.toFixed(4)}`
                : 'None provided'}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-emerald-800">
          <strong>Notice:</strong> Community reports are unverified public submissions and do not alter official calculated risk scores or emergency warnings.
        </p>

        <button
          type="button"
          onClick={handleResetSuccess}
          className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          Submit another report
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="border-b border-slate-100 pb-3">
        <h2 className="text-base font-semibold text-slate-900">Report a Hazard</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Submit observed conditions anonymously. Submissions are flagged as unverified pending review.
        </p>
      </div>

      {errors.general && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-medium">{errors.general}</p>
        </div>
      )}

      {/* Zone selection */}
      <div>
        <label htmlFor="report-zone" className="block text-xs font-medium text-slate-700">
          Monitored Zone <span className="text-red-500">*</span>
        </label>
        <select
          id="report-zone"
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
          aria-invalid={!!errors.zoneId}
          aria-describedby={errors.zoneId ? 'report-zone-error' : undefined}
          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
        >
          <option value="">Select a monitoring zone…</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name} ({z.state})
            </option>
          ))}
        </select>
        {errors.zoneId && (
          <p id="report-zone-error" role="alert" className="mt-1 text-xs text-red-600">
            {errors.zoneId}
          </p>
        )}
      </div>

      {/* Hazard Category */}
      <div>
        <label htmlFor="report-category" className="block text-xs font-medium text-slate-700">
          Hazard Category <span className="text-red-500">*</span>
        </label>
        <select
          id="report-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-invalid={!!errors.category}
          aria-describedby={errors.category ? 'report-category-error' : undefined}
          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
        >
          <option value="">Select hazard category…</option>
          {REPORT_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        {errors.category && (
          <p id="report-category-error" role="alert" className="mt-1 text-xs text-red-600">
            {errors.category}
          </p>
        )}
      </div>

      {/* Short Title */}
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="report-title" className="block text-xs font-medium text-slate-700">
            Short Title <span className="text-red-500">*</span>
          </label>
          <span className="text-[11px] text-slate-400">{title.length}/120</span>
        </div>
        <input
          id="report-title"
          type="text"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Small rockfall blocking eastbound lane"
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? 'report-title-error' : undefined}
          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
        />
        {errors.title && (
          <p id="report-title-error" role="alert" className="mt-1 text-xs text-red-600">
            {errors.title}
          </p>
        )}
      </div>

      {/* Detailed Description */}
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="report-description" className="block text-xs font-medium text-slate-700">
            Detailed Description <span className="text-red-500">*</span>
          </label>
          <span className="text-[11px] text-slate-400">{description.length}/2000</span>
        </div>
        <textarea
          id="report-description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Provide specific observations, road landmarks, estimated scale, or current traffic impact…"
          aria-invalid={!!errors.description}
          aria-describedby={errors.description ? 'report-desc-error' : undefined}
          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
        />
        {errors.description && (
          <p id="report-desc-error" role="alert" className="mt-1 text-xs text-red-600">
            {errors.description}
          </p>
        )}
      </div>

      {/* Optional Coordinates */}
      <fieldset className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">
          GPS Coordinates <span className="text-slate-400 font-normal">(Optional)</span>
        </legend>
        <p className="text-[11px] text-slate-500 mb-2">
          If known, provide precise coordinates. If specified, both latitude and longitude are required.
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="report-lat" className="block text-[11px] font-medium text-slate-600">
              Latitude (-90 to 90)
            </label>
            <input
              id="report-lat"
              type="number"
              step="any"
              min={-90}
              max={90}
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="e.g. 26.1445"
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 shadow-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
            />
          </div>
          <div>
            <label htmlFor="report-lng" className="block text-[11px] font-medium text-slate-600">
              Longitude (-180 to 180)
            </label>
            <input
              id="report-lng"
              type="number"
              step="any"
              min={-180}
              max={180}
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="e.g. 91.7362"
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 shadow-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
            />
          </div>
        </div>

        {errors.coordinates && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {errors.coordinates}
          </p>
        )}
      </fieldset>

      <div className="pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-navy-800 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting report…' : 'Submit Hazard Report'}
        </button>
      </div>
    </form>
  )
}
