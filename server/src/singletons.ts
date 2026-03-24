import { RealPythonBridge } from './pythonBridge'
import { AndroidBridge } from './androidBridge'
import { PlaybackEngine } from './playbackEngine'

export type Platform = 'ios' | 'android'

let _iosBridge: RealPythonBridge | null = null
let _androidBridge: AndroidBridge | null = null

export function getBridge(platform: Platform): RealPythonBridge | AndroidBridge {
  if (platform === 'android') {
    if (!_androidBridge) _androidBridge = new AndroidBridge()
    return _androidBridge
  }
  if (!_iosBridge) _iosBridge = new RealPythonBridge()
  return _iosBridge
}

export const engine = new PlaybackEngine(getBridge('ios') as RealPythonBridge)
