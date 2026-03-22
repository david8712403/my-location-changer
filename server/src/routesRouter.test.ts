import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { setRoutesDir } from './routeStorage'
import routesRouter from './routesRouter'

let testDir: string
const app = express()
app.use(express.json())
app.use('/api/routes', routesRouter)

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loc-router-test-'))
  setRoutesDir(testDir)
})

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

const validRoute = {
  name: 'My Route',
  waypoints: [{ lat: 37.7749, lon: -122.4194 }, { lat: 37.7751, lon: -122.4196 }],
  speed_kmh: 5
}

describe('POST /api/routes', () => {
  it('creates route and returns 201 with UUID id', async () => {
    const res = await request(app).post('/api/routes').send(validRoute)
    expect(res.status).toBe(201)
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.body.name).toBe('My Route')
    expect(res.body.waypoints).toHaveLength(2)
    expect(res.body.created_at).toBeDefined()
    expect(res.body.updated_at).toBeDefined()
  })

  it('returns 400 for empty name', async () => {
    const res = await request(app).post('/api/routes').send({ ...validRoute, name: '' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns 400 for missing name', async () => {
    const { name, ...noName } = validRoute
    const res = await request(app).post('/api/routes').send(noName)
    expect(res.status).toBe(400)
  })

  it('returns 400 for 1 waypoint', async () => {
    const res = await request(app).post('/api/routes').send({ ...validRoute, waypoints: [{ lat: 1, lon: 1 }] })
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty waypoints', async () => {
    const res = await request(app).post('/api/routes').send({ ...validRoute, waypoints: [] })
    expect(res.status).toBe(400)
  })

  it('returns 400 for speed_kmh=0', async () => {
    const res = await request(app).post('/api/routes').send({ ...validRoute, speed_kmh: 0 })
    expect(res.status).toBe(400)
  })

  it('returns 400 for speed_kmh=101', async () => {
    const res = await request(app).post('/api/routes').send({ ...validRoute, speed_kmh: 101 })
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing speed_kmh', async () => {
    const { speed_kmh, ...noSpeed } = validRoute
    const res = await request(app).post('/api/routes').send(noSpeed)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/routes', () => {
  it('returns empty array initially', async () => {
    const res = await request(app).get('/api/routes')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns saved routes', async () => {
    await request(app).post('/api/routes').send(validRoute)
    await request(app).post('/api/routes').send({ ...validRoute, name: 'Second Route' })
    const res = await request(app).get('/api/routes')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })
})

describe('GET /api/routes/:id', () => {
  it('returns 404 for non-existing route', async () => {
    const res = await request(app).get('/api/routes/nonexistent-id')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Route not found')
  })

  it('returns route for existing id', async () => {
    const created = await request(app).post('/api/routes').send(validRoute)
    const res = await request(app).get(`/api/routes/${created.body.id}`)
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('My Route')
    expect(res.body.id).toBe(created.body.id)
  })
})

describe('DELETE /api/routes/:id', () => {
  it('returns 204 for existing route', async () => {
    const created = await request(app).post('/api/routes').send(validRoute)
    const res = await request(app).delete(`/api/routes/${created.body.id}`)
    expect(res.status).toBe(204)
  })

  it('returns 404 for non-existing route', async () => {
    const res = await request(app).delete('/api/routes/nonexistent-id')
    expect(res.status).toBe(404)
  })

  it('route is gone after delete', async () => {
    const created = await request(app).post('/api/routes').send(validRoute)
    await request(app).delete(`/api/routes/${created.body.id}`)
    const res = await request(app).get(`/api/routes/${created.body.id}`)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/routes/:id', () => {
  it('updates route name', async () => {
    const created = await request(app).post('/api/routes').send(validRoute)
    const res = await request(app).patch(`/api/routes/${created.body.id}`).send({ name: 'Updated Name' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Updated Name')
    expect(res.body.id).toBe(created.body.id)
  })

  it('returns 404 for non-existing route', async () => {
    const res = await request(app).patch('/api/routes/nonexistent-id').send({ name: 'X' })
    expect(res.status).toBe(404)
  })

  it('preserves unchanged fields', async () => {
    const created = await request(app).post('/api/routes').send(validRoute)
    const res = await request(app).patch(`/api/routes/${created.body.id}`).send({ speed_kmh: 10 })
    expect(res.body.name).toBe('My Route')
    expect(res.body.speed_kmh).toBe(10)
    expect(res.body.waypoints).toHaveLength(2)
  })
})
