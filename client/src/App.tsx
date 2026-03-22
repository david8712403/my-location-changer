import { useState, useCallback, useEffect, useRef } from 'react'
import MapView from './components/MapView'
import type { MapMode } from './components/MapView'
import RoutePanel from './components/RoutePanel'
import PlaybackControls from './components/PlaybackControls'
import type { SimStatus } from './components/PlaybackControls'
import type { PlaybackDirection } from './components/PlaybackControls'
import SpeedSlider from './components/SpeedSlider'
import StatusBar from './components/StatusBar'
import ErrorToast from './components/ErrorToast'
import type { Waypoint } from './components/MapView'
import './App.css'

const IDLE_STATUS: SimStatus = {
  state: 'idle',
  currentIndex: 0,
  totalPoints: 0,
  progress: 0,
  currentLat: null,
  currentLon: null,
}

function mergeNavigationSegments(segments: Waypoint[][]): Waypoint[] {
  if (segments.length === 0) return []
  const merged: Waypoint[] = []
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (segment.length === 0) continue
    if (i === 0) {
      merged.push(...segment)
    } else {
      merged.push(...segment.slice(1))
    }
  }
  return merged
}

export default function App() {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([])
  const [navigationMarkers, setNavigationMarkers] = useState<Waypoint[]>([])
  const [navigationSegments, setNavigationSegments] = useState<Waypoint[][]>([])
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null)
  const [speedKmh, setSpeedKmh] = useState(5)
  const [simStatus, setSimStatus] = useState<SimStatus>(IDLE_STATUS)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [mapMode, setMapMode] = useState<MapMode>('draw')
  const [fitRouteTrigger, setFitRouteTrigger] = useState(0)
  const [followLocked, setFollowLocked] = useState(true)
  const [playbackDirection, setPlaybackDirection] = useState<PlaybackDirection>('forward')
  const planningRef = useRef(false)

  const handleMapModeChange = useCallback((nextMode: MapMode) => {
    setMapMode(nextMode)
    if (nextMode === 'navigation') {
      setWaypoints([])
      setNavigationMarkers([])
      setNavigationSegments([])
      setActiveRouteId(null)
      setFitRouteTrigger((n) => n + 1)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    const poll = async () => {
      try {
        const res = await fetch('/api/simulate/status', { signal: controller.signal })
        if (!res.ok) return
        const data = (await res.json()) as SimStatus
        setSimStatus(data)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }

    void poll()
    const interval = setInterval(() => {
      void poll()
    }, 1000)

    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [])

  const sendSimulationCommand = useCallback(
    async (endpoint: string, body?: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST') => {
      const res = await fetch(endpoint, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Request failed: ${res.status}`)
      }
      const data = (await res.json()) as SimStatus
      setSimStatus(data)
      return data
    },
    [],
  )

  const planNavigationSegment = useCallback(
    async (target: Waypoint) => {
      if (planningRef.current) {
        return
      }
      planningRef.current = true

      try {
        const navigationSessionActive =
          simStatus.routeId === 'navigation' &&
          (simStatus.state === 'playing' || simStatus.state === 'paused')

        const navigationSessionCompleted =
          simStatus.routeId === 'navigation' &&
          simStatus.state === 'idle' &&
          simStatus.totalPoints > 0

        const hasCurrentPosition =
          simStatus.currentLat !== null && simStatus.currentLon !== null

        const baseMarkers = navigationSessionCompleted ? [] : navigationMarkers
        const baseSegments = navigationSessionCompleted ? [] : navigationSegments

        const lastSegment =
          baseSegments.length > 0 ? baseSegments[baseSegments.length - 1] : null
        const lastSegmentPoint =
          lastSegment && lastSegment.length > 0 ? lastSegment[lastSegment.length - 1] : null

        const useCurrentAsStart =
          hasCurrentPosition && (navigationSessionActive || navigationSessionCompleted || baseSegments.length === 0)

        const startPoint =
          useCurrentAsStart
            ? { lat: simStatus.currentLat as number, lon: simStatus.currentLon as number }
            : lastSegmentPoint
            ? lastSegmentPoint
            : hasCurrentPosition
              ? { lat: simStatus.currentLat, lon: simStatus.currentLon }
              : null

        if (!startPoint) {
          setErrorMessage('Navigation needs current position first. Teleport once, then tap destination.')
          return
        }

        const res = await fetch('/api/simulate/plan-segment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: startPoint, to: target }),
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setErrorMessage((body as { error?: string }).error ?? 'Failed to plan segment')
          return
        }

        const payload = (await res.json()) as { waypoints?: Waypoint[]; source?: string }
        const segment = Array.isArray(payload.waypoints) ? payload.waypoints : []

        if (segment.length < 2) {
          setErrorMessage('Navigation segment is empty')
          return
        }

        if (payload.source === 'fallback') {
          setErrorMessage('Routing service unavailable, using direct segment.')
        }

        if (navigationSessionActive) {
          setNavigationMarkers([target])
          setNavigationSegments([segment])
          setWaypoints(segment)
          setFitRouteTrigger((n) => n + 1)
          setFollowLocked(false)
          await sendSimulationCommand('/api/simulate/navigate/retarget', {
            waypoints: segment,
            speedKmh,
          })
          return
        }

        const nextMarkers = [...baseMarkers, target]
        const nextSegments = [...baseSegments, segment]
        setNavigationMarkers(nextMarkers)
        setNavigationSegments(nextSegments)
        setWaypoints(mergeNavigationSegments(nextSegments))
        setActiveRouteId(null)
        setFitRouteTrigger((n) => n + 1)
        setFollowLocked(false)
      } finally {
        planningRef.current = false
      }
    },
    [
      simStatus.currentLat,
      simStatus.currentLon,
      simStatus.routeId,
      simStatus.state,
      simStatus.totalPoints,
      sendSimulationCommand,
      speedKmh,
      navigationMarkers,
      navigationSegments,
    ],
  )

  const handleAddWaypoint = useCallback((wp: Waypoint) => {
    if (mapMode === 'navigation') {
      void planNavigationSegment(wp)
      return
    }
    setWaypoints((prev) => [...prev, wp])
  }, [mapMode, planNavigationSegment])

  const handleUpdateWaypoint = useCallback((index: number, wp: Waypoint) => {
    setWaypoints((prev) => {
      const next = [...prev]
      next[index] = wp
      return next
    })
  }, [])

  const handleRemoveWaypoint = useCallback((index: number) => {
    if (mapMode === 'navigation') {
      if (simStatus.state !== 'idle') {
        setErrorMessage('Please stop navigation before editing checkpoints.')
        return
      }
      const keptMarkers = navigationMarkers.slice(0, index)
      const keptSegments = navigationSegments.slice(0, index)
      setNavigationMarkers(keptMarkers)
      setNavigationSegments(keptSegments)
      setWaypoints(mergeNavigationSegments(keptSegments))
      setFitRouteTrigger((n) => n + 1)
      return
    }
    setWaypoints((prev) => prev.filter((_, i) => i !== index))
  }, [mapMode, simStatus.state, navigationMarkers, navigationSegments])

  const handleClear = useCallback(() => {
    setWaypoints([])
    setNavigationMarkers([])
    setNavigationSegments([])
    setActiveRouteId(null)
  }, [])

  const handleSave = useCallback(
    async (name: string) => {
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, waypoints, speed_kmh: speedKmh }),
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(body || `Save failed: ${res.status}`)
      }
      const route: { id: string } = await res.json()
      setActiveRouteId(route.id)
    },
    [waypoints, speedKmh],
  )

  const handleRouteLoaded = useCallback(
    (loadedWaypoints: Waypoint[], routeId: string) => {
      setWaypoints(loadedWaypoints)
      setActiveRouteId(routeId)
      setFitRouteTrigger((n) => n + 1)
    },
    [],
  )

  const handleTeleport = useCallback(async (wp: Waypoint) => {
    const res = await fetch('/api/simulate/teleport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: wp.lat, lon: wp.lon }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setErrorMessage((body as { error?: string }).error ?? 'Teleport failed')
      return
    }
    setSimStatus((prev) => ({ ...prev, currentLat: wp.lat, currentLon: wp.lon }))
    setFollowLocked(true)
  }, [])

  const handleStartNavigation = useCallback(async () => {
    try {
      await sendSimulationCommand('/api/simulate/navigate', { waypoints, speedKmh })
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start navigation')
    }
  }, [sendSimulationCommand, waypoints, speedKmh])

  const handlePause = useCallback(async () => {
    try {
      await sendSimulationCommand('/api/simulate/pause')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to pause')
    }
  }, [sendSimulationCommand])

  const handleResume = useCallback(async () => {
    try {
      await sendSimulationCommand('/api/simulate/resume')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to resume')
    }
  }, [sendSimulationCommand])

  const handleStop = useCallback(async () => {
    try {
      await sendSimulationCommand('/api/simulate/stop')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to stop')
    }
  }, [sendSimulationCommand])

  const handleReapplySpeed = useCallback(async () => {
    try {
      await sendSimulationCommand('/api/simulate/speed', { speedKmh }, 'PATCH')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to re-apply speed')
    }
  }, [sendSimulationCommand, speedKmh])

  const canStartNavigation = waypoints.length >= 2 && simStatus.state === 'idle'

  return (
    <div data-testid="app-root" className="app-shell">
      <ErrorToast message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      <aside className="app-sidebar">
        <section className="app-card app-card-compact">
          <label className="app-field-label">Map Mode</label>
          <div className="app-tab-switch" role="tablist" aria-label="Map mode tabs">
            <button
              role="tab"
              aria-selected={mapMode === 'draw'}
              className={`app-tab-btn ${mapMode === 'draw' ? 'is-active' : ''}`}
              onClick={() => handleMapModeChange('draw')}
            >
              Draw
            </button>
            <button
              role="tab"
              aria-selected={mapMode === 'teleport'}
              className={`app-tab-btn ${mapMode === 'teleport' ? 'is-active' : ''}`}
              onClick={() => handleMapModeChange('teleport')}
            >
              Teleport
            </button>
            <button
              role="tab"
              aria-selected={mapMode === 'navigation'}
              className={`app-tab-btn ${mapMode === 'navigation' ? 'is-active' : ''}`}
              onClick={() => handleMapModeChange('navigation')}
            >
              Navigation
            </button>
          </div>
        </section>

        {mapMode === 'draw' && (
          <>
            <section className="app-card">
              <RoutePanel
                waypointCount={waypoints.length}
                onSave={handleSave}
                onRouteLoaded={handleRouteLoaded}
                onClear={handleClear}
              />
            </section>

            <section className="app-card app-card-compact">
              <PlaybackControls
                activeRouteId={activeRouteId}
                waypointCount={waypoints.length}
                speedKmh={speedKmh}
                simStatus={simStatus}
                direction={playbackDirection}
                onDirectionChange={setPlaybackDirection}
                onStatusChange={setSimStatus}
                onError={setErrorMessage}
              />

              <SpeedSlider
                speedKmh={speedKmh}
                onChange={setSpeedKmh}
                simState={simStatus.state}
                onReapply={handleReapplySpeed}
              />
            </section>
          </>
        )}

        {mapMode === 'teleport' && (
          <section className="app-card app-card-compact">
            <h3 className="app-card-title">Teleport Mode</h3>
            <div className="app-mode-note">
              Click anywhere on the map to set iPhone location immediately.
            </div>
          </section>
        )}

        {mapMode === 'navigation' && (
          <section className="app-card app-card-compact">
            <h3 className="app-card-title">Navigation Mode</h3>
            <div className="app-mode-note">
              Tap map to extend route from previous point. First tap uses current location.
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
              Checkpoints: <strong>{navigationMarkers.length}</strong>
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {simStatus.state === 'idle' && (
                <button
                  type="button"
                  onClick={() => void handleStartNavigation()}
                  disabled={!canStartNavigation}
                  className="status-btn status-btn-start"
                  style={{ flex: 1 }}
                >
                  Start Navigation
                </button>
              )}

              {simStatus.state === 'playing' && (
                <button
                  type="button"
                  onClick={() => void handlePause()}
                  className="status-btn"
                  style={{ flex: 1, background: '#f59e0b' }}
                >
                  Pause
                </button>
              )}

              {simStatus.state === 'paused' && (
                <button
                  type="button"
                  onClick={() => void handleResume()}
                  className="status-btn"
                  style={{ flex: 1, background: '#3b82f6' }}
                >
                  Resume
                </button>
              )}

              {(simStatus.state === 'playing' || simStatus.state === 'paused') && (
                <button
                  type="button"
                  onClick={() => void handleStop()}
                  className="status-btn status-btn-stop"
                >
                  Stop
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button type="button" className="status-btn status-btn-clear" onClick={handleClear}>
                Clear Planned Path
              </button>
            </div>

            <SpeedSlider
              speedKmh={speedKmh}
              onChange={setSpeedKmh}
              simState={simStatus.state}
              onReapply={handleReapplySpeed}
            />
          </section>
        )}

        <section className="app-card app-card-compact">
          <StatusBar simStatus={simStatus} onError={setErrorMessage} />
        </section>
      </aside>

      <main className="app-map-panel">
        <MapView
          waypoints={waypoints}
          markerWaypoints={mapMode === 'navigation' ? navigationMarkers : undefined}
          onAddWaypoint={handleAddWaypoint}
          onUpdateWaypoint={handleUpdateWaypoint}
          onRemoveWaypoint={handleRemoveWaypoint}
          simOverlay={{
            state: simStatus.state,
            currentLat: simStatus.currentLat ?? null,
            currentLon: simStatus.currentLon ?? null,
            progress: simStatus.progress,
          }}
          followLocked={followLocked}
          onFollowLockedChange={setFollowLocked}
          mapMode={mapMode}
          onTeleport={handleTeleport}
          fitRouteTrigger={fitRouteTrigger}
        />
      </main>
    </div>
  )
}
