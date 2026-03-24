import { Router, Request, Response } from 'express'
import { getBridge, Platform } from './singletons'
import { RealPythonBridge } from './pythonBridge'

const router = Router()

function validatePlatform(raw: unknown): Platform | null {
  if (raw === undefined || raw === 'ios') return 'ios'
  if (raw === 'android') return 'android'
  return null
}

router.get('/status', async (req: Request, res: Response) => {
  const platform = validatePlatform(req.query.platform)
  if (!platform) {
    res.status(400).json({ error: 'Invalid platform. Must be ios or android' })
    return
  }
  try {
    const status = await getBridge(platform).getStatus()
    res.json(status)
  } catch {
    if (platform === 'android') {
      res.json({
        ok: false,
        adb_available: false,
        device_connected: false,
        devices: [],
        api_level: null,
      })
      return
    }
    res.json({
      tunnel_connected: false,
      device_connected: false,
      tunneld_running: false,
      tunneld_managed: false,
      devices: [],
      tunneld_devices: [],
      tunneld_logs: [],
    })
  }
})

router.post('/tunneld/start', async (req: Request, res: Response) => {
  const platform = validatePlatform(req.query.platform)
  if (!platform) {
    res.status(400).json({ error: 'Invalid platform. Must be ios or android' })
    return
  }
  if (platform === 'android') {
    res.status(400).json({ error: 'tunneld is iOS-only' })
    return
  }
  try {
    const bridge = getBridge(platform) as RealPythonBridge
    const result = await bridge.startTunneld()
    res.json(result)
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) })
  }
})

router.post('/tunneld/stop', async (req: Request, res: Response) => {
  const platform = validatePlatform(req.query.platform)
  if (!platform) {
    res.status(400).json({ error: 'Invalid platform. Must be ios or android' })
    return
  }
  if (platform === 'android') {
    res.status(400).json({ error: 'tunneld is iOS-only' })
    return
  }
  try {
    const bridge = getBridge(platform) as RealPythonBridge
    const result = await bridge.stopTunneld()
    res.json(result)
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) })
  }
})

export default router
