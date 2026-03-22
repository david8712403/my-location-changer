import { describe, it, expect } from 'vitest'
import { haversineDistance, bearing, destinationPoint, interpolateRoute } from './interpolation'

describe('haversineDistance', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0)
  })
  it('Paris to London is approximately 343km', () => {
    const d = haversineDistance(48.8566, 2.3522, 51.5074, -0.1278)
    expect(d).toBeGreaterThan(343000)
    expect(d).toBeLessThan(344000)
  })
  it('is symmetric', () => {
    const d1 = haversineDistance(48.8566, 2.3522, 51.5074, -0.1278)
    const d2 = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522)
    expect(Math.abs(d1 - d2)).toBeLessThan(1)
  })
})

describe('bearing', () => {
  it('due east is 90 degrees', () => {
    expect(bearing(0, 0, 0, 1)).toBeCloseTo(90, 0)
  })
  it('due north is 0 degrees', () => {
    expect(bearing(0, 0, 1, 0)).toBeCloseTo(0, 0)
  })
  it('due south is 180 degrees', () => {
    expect(bearing(1, 0, 0, 0)).toBeCloseTo(180, 0)
  })
})

describe('destinationPoint', () => {
  it('traveling 0 meters returns same point', () => {
    const result = destinationPoint(48.8566, 2.3522, 0, 0)
    expect(result.lat).toBeCloseTo(48.8566, 4)
    expect(result.lon).toBeCloseTo(2.3522, 4)
  })
  it('traveling 1000m north increases latitude', () => {
    const result = destinationPoint(48.8566, 2.3522, 0, 1000)
    expect(result.lat).toBeGreaterThan(48.8566)
    expect(result.lon).toBeCloseTo(2.3522, 2)
  })
})

describe('interpolateRoute', () => {
  it('returns empty array for empty waypoints', () => {
    expect(interpolateRoute([], 5, 1)).toEqual([])
  })
  it('returns single point for one waypoint', () => {
    const result = interpolateRoute([{ lat: 1, lon: 1 }], 5, 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ lat: 1, lon: 1 })
  })
  it('returns 1 point for identical consecutive waypoints', () => {
    const result = interpolateRoute([{ lat: 1, lon: 1 }, { lat: 1, lon: 1 }], 5, 1)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
  it('generates ~111 points for 0.001° separation at 3.6 km/h (1 m/s), 1s interval', () => {
    const result = interpolateRoute([{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }], 3.6, 1)
    expect(result.length).toBeGreaterThan(100)
    expect(result.length).toBeLessThan(120)
  })
  it('first point is close to first waypoint', () => {
    const result = interpolateRoute([{ lat: 25.033, lon: 121.565 }, { lat: 25.034, lon: 121.566 }], 5, 1)
    expect(result[0].lat).toBeCloseTo(25.033, 2)
    expect(result[0].lon).toBeCloseTo(121.565, 2)
  })
  it('last point is close to last waypoint', () => {
    const result = interpolateRoute([{ lat: 25.033, lon: 121.565 }, { lat: 25.034, lon: 121.566 }], 5, 1)
    const last = result[result.length - 1]
    expect(last.lat).toBeCloseTo(25.034, 2)
    expect(last.lon).toBeCloseTo(121.566, 2)
  })
  it('produces more points at slower speed', () => {
    const slow = interpolateRoute([{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }], 3.6, 1)
    const fast = interpolateRoute([{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }], 36, 1)
    expect(slow.length).toBeGreaterThan(fast.length)
  })
})
