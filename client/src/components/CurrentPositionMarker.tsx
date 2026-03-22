import { Marker } from 'react-leaflet'
import L from 'leaflet'

const pulsingIcon = L.divIcon({
  className: '',
  html: '<div style="position:relative;width:24px;height:24px"><div class="gps-pulse-ring"></div><div class="gps-pulse-dot"></div></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

const staticIcon = L.divIcon({
  className: '',
  html: '<div style="position:relative;width:18px;height:18px"><div class="gps-static-dot"></div></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

interface Props {
  lat: number
  lon: number
  state: 'idle' | 'playing' | 'paused'
}

export default function CurrentPositionMarker({ lat, lon, state }: Props) {
  return (
    <Marker
      position={[lat, lon]}
      icon={state === 'playing' ? pulsingIcon : staticIcon}
      zIndexOffset={1000}
    />
  )
}
