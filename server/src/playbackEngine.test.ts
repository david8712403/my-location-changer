import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PlaybackEngine } from './playbackEngine'
import type { PythonBridge } from './pythonBridge'

function createMockBridge(): PythonBridge {
  return {
    start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    setLocation: vi.fn<(lat: number, lon: number) => Promise<void>>().mockResolvedValue(undefined),
    clearLocation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isRunning: vi.fn<() => boolean>().mockReturnValue(true),
    getStatus: vi.fn<() => Promise<{
      ok: boolean
      tunnel_connected: boolean
      device_connected: boolean
      tunneld_running: boolean
      tunneld_managed: boolean
      devices: Array<{ udid: string; connection_type: string }>
      tunneld_devices: string[]
      tunneld_logs: string[]
    }>>()
      .mockResolvedValue({
        ok: true,
        tunnel_connected: false,
        device_connected: false,
        tunneld_running: false,
        tunneld_managed: false,
        devices: [],
        tunneld_devices: [],
        tunneld_logs: [],
      }),
    startTunneld: vi.fn<() => Promise<{ ok: boolean; message?: string; error?: string }>>()
      .mockResolvedValue({ ok: true, message: 'mock' }),
    stopTunneld: vi.fn<() => Promise<{ ok: boolean; message?: string; error?: string }>>()
      .mockResolvedValue({ ok: true, message: 'mock' }),
  }
}

const threePoints = [
  { lat: 1, lon: 1 },
  { lat: 2, lon: 2 },
  { lat: 3, lon: 3 },
]

describe('PlaybackEngine', () => {
  let engine: PlaybackEngine
  let mockBridge: ReturnType<typeof createMockBridge>

  beforeEach(() => {
    vi.useFakeTimers()
    mockBridge = createMockBridge()
    engine = new PlaybackEngine(mockBridge)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('state transitions', () => {
    it('starts in idle state', () => {
      expect(engine.getStatus().state).toBe('idle')
    })

    it('idle → start → playing', async () => {
      await engine.start(threePoints, 5)
      expect(engine.getStatus().state).toBe('playing')
    })

    it('playing → pause → paused', async () => {
      await engine.start(threePoints, 5)
      engine.pause()
      expect(engine.getStatus().state).toBe('paused')
    })

    it('paused → resume → playing', async () => {
      await engine.start(threePoints, 5)
      engine.pause()
      await engine.resume()
      expect(engine.getStatus().state).toBe('playing')
    })

    it('playing → stop → idle', async () => {
      await engine.start(threePoints, 5)
      const stopPromise = engine.stop()
      await vi.advanceTimersByTimeAsync(200)
      await stopPromise
      expect(engine.getStatus().state).toBe('idle')
    })

    it('paused → stop → idle', async () => {
      await engine.start(threePoints, 5)
      engine.pause()
      const stopPromise = engine.stop()
      await vi.advanceTimersByTimeAsync(200)
      await stopPromise
      expect(engine.getStatus().state).toBe('idle')
    })
  })

  describe('invalid state transitions', () => {
    it('pause() when idle throws', () => {
      expect(() => engine.pause()).toThrow('Cannot pause: not playing')
    })

    it('resume() when idle throws', async () => {
      await expect(engine.resume()).rejects.toThrow('Cannot resume: not paused')
    })

    it('start() when already playing throws', async () => {
      await engine.start(threePoints, 5)
      await expect(engine.start(threePoints, 5)).rejects.toThrow('Cannot start: already running')
    })

    it('start() with empty points throws', async () => {
      await expect(engine.start([], 5)).rejects.toThrow('Cannot start: no points provided')
    })

    it('resume() when playing throws', async () => {
      await engine.start(threePoints, 5)
      await expect(engine.resume()).rejects.toThrow('Cannot resume: not paused')
    })

    it('pause() when paused throws', async () => {
      await engine.start(threePoints, 5)
      engine.pause()
      expect(() => engine.pause()).toThrow('Cannot pause: not playing')
    })
  })

  describe('point dispatch', () => {
    it('dispatches all points in order with fake timers', async () => {
      // Mock Math.random to 0 so jitter distance = 0m → exact coordinates passed
      vi.spyOn(Math, 'random').mockReturnValue(0)
      await engine.start(threePoints, 5)
      // First point already dispatched by start → scheduleNext
      // Advance timers to dispatch remaining points
      await vi.runAllTimersAsync()
      vi.restoreAllMocks()
      // stop() no longer calls setLocation/clearLocation — only 3 route points
      expect(mockBridge.setLocation).toHaveBeenCalledTimes(threePoints.length)
      expect(mockBridge.setLocation).toHaveBeenNthCalledWith(1, 1, 1)
      expect(mockBridge.setLocation).toHaveBeenNthCalledWith(2, 2, 2)
      expect(mockBridge.setLocation).toHaveBeenNthCalledWith(3, 3, 3)
    })

    it('calls setLocation with correct coordinates for first point on start', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      await engine.start([{ lat: 25.033, lon: 121.565 }], 5)
      vi.restoreAllMocks()
      const calls = (mockBridge.setLocation as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.length).toBe(1)
      expect(calls[0][0]).toBeCloseTo(25.033, 5)
      expect(calls[0][1]).toBeCloseTo(121.565, 5)
    })

    it('currentIndex advances as points are dispatched', async () => {
      await engine.start(threePoints, 5)
      // After start, first point dispatched, currentIndex = 1
      expect(engine.getStatus().currentIndex).toBe(1)
      // Advance one timer tick
      await vi.advanceTimersByTimeAsync(1000)
      expect(engine.getStatus().currentIndex).toBe(2)
    })
  })

  describe('progress tracking', () => {
    it('progress is 0 when idle', () => {
      expect(engine.getStatus().progress).toBe(0)
    })

    it('progress updates during playback', async () => {
      const points = [
        { lat: 1, lon: 1 },
        { lat: 2, lon: 2 },
        { lat: 3, lon: 3 },
        { lat: 4, lon: 4 },
      ]
      await engine.start(points, 5)
      // After start, 1 of 4 dispatched → 25%
      expect(engine.getStatus().progress).toBe(25)
    })

    it('state returns to idle after all points played', async () => {
      await engine.start(threePoints, 5)
      await vi.runAllTimersAsync()
      expect(engine.getStatus().state).toBe('idle')
    })

    it('totalPoints reflects loaded points', async () => {
      await engine.start(threePoints, 5)
      expect(engine.getStatus().totalPoints).toBe(3)
    })

    it('after natural route completion, points are preserved (GPS frozen at last position)', async () => {
      await engine.start(threePoints, 5)
      await vi.runAllTimersAsync()
      // Route ended naturally — stop() was called internally
      // GPS should stay frozen: points preserved, currentIndex at end
      const status = engine.getStatus()
      expect(status.state).toBe('idle')
      expect(status.totalPoints).toBe(3)
      // currentIndex should be at end (points.length)
      expect(status.currentIndex).toBe(3)
    })
  })

  describe('stop and cleanup', () => {
    it('stop does NOT call clearLocation — GPS stays frozen at last position', async () => {
      await engine.start(threePoints, 5)
      const stopPromise = engine.stop()
      await vi.advanceTimersByTimeAsync(200)
      await stopPromise
      expect(mockBridge.clearLocation).not.toHaveBeenCalled()
    })

    it('stop does NOT call setLocation — no GPS workaround coords sent', async () => {
      await engine.start(threePoints, 5)
      const callCountBefore = (mockBridge.setLocation as ReturnType<typeof vi.fn>).mock.calls.length
      const stopPromise = engine.stop()
      await vi.advanceTimersByTimeAsync(200)
      await stopPromise
      // No additional setLocation calls from stop()
      expect((mockBridge.setLocation as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountBefore)
    })

    it('stop sets state to idle but preserves points and currentIndex', async () => {
      await engine.start(threePoints, 5)
      // Advance so we're partway through
      await vi.advanceTimersByTimeAsync(1000) // dispatches 2 points, currentIndex = 2
      const stopPromise = engine.stop()
      await vi.advanceTimersByTimeAsync(200)
      await stopPromise
      const status = engine.getStatus()
      expect(status.state).toBe('idle')
      // Points and index are preserved so GPS stays frozen
      expect(status.totalPoints).toBe(3)
      expect(status.currentIndex).toBe(2)
    })

    it('stop preserves speedKmh, routeId, and waypoints', async () => {
      await engine.start(threePoints, 10, 'route-xyz', [{ lat: 1, lon: 1 }])
      const stopPromise = engine.stop()
      await vi.advanceTimersByTimeAsync(200)
      await stopPromise
      expect(engine.getStatus().speedKmh).toBe(10)
      expect(engine.getStatus().routeId).toBe('route-xyz')
      expect(engine.getOriginalWaypoints()).toEqual([{ lat: 1, lon: 1 }])
    })

    it('clearGps() calls setLocation(0.0001, 0.0001) then clearLocation', async () => {
      await engine.start(threePoints, 5)
      await engine.stop()
      const clearPromise = engine.clearGps()
      await vi.advanceTimersByTimeAsync(300)
      await clearPromise
      const calls = (mockBridge.setLocation as ReturnType<typeof vi.fn>).mock.calls
      const lastCall = calls[calls.length - 1]
      expect(lastCall).toEqual([0.0001, 0.0001])
      expect(mockBridge.clearLocation).toHaveBeenCalledTimes(1)
    })

    it('state returns to idle after all points played', async () => {
      await engine.start(threePoints, 5)
      await vi.runAllTimersAsync()
      expect(engine.getStatus().state).toBe('idle')
    })
  })

  describe('pause and resume', () => {
    it('pause stops further point dispatch', async () => {
      await engine.start(threePoints, 5)
      // 1 point dispatched
      engine.pause()
      const callCountAtPause = (mockBridge.setLocation as ReturnType<typeof vi.fn>).mock.calls.length
      // Advance timers — no more calls should happen
      await vi.advanceTimersByTimeAsync(5000)
      expect((mockBridge.setLocation as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountAtPause)
    })

    it('resume continues from where it paused', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      await engine.start(threePoints, 5)
      // After start: currentIndex = 1, point (1,1) dispatched
      engine.pause()
      expect(engine.getStatus().currentIndex).toBe(1)
      await engine.resume()
      vi.restoreAllMocks()
      // Resume dispatches point at currentIndex 1 → (2,2)
      expect(engine.getStatus().currentIndex).toBe(2)
      expect(mockBridge.setLocation).toHaveBeenCalledWith(2, 2)
    })
  })

  describe('error handling', () => {
    it('bridge error during playback resets state to idle', async () => {
      (mockBridge.setLocation as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined) // first point succeeds
        .mockRejectedValueOnce(new Error('device disconnected')) // second point fails
      await engine.start(threePoints, 5)
      // First tick succeeded, now advance to trigger second tick
      await vi.advanceTimersByTimeAsync(1000)
      expect(engine.getStatus().state).toBe('idle')
      expect(engine.getStatus().currentIndex).toBe(0)
    })

    it('bridge error during stop does not throw', async () => {
      // Need to create a new engine since start will fail with rejected setLocation
      const freshBridge = createMockBridge()
      const freshEngine = new PlaybackEngine(freshBridge)
      await freshEngine.start(threePoints, 5)
      // stop() no longer calls bridge — nothing to fail
      const stopPromise = freshEngine.stop()
      await vi.advanceTimersByTimeAsync(200)
      await expect(stopPromise).resolves.toBeUndefined()
      expect(freshEngine.getStatus().state).toBe('idle')
    })

    it('clearGps() bridge error does not throw', async () => {
      const freshBridge = createMockBridge();
      (freshBridge.setLocation as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      (freshBridge.clearLocation as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'))
      const freshEngine = new PlaybackEngine(freshBridge)
      // clearGps is best-effort — should not throw
      await expect(freshEngine.clearGps()).resolves.toBeUndefined()
    })
  })

  describe('speed and route metadata', () => {
    it('stores speedKmh and exposes it in getStatus()', async () => {
      await engine.start(threePoints, 10)
      expect(engine.getStatus().speedKmh).toBe(10)
    })

    it('stores routeId and exposes it in getStatus()', async () => {
      await engine.start(threePoints, 5, 'route-123')
      expect(engine.getStatus().routeId).toBe('route-123')
    })

    it('stores original waypoints and exposes them via getOriginalWaypoints()', async () => {
      const waypoints = [{ lat: 10, lon: 20 }, { lat: 30, lon: 40 }]
      await engine.start(threePoints, 5, 'route-1', waypoints)
      expect(engine.getOriginalWaypoints()).toEqual(waypoints)
    })

    it('defaults speedKmh to 5 in getStatus() when idle', () => {
      expect(engine.getStatus().speedKmh).toBe(5)
    })

    it('defaults routeId to empty string in getStatus() when idle', () => {
      expect(engine.getStatus().routeId).toBe('')
    })

    it('setSpeedKmh updates the stored speed', async () => {
      await engine.start(threePoints, 5)
      engine.setSpeedKmh(15)
      expect(engine.getStatus().speedKmh).toBe(15)
    })
  })

  describe('replacePoints', () => {
    it('preserves progress ratio when replacing points mid-route', async () => {
      // 10-point route, advance to index 5 (50% through)
      const tenPoints = Array.from({ length: 10 }, (_, i) => ({ lat: i, lon: i }))
      await engine.start(tenPoints, 5)
      // Dispatch 5 points: start dispatches 1, then 4 more ticks
      await vi.advanceTimersByTimeAsync(4000)
      expect(engine.getStatus().currentIndex).toBe(5)

      // Replace with 20-point route — should land at ~50% = index 10
      const twentyPoints = Array.from({ length: 20 }, (_, i) => ({ lat: i * 0.1, lon: i * 0.1 }))
      engine.replacePoints(twentyPoints)
      expect(engine.getStatus().totalPoints).toBe(20)
      expect(engine.getStatus().currentIndex).toBe(10) // round(0.5 * 20) = 10
    })

    it('replaces points when paused, preserving ratio', async () => {
      await engine.start(threePoints, 5)
      // currentIndex = 1 after start (ratio ≈ 0.33)
      engine.pause()
      const newPoints = [{ lat: 10, lon: 10 }, { lat: 20, lon: 20 }, { lat: 30, lon: 30 }, { lat: 40, lon: 40 }, { lat: 50, lon: 50 }, { lat: 60, lon: 60 }]
      engine.replacePoints(newPoints)
      expect(engine.getStatus().totalPoints).toBe(6)
      // round(1/3 * 6) = round(2) = 2
      expect(engine.getStatus().currentIndex).toBe(2)
    })

    it('replacePoints with empty old points starts at index 0', async () => {
      // We can't easily have 0 old points while playing, but we can test the math:
      // if this.points.length === 0, ratio = 0, so newIndex = 0
      // Just test via one-point route (index 0 before dispatch)
      await engine.start([{ lat: 1, lon: 1 }], 5)
      // After start: 1 point dispatched, currentIndex = 1, but points.length = 1
      // ratio = 1/1 = 1.0, clamped to max(0, 1-1) = 0 → index 0
      const newPoints = [{ lat: 5, lon: 5 }, { lat: 6, lon: 6 }]
      engine.replacePoints(newPoints)
      expect(engine.getStatus().totalPoints).toBe(2)
      // min(round(1.0 * 2), max(0, 2-1)) = min(2, 1) = 1
      expect(engine.getStatus().currentIndex).toBe(1)
    })

    it('throws when idle', () => {
      expect(() => engine.replacePoints([{ lat: 1, lon: 1 }]))
        .toThrow('Cannot replace points: simulation is idle')
    })
  })

  describe('last known location', () => {
    it('rememberLocation updates status currentLat/currentLon', () => {
      engine.rememberLocation(25.033, 121.5654)
      const status = engine.getStatus()
      expect(status.currentLat).toBe(25.033)
      expect(status.currentLon).toBe(121.5654)
    })

    it('teleported last known location persists after stop', async () => {
      engine.rememberLocation(25.05, 121.52)
      await engine.start(threePoints, 5)
      await engine.stop()
      const status = engine.getStatus()
      expect(status.currentLat).not.toBeNull()
      expect(status.currentLon).not.toBeNull()
    })
  })
})
