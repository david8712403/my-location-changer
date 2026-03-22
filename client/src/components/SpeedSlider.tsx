import { useState, useCallback } from 'react'

interface SpeedSliderProps {
  speedKmh: number
  onChange: (value: number) => void
  simState: 'idle' | 'playing' | 'paused'
  onReapply: () => void
}

export default function SpeedSlider({
  speedKmh,
  onChange,
  simState,
  onReapply,
}: SpeedSliderProps) {
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  const handleReapply = useCallback(async () => {
    setError(null)
    setApplying(true)
    try {
      const res = await fetch('/api/simulate/speed', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speedKmh }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `Request failed: ${res.status}` }))
        throw new Error(body.error || `Request failed: ${res.status}`)
      }
      onReapply()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-apply speed')
    } finally {
      setApplying(false)
    }
  }, [speedKmh, onReapply])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 600 }}>
        Speed: {speedKmh} km/h
      </label>
      <input
        data-testid="speed-slider"
        type="range"
        min={1}
        max={80}
        step={1}
        value={speedKmh}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
      {simState !== 'idle' && (
        <button
          data-testid="btn-reapply-speed"
          onClick={handleReapply}
          disabled={applying}
          style={{
            padding: '6px 10px',
            fontSize: 13,
            background: '#7B1FA2',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: applying ? 'not-allowed' : 'pointer',
            opacity: applying ? 0.6 : 1,
          }}
        >
          {applying ? 'Applying…' : 'Re-apply speed'}
        </button>
      )}
      {error && (
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
          {error}
        </div>
      )}
    </div>
  )
}
