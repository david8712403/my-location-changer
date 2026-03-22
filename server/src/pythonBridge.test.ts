import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

// Mock child_process.spawn before importing the module
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
  }
})

import { spawn } from 'child_process'
import { RealPythonBridge, StubPythonBridge } from './pythonBridge'

/**
 * Creates a mock ChildProcess-like object with a readable stdout
 * and a plain-object stdin with write/end as vi.fn().
 * Uses `as unknown as ReturnType<typeof spawn>` to satisfy spawn mock.
 */
function createMockProcess() {
  const stdout = new Readable({ read() { /* push manually */ } })
  const stdinWrite = vi.fn().mockReturnValue(true)
  const stdinEnd = vi.fn()

  const proc = Object.assign(new EventEmitter(), {
    stdin: { write: stdinWrite, end: stdinEnd },
    stdout,
    stderr: null,
    stdio: [null, null, null] as const,
    killed: false,
    connected: false,
    exitCode: null,
    signalCode: null,
    pid: 12345,
    kill: vi.fn().mockReturnValue(true),
    send: vi.fn(),
    disconnect: vi.fn(),
    unref: vi.fn(),
    ref: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  })

  function pushLine(data: Record<string, unknown>) {
    stdout.push(JSON.stringify(data) + '\n')
  }

  return { proc, stdinWrite, stdinEnd, stdout, pushLine }
}

describe('RealPythonBridge', () => {
  let bridge: RealPythonBridge
  let mock: ReturnType<typeof createMockProcess>

  beforeEach(() => {
    vi.restoreAllMocks()
    bridge = new RealPythonBridge()
    mock = createMockProcess()
    vi.mocked(spawn).mockReturnValue(mock.proc as unknown as ReturnType<typeof spawn>)
  })

  describe('start()', () => {
    it('spawns bridge.py and resolves after status response', async () => {
      const startPromise = bridge.start()

      // Bridge sends {"action":"status"} on start — respond with ok
      await vi.waitFor(() => {
        expect(mock.stdinWrite).toHaveBeenCalled()
      })
      mock.pushLine({ ok: true, tunnel_connected: false, device_connected: false })

      await startPromise
      expect(bridge.isRunning()).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'python3',
        [expect.stringContaining('bridge.py')],
        { stdio: ['pipe', 'pipe', 'inherit'] },
      )
    })
  })

  describe('setLocation()', () => {
    it('sends set command with correct lat/lon', async () => {
      // Start bridge
      const startP = bridge.start()
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())
      mock.pushLine({ ok: true, tunnel_connected: false, device_connected: false })
      await startP

      // Clear previous calls
      mock.stdinWrite.mockClear()

      // setLocation — auto-respond
      const setP = bridge.setLocation(37.7749, -122.4194)
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())

      const written = mock.stdinWrite.mock.calls[0][0] as string
      const parsed = JSON.parse(written.trim())
      expect(parsed).toEqual({ action: 'set', lat: 37.7749, lon: -122.4194 })

      mock.pushLine({ ok: true })
      await setP
    })
  })

  describe('getStatus()', () => {
    it('returns tunnel_connected and device_connected from bridge', async () => {
      // Start
      const startP = bridge.start()
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())
      mock.pushLine({ ok: true, tunnel_connected: false, device_connected: false })
      await startP

      mock.stdinWrite.mockClear()

      const statusP = bridge.getStatus()
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())
      mock.pushLine({ ok: true, tunnel_connected: true, device_connected: false })

      const status = await statusP
      expect(status).toMatchObject({ tunnel_connected: true, device_connected: false })
    })
  })

  describe('stop()', () => {
    it('sends quit and resolves when process exits', async () => {
      // Start
      const startP = bridge.start()
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())
      mock.pushLine({ ok: true, tunnel_connected: false, device_connected: false })
      await startP

      expect(bridge.isRunning()).toBe(true)

      const stopP = bridge.stop()
      // Simulate process exit after quit is sent
      setTimeout(() => mock.proc.emit('close', 0, null), 10)
      await stopP

      expect(bridge.isRunning()).toBe(false)
    })
  })

  describe('process crash', () => {
    it('sets isRunning() to false on unexpected exit', async () => {
      const startP = bridge.start()
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())
      mock.pushLine({ ok: true, tunnel_connected: false, device_connected: false })
      await startP

      expect(bridge.isRunning()).toBe(true)
      mock.proc.emit('close', 1, null)
      expect(bridge.isRunning()).toBe(false)
    })

    it('rejects pending command when process crashes', async () => {
      const startP = bridge.start()
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())
      mock.pushLine({ ok: true, tunnel_connected: false, device_connected: false })
      await startP

      mock.stdinWrite.mockClear()
      const setP = bridge.setLocation(1, 2)
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())

      // Crash without responding
      mock.proc.emit('close', 1, null)
      await expect(setP).rejects.toThrow('Bridge process exited unexpectedly')
    })
  })

  describe('error responses', () => {
    it('throws when bridge returns ok: false', async () => {
      const startP = bridge.start()
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())
      mock.pushLine({ ok: true, tunnel_connected: false, device_connected: false })
      await startP

      mock.stdinWrite.mockClear()
      const setP = bridge.setLocation(1, 2)
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())
      mock.pushLine({ ok: false, error: 'No tunnel devices found' })

      await expect(setP).rejects.toThrow('No tunnel devices found')
    })
  })

  describe('clearLocation()', () => {
    it('sends clear command and resolves', async () => {
      const startP = bridge.start()
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())
      mock.pushLine({ ok: true, tunnel_connected: false, device_connected: false })
      await startP

      mock.stdinWrite.mockClear()
      const clearP = bridge.clearLocation()
      await vi.waitFor(() => expect(mock.stdinWrite).toHaveBeenCalled())

      const written = mock.stdinWrite.mock.calls[0][0] as string
      expect(JSON.parse(written.trim())).toEqual({ action: 'clear' })

      mock.pushLine({ ok: true })
      await clearP
    })
  })
})

describe('StubPythonBridge', () => {
  it('returns default status', async () => {
    const stub = new StubPythonBridge()
    const status = await stub.getStatus()
    expect(status).toMatchObject({ tunnel_connected: false, device_connected: false })
  })

  it('isRunning returns false', () => {
    const stub = new StubPythonBridge()
    expect(stub.isRunning()).toBe(false)
  })
})
