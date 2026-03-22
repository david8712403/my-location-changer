import { useCallback, useState } from 'react'

export interface SimStatus {
  state: 'idle' | 'playing' | 'paused'
  currentIndex: number
  totalPoints: number
  progress: number
  routeId?: string
  currentLat?: number | null
  currentLon?: number | null
  lastError?: string | null
}

export type PlaybackDirection = 'forward' | 'reverse'

interface PlaybackControlsProps {
  activeRouteId: string | null
  waypointCount: number
  speedKmh: number
  simStatus: SimStatus
  direction: PlaybackDirection
  onDirectionChange: (direction: PlaybackDirection) => void
  onStatusChange: (status: SimStatus) => void
  onError?: (msg: string) => void
}

export default function PlaybackControls({
  activeRouteId,
  waypointCount,
  speedKmh,
  simStatus,
  direction,
  onDirectionChange,
  onStatusChange,
  onError,
}: PlaybackControlsProps) {
  const [error, setError] = useState<string | null>(null)
  const [commandLoading, setCommandLoading] = useState(false)

  const sendCommand = useCallback(
    async (
      endpoint: string,
      method: 'POST' | 'PATCH' = 'POST',
      body?: Record<string, unknown>,
    ) => {
      setError(null)
      setCommandLoading(true)
      try {
        const res = await fetch(endpoint, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || `Request failed: ${res.status}`)
        }
        const data: SimStatus = await res.json()
        onStatusChange(data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Command failed'
        setError(msg)
        onError?.(msg)
      } finally {
        setCommandLoading(false)
      }
    },
    [onError, onStatusChange],
  )

  const handleStart = useCallback(() => {
    if (!activeRouteId) {
      setError('Load a route first before playback')
      return
    }

    void sendCommand('/api/simulate/start', 'POST', {
      routeId: activeRouteId,
      speedKmh,
      direction,
    })
  }, [activeRouteId, sendCommand, speedKmh, direction])

  const canStart =
    simStatus.state === 'idle' &&
    activeRouteId !== null &&
    waypointCount >= 2

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 16 }}>Playback (Loaded Route)</h3>

      {(error ?? simStatus.lastError) && (
        <div
          style={{
            padding: 6,
            background: '#fee',
            border: '1px solid #c00',
            borderRadius: 4,
            color: '#c00',
            fontSize: 12,
          }}
        >
          {error ?? simStatus.lastError}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>方向</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button
            type="button"
            onClick={() => onDirectionChange('forward')}
            disabled={simStatus.state !== 'idle'}
            style={{
              padding: '7px 8px',
              fontSize: 12,
              borderRadius: 6,
              border: `1px solid ${direction === 'forward' ? '#2563eb' : '#cbd5e1'}`,
              background: direction === 'forward' ? '#e0ecff' : '#fff',
              color: direction === 'forward' ? '#1e40af' : '#475569',
              fontWeight: 700,
              cursor: simStatus.state === 'idle' ? 'pointer' : 'not-allowed',
            }}
          >
            順向
          </button>
          <button
            type="button"
            onClick={() => onDirectionChange('reverse')}
            disabled={simStatus.state !== 'idle'}
            style={{
              padding: '7px 8px',
              fontSize: 12,
              borderRadius: 6,
              border: `1px solid ${direction === 'reverse' ? '#2563eb' : '#cbd5e1'}`,
              background: direction === 'reverse' ? '#e0ecff' : '#fff',
              color: direction === 'reverse' ? '#1e40af' : '#475569',
              fontWeight: 700,
              cursor: simStatus.state === 'idle' ? 'pointer' : 'not-allowed',
            }}
          >
            反向
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {simStatus.state === 'idle' && (
          <button
            data-testid="btn-start"
            onClick={handleStart}
            disabled={!canStart || commandLoading}
            style={{
              flex: 1,
              padding: '6px 10px',
              fontSize: 13,
              background: '#4CAF50',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: canStart && !commandLoading ? 'pointer' : 'not-allowed',
              opacity: canStart && !commandLoading ? 1 : 0.6,
            }}
          >
            {commandLoading ? 'Starting...' : 'Start Playback'}
          </button>
        )}

        {simStatus.state === 'playing' && (
          <button
            data-testid="btn-pause"
            onClick={() => void sendCommand('/api/simulate/pause')}
            disabled={commandLoading}
            style={{
              flex: 1,
              padding: '6px 10px',
              fontSize: 13,
              background: '#FF9800',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: commandLoading ? 'not-allowed' : 'pointer',
            }}
          >
            Pause
          </button>
        )}

        {simStatus.state === 'paused' && (
          <button
            data-testid="btn-resume"
            onClick={() => void sendCommand('/api/simulate/resume')}
            disabled={commandLoading}
            style={{
              flex: 1,
              padding: '6px 10px',
              fontSize: 13,
              background: '#2196F3',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: commandLoading ? 'not-allowed' : 'pointer',
            }}
          >
            Resume
          </button>
        )}

        {(simStatus.state === 'playing' || simStatus.state === 'paused') && (
          <button
            data-testid="btn-stop"
            onClick={() => void sendCommand('/api/simulate/stop')}
            disabled={commandLoading}
            style={{
              padding: '6px 10px',
              fontSize: 13,
              background: '#f44336',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: commandLoading ? 'not-allowed' : 'pointer',
            }}
          >
            Stop
          </button>
        )}
      </div>

      <progress
        data-testid="playback-progress"
        value={simStatus.progress}
        max={100}
        style={{ width: '100%', height: 8 }}
      />

      {activeRouteId === null && (
        <div style={{ fontSize: 12, color: '#64748b' }}>Load a saved route to enable playback.</div>
      )}
    </div>
  )
}
