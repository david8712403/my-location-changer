import { useState, useEffect, useCallback, useRef } from 'react'
import type { SimStatus } from './PlaybackControls'

interface StatusBarProps {
  simStatus: SimStatus
  onError?: (msg: string) => void
  platform: 'ios' | 'android'
  onConnectionChange?: (connected: boolean) => void
}

interface DeviceStatus {
  ok: boolean
  tunnel_connected: boolean
  device_connected: boolean
  tunneld_running: boolean
  tunneld_managed: boolean
  tunneld_logs: string[]
  devices: Array<{ udid: string; connection_type: string }>
  tunneld_devices: string[]
}

interface AndroidDeviceStatus {
  ok: boolean
  device_connected: boolean
  devices: Array<{ serial: string; state: string }>
  api_level: number | null
  adb_available: boolean
}

const INITIAL_IOS: DeviceStatus = {
  ok: false,
  tunnel_connected: false,
  device_connected: false,
  tunneld_running: false,
  tunneld_managed: false,
  tunneld_logs: [],
  devices: [],
  tunneld_devices: [],
}

const INITIAL_ANDROID: AndroidDeviceStatus = {
  ok: false,
  device_connected: false,
  devices: [],
  api_level: null,
  adb_available: false,
}

export default function StatusBar({ simStatus, onError, platform, onConnectionChange }: StatusBarProps) {
  const [iosStatus, setIosStatus] = useState<DeviceStatus>(INITIAL_IOS)
  const [androidStatus, setAndroidStatus] = useState<AndroidDeviceStatus>(INITIAL_ANDROID)
  const [clearError, setClearError] = useState<string | null>(null)
  const [clearLoading, setClearLoading] = useState(false)
  const [tunnelAction, setTunnelAction] = useState<'starting' | 'stopping' | null>(null)

  const onConnectionChangeRef = useRef(onConnectionChange)
  onConnectionChangeRef.current = onConnectionChange

  const refreshStatus = useCallback(async (signal?: AbortSignal, plat?: 'ios' | 'android') => {
    const activePlatform = plat ?? platform
    try {
      const res = await fetch(`/api/device/status?platform=${activePlatform}`, {
        signal,
      })
      if (!res.ok) return
      if (activePlatform === 'ios') {
        const data = (await res.json()) as DeviceStatus
        setIosStatus(data)
      } else {
        const data = (await res.json()) as AndroidDeviceStatus
        setAndroidStatus(data)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
    }
  }, [platform])

  // Notify parent of connection changes
  useEffect(() => {
    let connected: boolean
    if (platform === 'ios') {
      connected = iosStatus.device_connected
    } else {
      connected = androidStatus.adb_available && androidStatus.device_connected
    }
    onConnectionChangeRef.current?.(connected)
  }, [platform, iosStatus.device_connected, androidStatus.adb_available, androidStatus.device_connected])

  // Reset state and restart polling when platform changes
  useEffect(() => {
    const controller = new AbortController()

    if (platform === 'ios') {
      setIosStatus(INITIAL_IOS)
    } else {
      setAndroidStatus(INITIAL_ANDROID)
    }
    setClearError(null)

    void refreshStatus(controller.signal, platform)
    const interval = setInterval(() => {
      void refreshStatus(controller.signal, platform)
    }, 2000)

    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [platform, refreshStatus])

  const handleClear = useCallback(async () => {
    setClearError(null)
    setClearLoading(true)
    try {
      const res = await fetch(`/api/simulate/clear?platform=${platform}`, { method: 'POST' })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Clear failed: ${res.status}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Clear failed'
      setClearError(msg)
      onError?.(msg)
    } finally {
      setClearLoading(false)
    }
  }, [onError, platform])

  const runTunnelCommand = useCallback(async (action: 'starting' | 'stopping', endpoint: string) => {
    setTunnelAction(action)
    try {
      const res = await fetch(endpoint, { method: 'POST' })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Tunnel command failed: ${res.status}`)
      }
      await refreshStatus()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tunnel command failed'
      onError?.(msg)
    } finally {
      setTunnelAction(null)
    }
  }, [onError, refreshStatus])

  const handleStartTunnel = useCallback(async () => {
    await runTunnelCommand('starting', '/api/device/tunneld/start')
  }, [runTunnelCommand])

  const handleStopTunnel = useCallback(async () => {
    await runTunnelCommand('stopping', '/api/device/tunneld/stop')
  }, [runTunnelCommand])

  // --- iOS-specific derived values ---
  const status = iosStatus
  const tunnelBusy = tunnelAction !== null
  const tunnelActionLabel =
    tunnelAction === 'starting'
      ? 'Starting tunnel service...'
      : tunnelAction === 'stopping'
        ? 'Stopping tunnel service...'
        : null

  const usbLabel = status.device_connected
    ? `Connected via USB${status.devices.length ? ` (${status.devices[0].udid.slice(0, 8)}...)` : ''}`
    : 'No USB device detected'

  const tunnelLabel = status.tunneld_running
    ? `Running${status.tunnel_connected ? ' · Device linked' : ' · Waiting for device link'}`
    : 'Stopped'

  // --- Android-specific derived values ---
  const adbStatus = androidStatus
  const androidConnected = adbStatus.adb_available && adbStatus.device_connected
  const adbLabel = adbStatus.adb_available && adbStatus.device_connected
    ? 'ADB Connected'
    : !adbStatus.adb_available
      ? 'ADB Not Found — install Android platform-tools and add to PATH'
      : 'No Device Connected'
  const apiLevelOk = adbStatus.api_level != null && adbStatus.api_level >= 31

  return (
    <div data-testid="status-bar" className="status-bar">
      <div className="status-overview">
        <span className={`status-pill status-pill-${simStatus.state}`}>
          Playback: {simStatus.state}
        </span>
        <span className="status-pill status-pill-progress">Progress: {simStatus.progress}%</span>
      </div>

      {platform === 'ios' ? (
        <>
          <div className="status-grid">
            <div className={`status-item ${status.device_connected ? 'is-online' : 'is-offline'}`}>
              <span className="status-dot" aria-hidden="true" />
              <div>
                <div className="status-item-title">USB Device</div>
                <div className="status-item-value">{usbLabel}</div>
              </div>
            </div>
            <div className={`status-item ${status.tunneld_running ? 'is-online' : 'is-offline'}`}>
              <span className="status-dot" aria-hidden="true" />
              <div>
                <div className="status-item-title">Tunnel</div>
                <div className="status-item-value">
                  {tunnelLabel}
                  {status.tunneld_managed ? ' · Managed by app' : ' · Manual mode'}
                </div>
              </div>
            </div>
          </div>

          <div className="tunnel-control-box">
            <div className="tunnel-control-header">
              <h4 className="tunnel-control-title">Tunnel Control</h4>
              {tunnelBusy ? <span className="tunnel-running-tag">Applying...</span> : null}
            </div>

            <div className="tunnel-action-row">
              {!status.tunneld_running ? (
                <button
                  data-testid="btn-start-tunnel"
                  onClick={handleStartTunnel}
                  disabled={tunnelBusy}
                  className="status-btn status-btn-start"
                >
                  {tunnelBusy ? 'Starting...' : 'Start Tunnel'}
                </button>
              ) : status.tunneld_managed ? (
                <button
                  data-testid="btn-stop-tunnel"
                  onClick={handleStopTunnel}
                  disabled={tunnelBusy}
                  className="status-btn status-btn-stop"
                >
                  {tunnelBusy ? 'Stopping...' : 'Stop Tunnel'}
                </button>
              ) : (
                <span className="status-manual-note">Tunnel was started manually; stop it in terminal.</span>
              )}
            </div>

            {tunnelActionLabel && (
              <div className="tunnel-pending">
                <span className="tunnel-spinner" aria-hidden="true" />
                <span>{tunnelActionLabel}</span>
              </div>
            )}

            {!status.tunneld_running && (
              <div className="status-hint-box">
                <div>Need passwordless sudoers for one-click control:</div>
                <code>%admin ALL=(ALL) NOPASSWD: /usr/local/bin/pymobiledevice3</code>
                <div>Or run manually:</div>
                <code>sudo pymobiledevice3 remote tunneld --protocol tcp</code>
              </div>
            )}

            {status.tunneld_running && status.tunneld_logs.length > 0 && (
              <div className="tunnel-log-panel">
                {status.tunneld_logs.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="status-grid">
          <div className={`status-item ${androidConnected ? 'is-online' : 'is-offline'}`}>
            <span className="status-dot" aria-hidden="true" />
            <div>
              <div className="status-item-title">ADB</div>
              <div className="status-item-value">{adbLabel}</div>
            </div>
          </div>
          <div className={`status-item ${apiLevelOk ? 'is-online' : 'is-offline'}`}>
            <span className="status-dot" aria-hidden="true" />
            <div>
              <div className="status-item-title">API Level</div>
              <div className={apiLevelOk ? '' : 'status-bar__api-warn'}>
                {adbStatus.api_level != null ? `API ${adbStatus.api_level}${adbStatus.api_level < 31 ? ' — Android 12 (API 31) required' : ''}` : 'Unknown — connect device'}
              </div>
            </div>
          </div>
          {adbStatus.devices.length > 0 && (
            <div className="status-item is-online">
              <span className="status-dot" aria-hidden="true" />
              <div>
                <div className="status-item-title">Device</div>
                <div className="status-item-value">{adbStatus.devices[0].serial}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {clearError && <div className="status-inline-error">{clearError}</div>}

      <button
        data-testid="btn-clear-device"
        onClick={handleClear}
        disabled={clearLoading}
        className="status-btn status-btn-clear"
      >
        {clearLoading ? 'Clearing...' : 'Clear Device Location'}
      </button>
    </div>
  )
}
