import { useState, useEffect, useCallback } from 'react'
import type { Waypoint } from './MapView'

interface RouteListItem {
  id: string
  name: string
  waypoints: Waypoint[]
  speed_kmh: number
  created_at: string
  updated_at: string
}

interface RoutePanelProps {
  waypointCount: number
  onSave: (name: string) => Promise<void>
  onRouteLoaded: (waypoints: Waypoint[], routeId: string) => void
  onClear: () => void
}

export default function RoutePanel({
  waypointCount,
  onSave,
  onRouteLoaded,
  onClear,
}: RoutePanelProps) {
  const [routeName, setRouteName] = useState('')
  const [routes, setRoutes] = useState<RouteListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchRoutes = useCallback(async () => {
    try {
      const res = await fetch('/api/routes')
      if (!res.ok) throw new Error(`Failed to fetch routes: ${res.status}`)
      const data: RouteListItem[] = await res.json()
      setRoutes(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch routes')
    }
  }, [])

  useEffect(() => {
    fetchRoutes()
  }, [fetchRoutes])

  const handleSave = async () => {
    if (!routeName.trim()) {
      setError('Route name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(routeName.trim())
      setRouteName('')
      await fetchRoutes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save route')
    } finally {
      setSaving(false)
    }
  }

  const handleLoad = async (id: string) => {
    try {
      const res = await fetch(`/api/routes/${id}`)
      if (!res.ok) throw new Error(`Failed to load route: ${res.status}`)
      const route: RouteListItem = await res.json()
      onRouteLoaded(route.waypoints, route.id)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load route')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/routes/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Failed to delete route: ${res.status}`)
      await fetchRoutes()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete route')
    }
  }

  return (
    <div
      style={{
        padding: 16,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <h2 style={{ margin: 0 }}>Route Planner</h2>

      <div style={{ fontSize: 14, color: '#666' }}>
        Waypoints: <strong>{waypointCount}</strong>
      </div>

      {error && (
        <div
          style={{
            padding: 8,
            background: '#fee',
            border: '1px solid #c00',
            borderRadius: 4,
            color: '#c00',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <input
        data-testid="route-name-input"
        type="text"
        placeholder="Route name"
        value={routeName}
        onChange={(e) => setRouteName(e.target.value)}
        style={{
          padding: 8,
          border: '1px solid #ccc',
          borderRadius: 4,
          fontSize: 14,
        }}
      />

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          data-testid="btn-save-route"
          onClick={handleSave}
          disabled={saving || waypointCount < 2}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: '#4CAF50',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: saving || waypointCount < 2 ? 'not-allowed' : 'pointer',
            opacity: saving || waypointCount < 2 ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save Route'}
        </button>

        <button
          data-testid="btn-clear-map"
          onClick={onClear}
          style={{
            padding: '8px 12px',
            background: '#f44336',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>

      <hr style={{ width: '100%', border: 'none', borderTop: '1px solid #ddd' }} />

      <h3 style={{ margin: 0, fontSize: 16 }}>Saved Routes</h3>

      <div data-testid="route-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {routes.length === 0 && (
          <div style={{ fontSize: 13, color: '#999' }}>No saved routes</div>
        )}
        {routes.map((route) => (
          <div
            key={route.id}
            data-testid={`route-item-${route.id}`}
            style={{
              padding: 8,
              border: '1px solid #ddd',
              borderRadius: 4,
              background: '#fff',
            }}
          >
            <div style={{ fontWeight: 500, marginBottom: 4 }}>{route.name}</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
              {route.waypoints.length} waypoints &middot; {route.speed_kmh} km/h
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                data-testid={`btn-load-${route.id}`}
                onClick={() => handleLoad(route.id)}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  fontSize: 12,
                  background: '#2196F3',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Load
              </button>
              <button
                data-testid={`btn-delete-${route.id}`}
                onClick={() => handleDelete(route.id)}
                style={{
                  padding: '4px 8px',
                  fontSize: 12,
                  background: '#ff5722',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
