import type { PythonBridge } from './pythonBridge'
import { destinationPoint } from './interpolation'

export type PlaybackState = 'idle' | 'playing' | 'paused'

export interface PlaybackStatus {
  state: PlaybackState
  currentIndex: number
  totalPoints: number
  progress: number // 0-100
  speedKmh: number
  routeId: string
  currentLat: number | null
  currentLon: number | null
  lastError: string | null
}

export class PlaybackEngine {
  private state: PlaybackState = 'idle'
  private points: Array<{ lat: number; lon: number }> = []
  private currentIndex = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private tickStart = 0
  private speedKmh = 5
  private waypoints: Array<{ lat: number; lon: number }> = []
  private routeId = ''
  private lastError: string | null = null
  private lastKnownLat: number | null = null
  private lastKnownLon: number | null = null

  constructor(private bridge: PythonBridge) {}

  async start(
    points: Array<{ lat: number; lon: number }>,
    speedKmh: number,
    routeId = '',
    originalWaypoints: Array<{ lat: number; lon: number }> = [],
  ): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error('Cannot start: already running')
    }
    if (points.length === 0) {
      throw new Error('Cannot start: no points provided')
    }
    this.speedKmh = speedKmh
    this.routeId = routeId
    this.waypoints = originalWaypoints
    this.points = points
    this.currentIndex = 0
    this.lastError = null
    this.state = 'playing'
    await this.scheduleNext()
  }

  replacePoints(newPoints: Array<{ lat: number; lon: number }>): void {
    if (this.state === 'idle') {
      throw new Error('Cannot replace points: simulation is idle')
    }
    const ratio = this.points.length > 0 ? this.currentIndex / this.points.length : 0
    this.points = newPoints
    this.currentIndex = Math.min(
      Math.round(ratio * newPoints.length),
      Math.max(0, newPoints.length - 1),
    )
  }

  retarget(
    newPoints: Array<{ lat: number; lon: number }>,
    speedKmh: number,
    originalWaypoints: Array<{ lat: number; lon: number }>,
  ): void {
    if (this.state === 'idle') {
      throw new Error('Cannot retarget: simulation is idle')
    }
    if (newPoints.length === 0) {
      throw new Error('Cannot retarget: no points provided')
    }

    this.points = newPoints
    this.currentIndex = 0
    this.speedKmh = speedKmh
    this.waypoints = originalWaypoints
    this.routeId = 'navigation'
    this.lastError = null

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.state === 'playing') {
      void this.scheduleNext()
    }
  }

  setSpeedKmh(kmh: number): void {
    this.speedKmh = kmh
  }

  getOriginalWaypoints(): Array<{ lat: number; lon: number }> {
    return this.waypoints
  }

  rememberLocation(lat: number, lon: number): void {
    this.lastKnownLat = lat
    this.lastKnownLon = lon
  }

  pause(): void {
    if (this.state !== 'playing') {
      throw new Error('Cannot pause: not playing')
    }
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.state = 'paused'
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') {
      throw new Error('Cannot resume: not paused')
    }
    this.state = 'playing'
    await this.scheduleNext()
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.state = 'idle'
  }

  async clearGps(): Promise<void> {
    try {
      await this.bridge.setLocation(0.0001, 0.0001)
      await new Promise(r => setTimeout(r, 200))
      await this.bridge.clearLocation()
    } catch (_) {
      // best-effort
    }
  }

  getStatus(): PlaybackStatus {
    return {
      state: this.state,
      currentIndex: this.currentIndex,
      totalPoints: this.points.length,
      progress: this.points.length > 0
        ? Math.round((this.currentIndex / this.points.length) * 100)
        : 0,
      speedKmh: this.speedKmh,
      routeId: this.routeId,
      currentLat: this.lastKnownLat,
      currentLon: this.lastKnownLon,
      lastError: this.lastError,
    }
  }

  private async scheduleNext(): Promise<void> {
    if (this.state !== 'playing') return
    if (this.currentIndex >= this.points.length) {
      await this.stop()
      return
    }
    const point = this.points[this.currentIndex]
    this.tickStart = Date.now()
    try {
      const jitterBearing = Math.random() * 360
      const jitterDistance = Math.random() * 5
      const jittered = destinationPoint(point.lat, point.lon, jitterBearing, jitterDistance)
      await this.bridge.setLocation(jittered.lat, jittered.lon)
      this.lastKnownLat = jittered.lat
      this.lastKnownLon = jittered.lon
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.state = 'idle'
      this.currentIndex = 0
      return
    }
    this.currentIndex++
    const elapsed = Date.now() - this.tickStart
    this.timer = setTimeout(() => this.scheduleNext(), Math.max(0, 1000 - elapsed))
  }
}
