import express from 'express'
import cors from 'cors'
import routesRouter from './routesRouter'
import simulationRouter from './simulationRouter'
import deviceRouter from './deviceRouter'
import { bridge, engine } from './singletons'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: '0.1.0' })
})

app.use('/api/routes', routesRouter)
app.use('/api/simulate', simulationRouter)
app.use('/api/device', deviceRouter)

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  process.stdout.write(`Server running on port ${PORT}\n`)

  bridge.start().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(
      `\u26a0\ufe0f  Python bridge failed to start: ${message}\n` +
      `   Run: bash scripts/setup-python.sh\n`
    )
  })
})

const shutdown = async () => {
  if (engine.getStatus().state !== 'idle') {
    await engine.stop()
  }
  await bridge.stop()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('uncaughtException', async (err) => {
  process.stderr.write(`Uncaught exception: ${err.message}\n`)
  await shutdown()
})

export default app
