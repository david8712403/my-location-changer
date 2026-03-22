import { RealPythonBridge } from './pythonBridge'
import { PlaybackEngine } from './playbackEngine'

export const bridge = new RealPythonBridge()
export const engine = new PlaybackEngine(bridge)
