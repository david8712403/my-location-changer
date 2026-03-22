import { useRef, useCallback, useEffect } from 'react'
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Tooltip,
  useMapEvents,
} from 'react-leaflet'
import type { Map as LeafletMap, LeafletMouseEvent } from 'leaflet'
import CurrentPositionMarker from './CurrentPositionMarker'

export interface Waypoint {
  lat: number
  lon: number
}

export type MapMode = 'draw' | 'teleport' | 'navigation'

interface MapViewProps {
  waypoints: Waypoint[]
  markerWaypoints?: Waypoint[]
  onAddWaypoint: (wp: Waypoint) => void
  onUpdateWaypoint: (index: number, wp: Waypoint) => void
  onRemoveWaypoint: (index: number) => void
  simOverlay?: {
    state: 'idle' | 'playing' | 'paused'
    currentLat: number | null
    currentLon: number | null
    progress: number
  }
  followLocked?: boolean
  onFollowLockedChange?: (locked: boolean) => void
  mapMode?: MapMode
  onTeleport?: (wp: Waypoint) => void
  fitRouteTrigger?: number
}

function ClickHandler({
  onAdd,
  onTeleport,
  mode,
}: {
  onAdd: (wp: Waypoint) => void
  onTeleport?: (wp: Waypoint) => void
  mode: MapMode
}) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      const wp = { lat: e.latlng.lat, lon: e.latlng.lng }
      if (mode === 'teleport') {
        onTeleport?.(wp)
      } else {
        onAdd(wp)
      }
    },
  })
  return null
}

function DragUnlockHandler({
  enabled,
  onUnlock,
}: {
  enabled: boolean
  onUnlock: () => void
}) {
  useMapEvents({
    dragstart() {
      if (enabled) {
        onUnlock()
      }
    },
  })
  return null
}

export default function MapView({
  waypoints,
  markerWaypoints,
  onAddWaypoint,
  onUpdateWaypoint,
  onRemoveWaypoint,
  simOverlay,
  followLocked = true,
  onFollowLockedChange,
  mapMode = 'draw',
  onTeleport,
  fitRouteTrigger,
}: MapViewProps) {
  const mapRef = useRef<LeafletMap | null>(null)
  const currentLat = simOverlay?.currentLat ?? null
  const currentLon = simOverlay?.currentLon ?? null
  const markerPoints = markerWaypoints ?? waypoints

  useEffect(() => {
    if (!mapRef.current || waypoints.length < 2) return
    const bounds = waypoints.map((wp) => [wp.lat, wp.lon] as [number, number])
    mapRef.current.fitBounds(bounds, { padding: [40, 40] })
  }, [fitRouteTrigger, waypoints])

  useEffect(() => {
    if (
      !mapRef.current ||
      !followLocked ||
      currentLat === null ||
      currentLon === null
    ) {
      return
    }
    mapRef.current.panTo([currentLat, currentLon], {
      animate: true,
      duration: 0.7,
    })
  }, [followLocked, currentLat, currentLon])

  const simSplitIndex = (() => {
    if (!simOverlay || simOverlay.state === 'idle' || simOverlay.currentLat === null) return -1
    if (!waypoints.length) return -1
    let closestIdx = 0
    let minDist = Infinity
    for (let i = 0; i < waypoints.length; i++) {
      const d = Math.abs(waypoints[i].lat - simOverlay.currentLat) + Math.abs(waypoints[i].lon - (simOverlay.currentLon ?? 0))
      if (d < minDist) {
        minDist = d
        closestIdx = i
      }
    }
    return closestIdx
  })()

  const allPositions = waypoints.map((wp) => [wp.lat, wp.lon] as [number, number])
  const playedPositions = simSplitIndex >= 0 ? allPositions.slice(0, simSplitIndex + 1) : []
  const remainingPositions = simSplitIndex >= 0 ? allPositions.slice(simSplitIndex) : []

  const handleDragEnd = useCallback(
    (index: number, e: { target: { getLatLng: () => { lat: number; lng: number } } }) => {
      const latlng = e.target.getLatLng()
      onUpdateWaypoint(index, { lat: latlng.lat, lon: latlng.lng })
    },
    [onUpdateWaypoint],
  )

  const handleContextMenu = useCallback(
    (index: number) => {
      onRemoveWaypoint(index)
    },
    [onRemoveWaypoint],
  )

  const hasKnownPosition = currentLat !== null && currentLon !== null

  const handleLocateLast = useCallback(() => {
    if (!mapRef.current || !hasKnownPosition || currentLat === null || currentLon === null) {
      return
    }
    mapRef.current.setView([currentLat, currentLon], mapRef.current.getZoom(), {
      animate: true,
    })
  }, [hasKnownPosition, currentLat, currentLon])

  return (
    <div className="map-view-shell">
      <MapContainer
        ref={mapRef}
        center={[25.033, 121.5654]}
        zoom={13}
        style={{
          height: '100%',
          width: '100%',
          cursor: mapMode === 'teleport' || mapMode === 'navigation' ? 'crosshair' : undefined,
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onAdd={onAddWaypoint} onTeleport={onTeleport} mode={mapMode} />
        <DragUnlockHandler
          enabled={followLocked}
          onUnlock={() => onFollowLockedChange?.(false)}
        />

        {waypoints.length >= 2 && simSplitIndex >= 0 ? (
          <>
            <Polyline
              positions={playedPositions}
              pathOptions={{ color: '#3b82f6', weight: 5, lineCap: 'round' }}
            />
            <Polyline
              positions={remainingPositions}
              pathOptions={{ color: '#93c5fd', weight: 3, dashArray: '8 8', opacity: 0.7 }}
            />
          </>
        ) : (
          waypoints.length >= 2 && (
            <Polyline
              positions={allPositions}
              pathOptions={{ color: '#3b82f6', weight: 3 }}
            />
          )
        )}

        {hasKnownPosition && currentLat !== null && currentLon !== null && simOverlay && (
          <CurrentPositionMarker
            lat={currentLat}
            lon={currentLon}
            state={simOverlay.state}
          />
        )}

        {markerPoints.map((wp, i) => (
          <Marker
            key={i}
            position={[wp.lat, wp.lon]}
            draggable={mapMode === 'draw'}
            eventHandlers={{
              dragend: (e) => {
                if (mapMode === 'draw') {
                  handleDragEnd(i, e)
                }
              },
              contextmenu: () => {
                if (mapMode !== 'teleport') {
                  handleContextMenu(i)
                }
              },
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -30]}>
              {i + 1}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>

      <div className="map-floating-controls" data-testid="map-floating-controls">
        <button
          type="button"
          onClick={() => onFollowLockedChange?.(!followLocked)}
          disabled={!hasKnownPosition}
          className={`map-ctrl-btn ${followLocked ? 'is-following' : ''}`}
          title={followLocked ? 'Unlock map movement' : 'Lock to current position'}
        >
          {followLocked ? 'Unlock' : 'Lock'}
        </button>
        <button
          type="button"
          onClick={handleLocateLast}
          disabled={!hasKnownPosition}
          className="map-ctrl-btn"
          title="Locate last known position"
        >
          Locate
        </button>
      </div>
    </div>
  )
}
