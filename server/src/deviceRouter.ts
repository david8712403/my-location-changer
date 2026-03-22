import { Router } from 'express'
import { bridge } from './singletons'

const router = Router()

router.get('/status', async (_req, res) => {
  try {
    const status = await bridge.getStatus()
    res.json(status)
  } catch {
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

router.post('/tunneld/start', async (_req, res) => {
  try {
    const result = await bridge.startTunneld()
    res.json(result)
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) })
  }
})

router.post('/tunneld/stop', async (_req, res) => {
  try {
    const result = await bridge.stopTunneld()
    res.json(result)
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) })
  }
})

export default router
