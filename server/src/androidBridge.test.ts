import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StubAndroidBridge, AndroidBridge } from './androidBridge'
import { EventEmitter } from 'events'

// Mock child_process module
vi.mock('child_process', () => {
  return {
    spawn: vi.fn(),
  }
})

import * as childProcess from 'child_process'

describe('StubAndroidBridge', () => {
  it('getStatus returns correct shape', async () => {
    const bridge = new StubAndroidBridge()
    const status = await bridge.getStatus()
    expect(status.ok).toBe(true)
    expect(status.device_connected).toBe(false)
    expect(status.adb_available).toBe(false)
    expect(Array.isArray(status.devices)).toBe(true)
    expect(status.api_level).toBeNull()
  })

  it('setLocation resolves without error', async () => {
    const bridge = new StubAndroidBridge()
    await expect(bridge.setLocation(25.033, 121.565)).resolves.toBeUndefined()
  })

  it('clearLocation resolves without error', async () => {
    const bridge = new StubAndroidBridge()
    await expect(bridge.clearLocation()).resolves.toBeUndefined()
  })

  it('isRunning returns false', () => {
    const bridge = new StubAndroidBridge()
    expect(bridge.isRunning()).toBe(false)
  })
})

describe('AndroidBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('throws when python script not found', async () => {
    const mockProc = new EventEmitter() as any
    mockProc.stdout = new EventEmitter()
    mockProc.stdout.pause = vi.fn()
    mockProc.stdout.resume = vi.fn()
    mockProc.stdout.setEncoding = vi.fn()
    mockProc.stdin = { write: vi.fn(), end: vi.fn() }
    
    vi.mocked(childProcess.spawn).mockReturnValue(mockProc)

    const bridge = new AndroidBridge()
    
    setTimeout(() => {
      mockProc.emit('close', 1)
    }, 5)

    await expect(bridge.start()).rejects.toThrow('Bridge process exited unexpectedly')
  })

  it('getStatus auto-starts bridge when not running', async () => {
    const mockProc = new EventEmitter() as any
    mockProc.stdout = new EventEmitter()
    mockProc.stdout.pause = vi.fn()
    mockProc.stdout.resume = vi.fn()
    mockProc.stdout.setEncoding = vi.fn()
    mockProc.stdin = {
      write: vi.fn((raw: string) => {
        const cmd = JSON.parse(raw.trim()) as { action?: string }
        if (cmd.action === 'status') {
          setTimeout(() => {
            mockProc.stdout.emit('data', Buffer.from('{"ok":true,"adb_available":true,"device_connected":false,"devices":[],"api_level":null}\n'))
          }, 0)
        }
      }),
      end: vi.fn(),
    }

    vi.mocked(childProcess.spawn).mockReturnValue(mockProc)

    const bridge = new AndroidBridge()
    const status = await bridge.getStatus()

    expect(status.ok).toBe(true)
    expect(status.adb_available).toBe(true)
    expect(vi.mocked(childProcess.spawn)).toHaveBeenCalledTimes(1)
  })
})
