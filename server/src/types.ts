export interface Waypoint {
  lat: number
  lon: number
}

export interface Route {
  id: string
  name: string
  waypoints: Waypoint[]
  speed_kmh: number
  created_at: string
  updated_at: string
}

export interface CreateRouteDto {
  name: string
  waypoints: Waypoint[]
  speed_kmh: number
}
