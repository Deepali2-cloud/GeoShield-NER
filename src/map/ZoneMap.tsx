import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import type { ZoneAssessment } from '../risk/zoneRisk'
import type { Zone } from '../types'
import { RISK_STYLES, formatScore } from '../utils/riskDisplay'
import { buildZoneIcon } from './zoneMarker'
import { FIT_OPTIONS, NER_BOUNDS, TILE_ATTRIBUTION, TILE_ERROR_THRESHOLD, TILE_URL } from './mapConfig'

interface Props {
  zones: Zone[]
  assessments: Record<string, ZoneAssessment>
  selectedId: string | null
  onSelect: (id: string) => void
}

/** Pans the map when the selection changes. It never calls onSelect, so it cannot create a feedback loop. */
function SelectionSync({ zones, selectedId }: { zones: Zone[]; selectedId: string | null }) {
  const map = useMap()
  useEffect(() => {
    const zone = zones.find((z) => z.id === selectedId)
    if (!zone) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    map.flyTo([zone.latitude, zone.longitude], Math.max(map.getZoom(), 8), { animate: !reduceMotion, duration: 0.8 })
  }, [map, zones, selectedId])
  return null
}


function ZoneMarker({ zone, assessment, selected, onSelect }: { zone: Zone; assessment: ZoneAssessment | undefined; selected: boolean; onSelect: (id: string) => void }) {
  const ref = useRef<L.Marker | null>(null)
  const level = assessment?.ok ? assessment.result.level : null
  const icon = useMemo(() => buildZoneIcon(level), [level])
  const what = assessment?.ok
    ? `${RISK_STYLES[assessment.result.level].label} (calculated demo score ${formatScore(assessment.result.score)})`
    : 'score unavailable'
  const title = `${zone.name}, ${what}${selected ? ', selected' : ''}`

  // react-leaflet does not propagate title changes, and swapping the icon would drop keyboard focus,
  // so update the existing DOM element in place.
  useEffect(() => {
    const marker = ref.current
    const el = marker?.getElement()
    if (!marker || !el) return
    marker.options.title = title
    el.setAttribute('title', title)
    el.setAttribute('aria-pressed', String(selected))
    el.classList.toggle('gs-selected', selected)
    marker.setZIndexOffset(selected ? 1000 : 0)
  }, [title, selected])

  return (
    <Marker
      ref={ref}
      position={[zone.latitude, zone.longitude]}
      icon={icon}
      keyboard
      title={title}
      eventHandlers={{
        click: () => onSelect(zone.id),
        // Leaflet makes markers focusable but does not turn Enter/Space into a click.
        keydown: (e) => {
          const key = (e as L.LeafletKeyboardEvent).originalEvent
          if (key.key === 'Enter' || key.key === ' ') {
            key.preventDefault()
            onSelect(zone.id)
          }
        },
      }}
    />
  )
}

function zoneBounds(zones: Zone[]): L.LatLngBounds {
  return zones.length ? L.latLngBounds(zones.map((z) => [z.latitude, z.longitude] as [number, number])) : L.latLngBounds(NER_BOUNDS)
}

export function ZoneMap({ zones, assessments, selectedId, onSelect }: Props) {
  const [map, setMap] = useState<L.Map | null>(null)
  const [tileErrors, setTileErrors] = useState(0)
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const tileRef = useRef<L.TileLayer | null>(null)

  const bounds = useMemo(() => zoneBounds(zones), [zones])

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const tilesFailing = tileErrors >= TILE_ERROR_THRESHOLD

  function retryTiles() {
    setTileErrors(0)
    tileRef.current?.redraw()
  }

  return (
    <section aria-labelledby="map-title" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 id="map-title" className="text-sm font-semibold text-slate-900">Monitoring map</h2>
        <button
          type="button"
          onClick={() => map?.fitBounds(bounds, FIT_OPTIONS)}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Show all zones
        </button>
      </div>

      {(tilesFailing || offline) && (
        <p role="status" className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950">
          <span>
            {offline
              ? 'You appear to be offline. '
              : 'Map background tiles could not be loaded (network unavailable or blocked). '}
            Zone markers, the zone list and details still work.
          </span>
          <button type="button" onClick={retryTiles} className="rounded border border-amber-400 bg-white px-2 py-0.5 font-medium">
            Retry map tiles
          </button>
        </p>
      )}

      {/* isolate keeps Leaflet's high z-index panes below the app's fixed navigation */}
      <div className="isolate h-80 sm:h-96 lg:h-[30rem]" data-testid="zone-map">
        <MapContainer
          ref={setMap}
          bounds={bounds}
          boundsOptions={FIT_OPTIONS}
          minZoom={4}
          maxZoom={16}
          className="h-full w-full"
          keyboard
        >
          <TileLayer
            ref={tileRef}
            url={TILE_URL}
            attribution={TILE_ATTRIBUTION}
            maxZoom={19}
            eventHandlers={{
              tileerror: () => setTileErrors((n) => n + 1),
              tileload: () => setTileErrors(0),
            }}
          />
          <SelectionSync zones={zones} selectedId={selectedId} />
          {zones.map((z) => (
            <ZoneMarker key={z.id} zone={z} assessment={assessments[z.id]} selected={z.id === selectedId} onSelect={onSelect} />
          ))}
        </MapContainer>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        Markers show rule-based demo risk levels calculated from illustrative inputs, not validated predictions.
      </p>
    </section>
  )
}
