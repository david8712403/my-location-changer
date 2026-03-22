import { spawn, ChildProcess } from 'child_process'
import * as readline from 'readline'
import * as path from 'path'
import * as fs from 'fs'

export interface PythonBridge {
  start(): Promise<void>
  stop(): Promise<void>
  setLocation(lat: number, lon: number): Promise<void>
  clearLocation(): Promise<void>
  isRunning(): boolean
  getStatus(): Promise<{
    ok: boolean
    tunnel_connected: boolean
    device_connected: boolean
    tunneld_running: boolean
    tunneld_managed: boolean
    devices: Array<{ udid: string; connection_type: string }>
    tunneld_devices: string[]
    tunneld_logs: string[]
  }>
  startTunneld(): Promise<{ ok: boolean; message?: string; error?: string }>
  stopTunneld(): Promise<{ ok: boolean; message?: string; error?: string }>
}

/**
 * Stub implementation for development/testing.
 * singletons.ts uses this until the real bridge is wired up.
 */
export class StubPythonBridge implements PythonBridge {
  async start(): Promise<void> {
    // Stub — real implementation spawns bridge.py subprocess
  }

  async stop(): Promise<void> {
    // Stub — real implementation sends quit command to bridge.py
  }

  async setLocation(_lat: number, _lon: number): Promise<void> {
    // Stub — real implementation spawns bridge.py subprocess
  }

  async clearLocation(): Promise<void> {
    // Stub — real implementation sends clear command to bridge.py
  }

  isRunning(): boolean {
    return false
  }

  async getStatus() {
    return {
      ok: true,
      tunnel_connected: false,
      device_connected: false,
      tunneld_running: false,
      tunneld_managed: false,
      devices: [] as Array<{ udid: string; connection_type: string }>,
      tunneld_devices: [] as string[],
      tunneld_logs: [] as string[],
    }
  }

  async startTunneld() {
    return { ok: true, message: 'stub' }
  }

  async stopTunneld() {
    return { ok: true, message: 'stub' }
  }
}

interface BridgeResponse {
  ok: boolean
  error?: string
  message?: string
  tunnel_connected?: boolean
  device_connected?: boolean
  tunneld_running?: boolean
  tunneld_managed?: boolean
  devices?: Array<{ udid: string; connection_type: string }>
  tunneld_devices?: string[]
  tunneld_logs?: string[]
}

/**
 * Real subprocess bridge — spawns bridge.py and communicates via
 * newline-delimited JSON over stdin/stdout. Maintains a persistent
 * DVT connection for low-latency location updates.
 */
export class RealPythonBridge implements PythonBridge {
  private proc: ChildProcess | null = null
  private pendingResolve: ((v: BridgeResponse) => void) | null = null
  private pendingReject: ((e: Error) => void) | null = null
  private rl: readline.Interface | null = null
  private cmdQueue: Array<{
    cmd: Record<string, unknown>
    resolve: (v: BridgeResponse) => void
    reject: (e: Error) => void
  }> = []
  private inflight = false

  async start(): Promise<void> {
    if (this.proc) {
      return
    }

    const venvPython = path.join(__dirname, '../../python/venv/bin/python3')
    const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3'
    const bridgePath = path.join(__dirname, '../../bridge.py')

    this.proc = spawn(pythonBin, [bridgePath], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })

    this.rl = readline.createInterface({ input: this.proc.stdout! })

    this.rl.on('line', (line: string) => {
      if (!this.pendingResolve) return
      try {
        const data = JSON.parse(line) as BridgeResponse
        const resolve = this.pendingResolve
        this.pendingResolve = null
        this.pendingReject = null
        resolve(data)
      } catch (err) {
        const reject = this.pendingReject
        this.pendingResolve = null
        this.pendingReject = null
        if (reject) {
          reject(new Error(`Failed to parse bridge response: ${line}`))
        }
      }
    })

    this.proc.on('close', () => {
      if (this.pendingReject) {
        const reject = this.pendingReject
        this.pendingResolve = null
        this.pendingReject = null
        reject(new Error('Bridge process exited unexpectedly'))
      }
      this.cleanup()
    })

    // Verify bridge is alive with a status check
    const status = await this.sendCommand({ action: 'status' })
    if (!status.ok) {
      throw new Error(`Bridge start failed: ${status.error ?? 'unknown error'}`)
    }
  }

  async stop(): Promise<void> {
    if (!this.proc) return

    try {
      await this.sendCommand({ action: 'quit' }).catch(() => {
        // quit doesn't send a response — it just exits
      })
    } catch {
      // Ignore errors during quit
    }

    // Wait for clean exit, kill after 3s
    const proc = this.proc
    if (proc) {
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          proc.kill('SIGKILL')
          resolve()
        }, 3000)
        proc.on('close', () => {
          clearTimeout(killTimer)
          resolve()
        })
        // Close stdin to signal EOF
        proc.stdin?.end()
      })
    }
    this.cleanup()
  }

  async setLocation(lat: number, lon: number): Promise<void> {
    const resp = await this.sendCommand({ action: 'set', lat, lon })
    if (!resp.ok) {
      throw new Error(resp.error ?? 'setLocation failed')
    }
  }

  async clearLocation(): Promise<void> {
    const resp = await this.sendCommand({ action: 'clear' })
    if (!resp.ok) {
      throw new Error(resp.error ?? 'clearLocation failed')
    }
  }

  async getStatus() {
    const resp = await this.sendCommand({ action: 'status' })
    return {
      ok: resp.ok,
      tunnel_connected: resp.tunnel_connected ?? false,
      device_connected: resp.device_connected ?? false,
      tunneld_running: resp.tunneld_running ?? false,
      tunneld_managed: resp.tunneld_managed ?? false,
      devices: resp.devices ?? [],
      tunneld_devices: resp.tunneld_devices ?? [],
      tunneld_logs: resp.tunneld_logs ?? [],
    }
  }

  async startTunneld() {
    const resp = await this.sendCommand({ action: 'start_tunneld' })
    return { ok: resp.ok, message: resp.message, error: resp.error }
  }

  async stopTunneld() {
    const resp = await this.sendCommand({ action: 'stop_tunneld' })
    return { ok: resp.ok, message: resp.message, error: resp.error }
  }

  isRunning(): boolean {
    return this.proc !== null
  }

  private sendCommand(cmd: Record<string, unknown>): Promise<BridgeResponse> {
    return new Promise((resolve, reject) => {
      this.cmdQueue.push({ cmd, resolve, reject })
      this.drainQueue()
    })
  }

  private drainQueue(): void {
    if (this.inflight || this.cmdQueue.length === 0) return
    if (!this.proc || !this.proc.stdin) {
      const err = new Error('Bridge process not running')
      for (const item of this.cmdQueue) item.reject(err)
      this.cmdQueue = []
      return
    }
    const item = this.cmdQueue.shift()!
    this.inflight = true
    this.pendingResolve = (v: BridgeResponse) => {
      this.inflight = false
      item.resolve(v)
      this.drainQueue()
    }
    this.pendingReject = (e: Error) => {
      this.inflight = false
      item.reject(e)
      this.drainQueue()
    }
    this.proc.stdin.write(JSON.stringify(item.cmd) + '\n')
  }

  private cleanup(): void {
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
    this.proc = null
    // Reject any pending queue items
    const err = new Error('Bridge process exited unexpectedly')
    for (const item of this.cmdQueue) item.reject(err)
    this.cmdQueue = []
    this.inflight = false
    this.pendingResolve = null
    this.pendingReject = null
  }
}
