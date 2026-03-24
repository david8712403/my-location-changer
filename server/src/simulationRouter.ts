import { Router, Request, Response } from 'express'
import { engine, getBridge, Platform } from './singletons'
import { getRoute } from './routeStorage'
import { interpolateRoute } from './interpolation'

const router = Router()

interface Coord {
  lat: number
  lon: number
}

function isCoord(value: unknown): value is Coord {
  if (!value || typeof value !== 'object') return false
  const maybe = value as { lat?: unknown; lon?: unknown }
  return typeof maybe.lat === 'number' && typeof maybe.lon === 'number'
}

async function fetchRoadSegment(from: Coord, to: Coord): Promise<Coord[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3500)
  try {
    const url =
      `https://router.project-osrm.org/route/v1/foot/` +
      `${from.lon},${from.lat};${to.lon},${to.lat}` +
      '?overview=full&geometries=geojson&steps=false&alternatives=false'
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      throw new Error(`OSRM route request failed: ${res.status}`)
    }
    const data = (await res.json()) as {
      routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>
    }
    const coords = data.routes?.[0]?.geometry?.coordinates ?? []
    if (coords.length < 2) {
      throw new Error('OSRM returned no route geometry')
    }
    return coords.map(([lon, lat]) => ({ lat, lon }))
  } finally {
    clearTimeout(timeout)
  }
}

router.post('/start', async (req: Request, res: Response) => {
  const {
    routeId,
    speedKmh = 5,
    startWaypointIndex = 0,
    direction = 'forward',
  } = req.body as {
    routeId?: string
    speedKmh?: number
    startWaypointIndex?: number
    direction?: 'forward' | 'reverse'
  }
  if (engine.getStatus().state !== 'idle') {
    res.status(409).json({ error: 'Simulation already running' })
    return
  }
  if (!routeId) {
    res.status(400).json({ error: 'routeId is required' })
    return
  }
  const route = await getRoute(routeId)
  if (!route) {
    res.status(404).json({ error: 'Route not found' })
    return
  }
  try {
    let waypointsForPlayback: Coord[]

    if (direction === 'reverse') {
      waypointsForPlayback = [...route.waypoints].reverse()
    } else {
      const clampedStart = Math.max(0, Math.min(Number(startWaypointIndex), route.waypoints.length - 2))
      waypointsForPlayback = route.waypoints.slice(clampedStart)
    }

    const points = interpolateRoute(waypointsForPlayback, speedKmh)
    await engine.start(points, speedKmh, route.id, waypointsForPlayback)
    res.json(engine.getStatus())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start simulation'
    res.status(400).json({ error: message })
  }
})

router.post('/navigate', async (req: Request, res: Response) => {
  const { destination, speedKmh = 5, waypoints } = req.body as {
    destination?: { lat?: number; lon?: number }
    speedKmh?: number
    waypoints?: Array<{ lat?: number; lon?: number }>
  }
  if (engine.getStatus().state !== 'idle') {
    res.status(409).json({ error: 'Simulation already running' })
    return
  }
  if (typeof speedKmh !== 'number' || speedKmh < 1 || speedKmh > 80) {
    res.status(400).json({ error: 'speedKmh must be a number between 1 and 80' })
    return
  }

  try {
    let navWaypoints: Coord[]
    const suppliedWaypoints = Array.isArray(waypoints)
      ? waypoints.filter(isCoord)
      : []

    if (suppliedWaypoints.length >= 2) {
      navWaypoints = suppliedWaypoints
    } else {
      if (!isCoord(destination)) {
        res.status(400).json({ error: 'destination.lat and destination.lon are required' })
        return
      }
      const status = engine.getStatus()
      if (status.currentLat === null || status.currentLon === null) {
        res.status(400).json({ error: 'No last known position available for navigation start' })
        return
      }
      navWaypoints = [
        { lat: status.currentLat, lon: status.currentLon },
        { lat: destination.lat, lon: destination.lon },
      ]
    }

    const points = interpolateRoute(navWaypoints, speedKmh)
    await engine.start(points, speedKmh, 'navigation', navWaypoints)
    res.json(engine.getStatus())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start navigation'
    res.status(400).json({ error: message })
  }
})

router.post('/plan-segment', async (req: Request, res: Response) => {
  const { from, to } = req.body as {
    from?: { lat?: number; lon?: number }
    to?: { lat?: number; lon?: number }
  }
  if (!isCoord(from) || !isCoord(to)) {
    res.status(400).json({ error: 'from and to coordinates are required' })
    return
  }

  try {
    const waypoints = await fetchRoadSegment(from, to)
    res.json({ ok: true, source: 'osrm', waypoints })
  } catch {
    res.json({
      ok: true,
      source: 'fallback',
      waypoints: [from, to],
    })
  }
})

router.post('/navigate/retarget', async (req: Request, res: Response) => {
  const { waypoints, speedKmh } = req.body as {
    waypoints?: Array<{ lat?: number; lon?: number }>
    speedKmh?: number
  }

  const status = engine.getStatus()
  if (status.routeId !== 'navigation' || (status.state !== 'playing' && status.state !== 'paused')) {
    res.status(400).json({ error: 'Navigation retarget requires an active or paused navigation session' })
    return
  }

  if (typeof speedKmh !== 'number' || speedKmh < 1 || speedKmh > 80) {
    res.status(400).json({ error: 'speedKmh must be a number between 1 and 80' })
    return
  }

  const navWaypoints = Array.isArray(waypoints)
    ? waypoints.filter(isCoord)
    : []

  if (navWaypoints.length < 2) {
    res.status(400).json({ error: 'At least 2 waypoints are required for retarget' })
    return
  }

  try {
    const points = interpolateRoute(navWaypoints, speedKmh)
    engine.retarget(points, speedKmh, navWaypoints)
    res.json(engine.getStatus())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to retarget navigation'
    res.status(400).json({ error: message })
  }
})

router.post('/pause', (_req: Request, res: Response) => {
  try {
    engine.pause()
    res.json(engine.getStatus())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to pause'
    res.status(400).json({ error: message })
  }
})

router.post('/resume', async (_req: Request, res: Response) => {
  try {
    await engine.resume()
    res.json(engine.getStatus())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resume'
    res.status(400).json({ error: message })
  }
})

router.post('/stop', async (_req: Request, res: Response) => {
  try {
    await engine.stop()
    res.json(engine.getStatus())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to stop'
    res.status(400).json({ error: message })
  }
})

router.get('/status', (_req: Request, res: Response) => {
  res.json(engine.getStatus())
})

router.post('/clear', async (req: Request, res: Response) => {
  const rawPlatform = req.query.platform ?? (req.body as Record<string, unknown>)?.platform
  const platform: Platform | null =
    rawPlatform === undefined ? 'ios' : rawPlatform === 'ios' ? 'ios' : rawPlatform === 'android' ? 'android' : null
  if (!platform) {
    res.status(400).json({ error: 'Invalid platform. Must be ios or android' })
    return
  }
  try {
    const bridge = getBridge(platform)
    if (engine.getStatus().state !== 'idle') {
      await engine.stop()
    }
    await bridge.setLocation(0.0001, 0.0001)
    await new Promise((resolve) => setTimeout(resolve, 200))
    await bridge.clearLocation()
    res.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to clear location'
    res.status(500).json({ error: message })
  }
})

router.patch('/speed', (req: Request, res: Response) => {
  const { speedKmh } = req.body
  if (typeof speedKmh !== 'number' || speedKmh < 1 || speedKmh > 80) {
    res.status(400).json({ error: 'speedKmh must be a number between 1 and 80' })
    return
  }
  const status = engine.getStatus()
  if (status.state === 'idle') {
    res.status(400).json({ error: 'No simulation running — nothing to re-interpolate' })
    return
  }
  const originalWaypoints = engine.getOriginalWaypoints()
  if (originalWaypoints.length === 0) {
    res.status(400).json({ error: 'No original waypoints available for re-interpolation' })
    return
  }
  const newPoints = interpolateRoute(originalWaypoints, speedKmh)
  engine.replacePoints(newPoints)
  engine.setSpeedKmh(speedKmh)
  res.json({
    state: engine.getStatus().state,
    speedKmh,
    totalPoints: newPoints.length,
    currentIndex: engine.getStatus().currentIndex,
  })
})

router.post('/teleport', async (req: Request, res: Response) => {
  const rawPlatform = req.query.platform ?? (req.body as Record<string, unknown>)?.platform
  const platform: Platform | null =
    rawPlatform === undefined ? 'ios' : rawPlatform === 'ios' ? 'ios' : rawPlatform === 'android' ? 'android' : null
  if (!platform) {
    res.status(400).json({ error: 'Invalid platform. Must be ios or android' })
    return
  }
  const { lat, lon } = req.body
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    res.status(400).json({ error: 'lat and lon must be numbers' })
    return
  }
  try {
    await getBridge(platform).setLocation(lat, lon)
    engine.rememberLocation(lat, lon)
    res.json({ ok: true, lat, lon })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Teleport failed'
    res.status(500).json({ error: message })
  }
})

export default router
