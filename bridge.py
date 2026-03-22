#!/usr/bin/env python3
"""iOS location bridge — maintains persistent DVT session.

Reads newline-delimited JSON commands from stdin, writes single-line JSON
responses to stdout. Maintains a persistent DVT connection for location
simulation on iOS 17+ devices via pymobiledevice3.

Protocol:
  → {"action":"status"}
  ← {"ok":true,"tunnel_connected":true,"device_connected":true}

  → {"action":"set","lat":37.7749,"lon":-122.4194}
  ← {"ok":true}

  → {"action":"clear"}
  ← {"ok":true}

  → {"action":"quit"}
  (bridge exits cleanly)
"""

import asyncio
import sys
import json

# Module-level globals — persistent DVT connection
rsd = None
dvt_provider = None
location_sim = None

# tunneld subprocess management
_tunneld_proc = None  # asyncio.subprocess.Process
_tunneld_logs = []  # ring buffer, max 200 lines
_MAX_TUNNEL_LOGS = 200


async def connect():
    """Establish persistent DVT connection via tunneld (TCP only)."""
    global rsd, dvt_provider, location_sim
    from pymobiledevice3.tunneld.api import get_tunneld_devices
    from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
    from pymobiledevice3.services.dvt.instruments.location_simulation import (
        LocationSimulation,
    )

    rsds = await get_tunneld_devices()
    if not rsds:
        raise Exception(
            "No tunnel devices found. "
            "Run: sudo pymobiledevice3 remote tunneld --protocol tcp"
        )
    rsd = rsds[0]
    dvt_provider = DvtProvider(rsd)
    await dvt_provider.connect()
    location_sim = LocationSimulation(dvt_provider)
    await location_sim.connect()


async def disconnect():
    """Close DVT connection resources in order; ignore errors."""
    global rsd, dvt_provider, location_sim
    for resource in (location_sim, dvt_provider, rsd):
        if resource is not None:
            try:
                if hasattr(resource, "close"):
                    result = resource.close()
                    if asyncio.iscoroutine(result):
                        await result
            except Exception:
                pass
    location_sim = None
    dvt_provider = None
    rsd = None


async def handle_status():
    """Check device and tunnel connectivity without maintaining state."""
    import urllib.request as _urllib_req
    import json as _json

    # 1. USB devices via usbmux (works WITHOUT tunneld)
    usb_devices = []
    device_connected = False
    try:
        from pymobiledevice3 import usbmux

        devices = await usbmux.list_devices()
        for d in devices:
            device_connected = True
            usb_devices.append(
                {
                    "udid": d.serial,
                    "connection_type": str(d.connection_type),
                }
            )
    except Exception:
        pass

    # 2. Tunneld HTTP health check (lightweight — no Python API needed)
    tunneld_running = False
    tunneld_data = {}
    try:
        req = _urllib_req.urlopen("http://127.0.0.1:49151/", timeout=1)
        tunneld_data = _json.loads(req.read())
        tunneld_running = True
    except Exception:
        pass

    tunnel_connected = len(tunneld_data) > 0

    return {
        "ok": True,
        "tunnel_connected": tunnel_connected,
        "device_connected": device_connected,
        "tunneld_running": tunneld_running,
        "devices": usb_devices,
        "tunneld_devices": list(tunneld_data.keys()),
        "tunneld_managed": _tunneld_proc is not None
        and _tunneld_proc.returncode is None,
        "tunneld_logs": list(_tunneld_logs[-50:]),
    }


async def handle_set(lat, lon):
    """Set simulated location. Lazy-connects on first call; reconnects on stale channel."""
    global location_sim
    if location_sim is None:
        await connect()
    try:
        await location_sim.set(lat, lon)
    except Exception as e:
        # iOS drops the DVT channel after idle or disconnect.
        # Detect channel-closed / connection-terminated errors and reconnect once.
        err_name = type(e).__name__
        if (
            "Channel" in err_name
            or "Connection" in err_name
            or "Channel is closed" in str(e)
            or "ConnectionTerminated" in err_name
        ):
            await disconnect()
            await connect()
            await location_sim.set(lat, lon)
        else:
            raise
    return {"ok": True}


async def handle_clear():
    """Clear simulated location with workaround for pymobiledevice3 bug #572."""
    global location_sim
    if location_sim is None:
        return {"ok": True}
    # Workaround #572: set near-origin first, wait, then clear
    await location_sim.set(0.0001, 0.0001)
    await asyncio.sleep(0.2)
    await location_sim.clear()
    return {"ok": True}


async def handle_start_tunneld():
    """Start tunneld subprocess with sudo. Requires NOPASSWD sudoers entry."""
    global _tunneld_proc, _tunneld_logs

    if _tunneld_proc is not None and _tunneld_proc.returncode is None:
        return {"ok": True, "message": "tunneld already running"}

    _tunneld_logs = []
    try:
        _tunneld_proc = await asyncio.create_subprocess_exec(
            "sudo",
            "pymobiledevice3",
            "remote",
            "tunneld",
            "--protocol",
            "tcp",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        # Kick off background log reader — fire and forget
        asyncio.ensure_future(_read_tunneld_logs())
        return {"ok": True, "message": "tunneld started"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _read_tunneld_logs():
    """Background coroutine: reads tunneld output line by line into ring buffer."""
    global _tunneld_proc, _tunneld_logs
    if _tunneld_proc is None or _tunneld_proc.stdout is None:
        return
    try:
        async for raw in _tunneld_proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            _tunneld_logs.append(line)
            if len(_tunneld_logs) > _MAX_TUNNEL_LOGS:
                _tunneld_logs = _tunneld_logs[-_MAX_TUNNEL_LOGS:]
    except Exception:
        pass


async def handle_stop_tunneld():
    """Stop the tunneld subprocess."""
    global _tunneld_proc

    if _tunneld_proc is None or _tunneld_proc.returncode is not None:
        return {"ok": True, "message": "tunneld not running"}

    try:
        _tunneld_proc.terminate()
        try:
            await asyncio.wait_for(_tunneld_proc.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            _tunneld_proc.kill()
            await _tunneld_proc.wait()
        return {"ok": True, "message": "tunneld stopped"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def main():
    """Main event loop — reads JSON commands from stdin, writes responses to stdout."""
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    try:
        while True:
            try:
                raw = await reader.readline()
            except Exception:
                break
            if not raw:
                break  # EOF
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
                action = cmd.get("action", "")
                if action == "status":
                    resp = await handle_status()
                elif action == "set":
                    resp = await handle_set(cmd["lat"], cmd["lon"])
                elif action == "clear":
                    resp = await handle_clear()
                elif action == "start_tunneld":
                    resp = await handle_start_tunneld()
                elif action == "stop_tunneld":
                    resp = await handle_stop_tunneld()
                elif action == "quit":
                    break
                else:
                    resp = {"ok": False, "error": f"unknown action: {action}"}
            except Exception as e:
                msg = str(e) or type(e).__name__
                resp = {"ok": False, "error": msg}
            print(json.dumps(resp), flush=True)
    finally:
        if _tunneld_proc is not None and _tunneld_proc.returncode is None:
            try:
                await handle_stop_tunneld()
            except Exception:
                pass
        if location_sim:
            try:
                await handle_clear()
            except Exception:
                pass
        await disconnect()


if __name__ == "__main__":
    asyncio.run(main())
