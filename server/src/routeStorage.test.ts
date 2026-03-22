import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { saveRoute, listRoutes, getRoute, deleteRoute, updateRoute, setRoutesDir } from './routeStorage'

let testDir: string

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loc-test-'))
  setRoutesDir(testDir)
})

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

describe('saveRoute', () => {
  it('creates a JSON file with UUID id', async () => {
    const route = await saveRoute({ name: 'Test', waypoints: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }], speed_kmh: 5 })
    expect(route.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(route.name).toBe('Test')
    const files = fs.readdirSync(testDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toBe(`${route.id}.json`)
  })

  it('stores correct data in JSON file', async () => {
    const route = await saveRoute({ name: 'Full', waypoints: [{ lat: 10, lon: 20 }, { lat: 30, lon: 40 }], speed_kmh: 15 })
    const content = JSON.parse(fs.readFileSync(path.join(testDir, `${route.id}.json`), 'utf-8'))
    expect(content.name).toBe('Full')
    expect(content.waypoints).toEqual([{ lat: 10, lon: 20 }, { lat: 30, lon: 40 }])
    expect(content.speed_kmh).toBe(15)
    expect(content.created_at).toBeDefined()
    expect(content.updated_at).toBeDefined()
  })
})

describe('listRoutes', () => {
  it('returns empty array when no routes', async () => {
    const routes = await listRoutes()
    expect(routes).toEqual([])
  })

  it('returns all saved routes sorted by created_at desc', async () => {
    const r1 = await saveRoute({ name: 'First', waypoints: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }], speed_kmh: 5 })
    await new Promise(r => setTimeout(r, 10))
    const r2 = await saveRoute({ name: 'Second', waypoints: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }], speed_kmh: 5 })
    const routes = await listRoutes()
    expect(routes).toHaveLength(2)
    expect(routes[0].id).toBe(r2.id)
    expect(routes[1].id).toBe(r1.id)
  })
})

describe('getRoute', () => {
  it('returns null for unknown ID', async () => {
    const result = await getRoute('nonexistent-id')
    expect(result).toBeNull()
  })

  it('returns route for known ID', async () => {
    const saved = await saveRoute({ name: 'Test', waypoints: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }], speed_kmh: 5 })
    const retrieved = await getRoute(saved.id)
    expect(retrieved?.id).toBe(saved.id)
    expect(retrieved?.name).toBe('Test')
  })
})

describe('deleteRoute', () => {
  it('returns false for unknown ID', async () => {
    const result = await deleteRoute('nonexistent')
    expect(result).toBe(false)
  })

  it('deletes the file and returns true', async () => {
    const route = await saveRoute({ name: 'ToDelete', waypoints: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }], speed_kmh: 5 })
    const deleted = await deleteRoute(route.id)
    expect(deleted).toBe(true)
    expect(await getRoute(route.id)).toBeNull()
    expect(fs.readdirSync(testDir)).toHaveLength(0)
  })
})

describe('updateRoute', () => {
  it('updates name and updates updated_at', async () => {
    const route = await saveRoute({ name: 'Original', waypoints: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }], speed_kmh: 5 })
    await new Promise(r => setTimeout(r, 10))
    const updated = await updateRoute(route.id, { name: 'Updated' })
    expect(updated?.name).toBe('Updated')
    expect(updated?.updated_at).not.toBe(route.updated_at)
    expect(updated?.created_at).toBe(route.created_at)
  })

  it('preserves fields not in update', async () => {
    const route = await saveRoute({ name: 'Original', waypoints: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }], speed_kmh: 5 })
    const updated = await updateRoute(route.id, { speed_kmh: 10 })
    expect(updated?.name).toBe('Original')
    expect(updated?.speed_kmh).toBe(10)
    expect(updated?.waypoints).toEqual([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }])
  })

  it('returns null for unknown ID', async () => {
    const result = await updateRoute('nonexistent', { name: 'X' })
    expect(result).toBeNull()
  })
})
