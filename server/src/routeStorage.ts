import fs from 'fs'
import path from 'path'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type { Route, CreateRouteDto } from './types'

// Allow overriding for tests
export let ROUTES_DIR = path.join(os.homedir(), '.my-location-changer', 'routes')

export function setRoutesDir(dir: string): void {
  ROUTES_DIR = dir
}

function ensureDir(): void {
  fs.mkdirSync(ROUTES_DIR, { recursive: true })
}

export async function saveRoute(dto: CreateRouteDto): Promise<Route> {
  ensureDir()
  const now = new Date().toISOString()
  const route: Route = {
    id: uuidv4(),
    name: dto.name,
    waypoints: dto.waypoints,
    speed_kmh: dto.speed_kmh,
    created_at: now,
    updated_at: now,
  }
  const filePath = path.join(ROUTES_DIR, `${route.id}.json`)
  await fs.promises.writeFile(filePath, JSON.stringify(route, null, 2), 'utf-8')
  return route
}

export async function listRoutes(): Promise<Route[]> {
  ensureDir()
  const files = await fs.promises.readdir(ROUTES_DIR)
  const jsonFiles = files.filter(f => f.endsWith('.json'))
  const routes = await Promise.all(
    jsonFiles.map(async f => {
      const content = await fs.promises.readFile(path.join(ROUTES_DIR, f), 'utf-8')
      return JSON.parse(content) as Route
    })
  )
  return routes.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

export async function getRoute(id: string): Promise<Route | null> {
  const filePath = path.join(ROUTES_DIR, `${id}.json`)
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8')
    return JSON.parse(content) as Route
  } catch {
    return null
  }
}

export async function deleteRoute(id: string): Promise<boolean> {
  const filePath = path.join(ROUTES_DIR, `${id}.json`)
  try {
    await fs.promises.unlink(filePath)
    return true
  } catch {
    return false
  }
}

export async function updateRoute(id: string, dto: Partial<CreateRouteDto>): Promise<Route | null> {
  const existing = await getRoute(id)
  if (!existing) return null
  const updated: Route = {
    ...existing,
    ...dto,
    id: existing.id,
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  }
  const filePath = path.join(ROUTES_DIR, `${id}.json`)
  await fs.promises.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8')
  return updated
}
