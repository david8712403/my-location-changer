const R = 6371000 // Earth radius in meters

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  // Reference: https://www.movable-type.co.uk/scripts/latlong.html
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const φ1 = toRad(lat1), φ2 = toRad(lat2)
  const Δφ = toRad(lat2 - lat1), Δλ = toRad(lon2 - lon1)
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const toDeg = (rad: number) => (rad * 180) / Math.PI
  const φ1 = toRad(lat1), φ2 = toRad(lat2)
  const Δλ = toRad(lon2 - lon1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

export function destinationPoint(lat: number, lon: number, bearingDeg: number, distanceM: number): { lat: number; lon: number } {
  // Reference: https://www.movable-type.co.uk/scripts/latlong.html#destPoint
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const toDeg = (rad: number) => (rad * 180) / Math.PI
  const δ = distanceM / R
  const θ = toRad(bearingDeg)
  const φ1 = toRad(lat), λ1 = toRad(lon)
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
  return { lat: toDeg(φ2), lon: toDeg(λ2) }
}

export function interpolateRoute(
  waypoints: Array<{ lat: number; lon: number }>,
  speedKmh: number,
  intervalSeconds = 1
): Array<{ lat: number; lon: number }> {
  if (waypoints.length === 0) return []
  if (waypoints.length === 1) return [{ ...waypoints[0] }]

  const points: Array<{ lat: number; lon: number }> = []
  const speedMs = (speedKmh * 1000) / 3600

  for (let i = 0; i < waypoints.length - 1; i++) {
    const p1 = waypoints[i], p2 = waypoints[i + 1]
    const distance = haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon)
    const numIntervals = Math.floor(distance / (speedMs * intervalSeconds))
    const b = bearing(p1.lat, p1.lon, p2.lat, p2.lon)

    for (let j = 0; j < numIntervals; j++) {
      const d = speedMs * intervalSeconds * j
      points.push(destinationPoint(p1.lat, p1.lon, b, d))
    }
  }

  // Always push final waypoint
  points.push({ ...waypoints[waypoints.length - 1] })
  return points
}
