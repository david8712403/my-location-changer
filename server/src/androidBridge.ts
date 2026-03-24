import { spawn, ChildProcess } from 'child_process'
import * as readline from 'readline'
import * as path from 'path'
import * as fs from 'fs'

export interface AndroidStatus {
  ok: boolean
  device_connected: boolean
  devices: Array<{ serial: string; state: string }>
  api_level: number | null
  adb_available: boolean
  error?: string
}

export interface AndroidBridgeInterface {
  start(): Promise<void>
  stop(): Promise<void>
  setLocation(lat: number, lon: number): Promise<void>
  clearLocation(): Promise<void>
  isRunning(): boolean
  getStatus(): Promise<AndroidStatus>
}

/**
 * Stub implementation for development/testing.
 * singletons.ts uses this until the real bridge is wired up.
 */
export class StubAndroidBridge implements AndroidBridgeInterface {
  async start(): Promise<void> {
    // Stub — real implementation spawns android_bridge.py subprocess
  }

  async stop(): Promise<void> {
    // Stub — real implementation sends quit command to android_bridge.py
  }

  async setLocation(_lat: number, _lon: number): Promise<void> {
    // Stub — real implementation sends set command to android_bridge.py
  }

  async clearLocation(): Promise<void> {
    // Stub — real implementation sends clear command to android_bridge.py
  }

  isRunning(): boolean {
    return false
  }

  async getStatus(): Promise<AndroidStatus> {
    return {
      ok: true,
      device_connected: false,
      devices: [],
      api_level: null,
      adb_available: false,
    }
  }
}

interface AndroidBridgeResponse {
  ok: boolean
  error?: string
  device_connected?: boolean
  devices?: Array<{ serial: string; state: string }>
  api_level?: number | null
  adb_available?: boolean
}

/**
 * Real subprocess bridge — spawns android_bridge.py and communicates via
 * newline-delimited JSON over stdin/stdout. Uses ADB to set mock locations
 * on Android devices.
 */
export class AndroidBridge implements AndroidBridgeInterface {
  private proc: ChildProcess | null = null
  private pendingResolve: ((v: AndroidBridgeResponse) => void) | null = null
  private pendingReject: ((e: Error) => void) | null = null
  private rl: readline.Interface | null = null
  private cmdQueue: Array<{
    cmd: Record<string, unknown>
    resolve: (v: AndroidBridgeResponse) => void
    reject: (e: Error) => void
  }> = []
  private inflight = false

  async start(): Promise<void> {
    if (this.proc) {
      return
    }

    const venvPython = path.join(__dirname, '../../python/venv/bin/python3')
    const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3.11'
    const bridgePath = path.join(__dirname, '../../android_bridge.py')

    this.proc = spawn(pythonBin, [bridgePath], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })

    this.rl = readline.createInterface({ input: this.proc.stdout! })

    this.rl.on('line', (line: string) => {
      if (!this.pendingResolve) return
      try {
        const data = JSON.parse(line) as AndroidBridgeResponse
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

    this.proc.on('error', (err: Error) => {
      if (this.pendingReject) {
        const reject = this.pendingReject
        this.pendingResolve = null
        this.pendingReject = null
        reject(err)
      }
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
    await this.ensureRunning()
    const resp = await this.sendCommand({ action: 'set', lat, lng: lon })
    if (!resp.ok) {
      throw new Error(resp.error ?? 'setLocation failed')
    }
  }

  async clearLocation(): Promise<void> {
    await this.ensureRunning()
    const resp = await this.sendCommand({ action: 'clear' })
    if (!resp.ok) {
      throw new Error(resp.error ?? 'clearLocation failed')
    }
  }

  async getStatus(): Promise<AndroidStatus> {
    await this.ensureRunning()
    const resp = await this.sendCommand({ action: 'status' })
    return {
      ok: resp.ok,
      device_connected: resp.device_connected ?? false,
      devices: resp.devices ?? [],
      api_level: resp.api_level ?? null,
      adb_available: resp.adb_available ?? false,
    }
  }

  isRunning(): boolean {
    return this.proc !== null
  }

  private sendCommand(cmd: Record<string, unknown>): Promise<AndroidBridgeResponse> {
    return new Promise((resolve, reject) => {
      this.cmdQueue.push({ cmd, resolve, reject })
      this.drainQueue()
    })
  }

  private async ensureRunning(): Promise<void> {
    if (!this.proc) {
      await this.start()
    }
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
    this.pendingResolve = (v: AndroidBridgeResponse) => {
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
