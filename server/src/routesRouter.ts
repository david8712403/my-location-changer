import { Router, Request, Response } from 'express'
import { saveRoute, listRoutes, getRoute, deleteRoute, updateRoute } from './routeStorage'

const router = Router()

function validateRoute(body: unknown): string | null {
  const b = body as Record<string, unknown>
  if (!b.name || typeof b.name !== 'string' || b.name.trim() === '') {
    return 'name is required and must be a non-empty string'
  }
  if (!Array.isArray(b.waypoints) || b.waypoints.length < 2) {
    return 'waypoints must be an array with at least 2 points'
  }
  if (typeof b.speed_kmh !== 'number' || b.speed_kmh < 1 || b.speed_kmh > 100) {
    return 'speed_kmh must be a number between 1 and 100'
  }
  return null
}

router.post('/', async (req: Request, res: Response) => {
  const error = validateRoute(req.body)
  if (error) {
    res.status(400).json({ error })
    return
  }
  try {
    const route = await saveRoute(req.body)
    res.status(201).json(route)
  } catch (err) {
    res.status(500).json({ error: 'Failed to save route' })
  }
})

router.get('/', async (_req: Request, res: Response) => {
  try {
    const routes = await listRoutes()
    res.json(routes)
  } catch (err) {
    res.status(500).json({ error: 'Failed to list routes' })
  }
})

router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const route = await getRoute(req.params.id)
    if (!route) {
      res.status(404).json({ error: 'Route not found' })
      return
    }
    res.json(route)
  } catch (err) {
    res.status(500).json({ error: 'Failed to get route' })
  }
})

router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const deleted = await deleteRoute(req.params.id)
    if (!deleted) {
      res.status(404).json({ error: 'Route not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete route' })
  }
})

router.patch('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const route = await updateRoute(req.params.id, req.body)
    if (!route) {
      res.status(404).json({ error: 'Route not found' })
      return
    }
    res.json(route)
  } catch (err) {
    res.status(500).json({ error: 'Failed to update route' })
  }
})

export default router
