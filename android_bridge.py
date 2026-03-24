#!/usr/bin/env python3
"""Android location bridge via ADB.

Reads newline-delimited JSON commands from stdin and writes one JSON
response line to stdout per command.
"""

import json
import os
import shutil
import subprocess
import sys
import time

_adb = None
_provider_initialized = False
_last_update_time = 0.0


def _discover_adb():
    adb_path = shutil.which("adb")
    if adb_path:
        return adb_path

    env_roots = [
        os.environ.get("ANDROID_HOME", ""),
        os.environ.get("ANDROID_SDK_ROOT", ""),
    ]
    candidates = []
    for root in env_roots:
        if not root:
            continue
        candidates.append(os.path.join(root, "platform-tools", "adb"))

    candidates.extend(
        [
            "/opt/homebrew/bin/adb",
            "/usr/local/bin/adb",
            os.path.expanduser("~/Library/Android/sdk/platform-tools/adb"),
            os.path.expanduser("~/Android/Sdk/platform-tools/adb"),
        ]
    )

    for candidate in candidates:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate

    return adb_path


def _ensure_adb():
    global _adb
    if _adb is None:
        _adb = _discover_adb()
    return _adb


_adb = _discover_adb()


def _run_adb(args):
    try:
        return subprocess.run(
            [_adb] + args,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "ADB command timed out"}


def _error_from_result(result):
    return result.stderr.strip() or result.stdout.strip() or "ADB command failed"


def _get_api_level():
    result = _run_adb(["shell", "getprop", "ro.build.version.sdk"])
    if isinstance(result, dict):
        return result
    if result.returncode != 0:
        return {"ok": False, "error": _error_from_result(result)}
    try:
        return int(result.stdout.strip())
    except Exception:
        return None


def handle_status():
    adb = _ensure_adb()
    if adb is None:
        return {
            "ok": True,
            "adb_available": False,
            "device_connected": False,
            "devices": [],
            "api_level": None,
        }

    result = _run_adb(["devices", "-l"])
    if isinstance(result, dict):
        return result

    devices = []
    for raw_line in result.stdout.splitlines():
        line = raw_line.strip()
        if not line or line == "List of devices attached":
            continue
        parts = line.split("\t", 1)
        if len(parts) < 2:
            continue
        state = parts[1].split()[0]
        devices.append({"serial": parts[0], "state": state})

    device_connected = any(d["state"] == "device" for d in devices)

    api_level = None
    if device_connected:
        api_level_result = _get_api_level()
        if isinstance(api_level_result, dict):
            api_level = None
        else:
            api_level = api_level_result

    return {
        "ok": True,
        "adb_available": True,
        "device_connected": device_connected,
        "devices": devices,
        "api_level": api_level,
    }


def handle_set(lat, lng):
    global _provider_initialized, _last_update_time

    adb = _ensure_adb()
    if adb is None:
        return {
            "ok": False,
            "error": (
                "ADB not found. Install Android SDK Platform-Tools and add to PATH "
                "or set ANDROID_HOME."
            ),
        }

    now = time.time()
    if now - _last_update_time < 0.5:
        return {"ok": True}

    api_level = _get_api_level()
    if isinstance(api_level, dict):
        return api_level
    if api_level is None or api_level < 31:
        return {
            "ok": False,
            "error": f"Android API 31+ required (found API {api_level})",
        }

    if not _provider_initialized:
        _run_adb(["shell", "cmd", "location", "remove-test-provider", "gps"])

        result = _run_adb(["shell", "cmd", "location", "add-test-provider", "gps"])
        if isinstance(result, dict):
            return result
        if result.returncode != 0:
            return {"ok": False, "error": _error_from_result(result)}

        result = _run_adb(
            ["shell", "cmd", "location", "set-test-provider-enabled", "gps", "true"]
        )
        if isinstance(result, dict):
            return result
        if result.returncode != 0:
            return {"ok": False, "error": _error_from_result(result)}

        _provider_initialized = True

    result = _run_adb(
        [
            "shell",
            "cmd",
            "location",
            "set-test-provider-location",
            "gps",
            "--location",
            f"{lat},{lng}",
        ]
    )
    if isinstance(result, dict):
        return result
    if result.returncode != 0:
        return {"ok": False, "error": _error_from_result(result)}

    _last_update_time = time.time()
    return {"ok": True}


def handle_clear():
    global _provider_initialized

    adb = _ensure_adb()
    if adb is None:
        return {"ok": True}

    _run_adb(["shell", "cmd", "location", "remove-test-provider", "gps"])
    _provider_initialized = False
    return {"ok": True}


def main():
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
            action = cmd.get("action", "")

            if action == "status":
                resp = handle_status()
            elif action == "set":
                resp = handle_set(cmd["lat"], cmd["lng"])
            elif action == "clear":
                resp = handle_clear()
            elif action == "quit":
                handle_clear()
                sys.exit(0)
            else:
                resp = {"ok": False, "error": f"unknown action: {action}"}
        except Exception as e:
            resp = {"ok": False, "error": str(e) or type(e).__name__}

        print(json.dumps(resp), flush=True)


if __name__ == "__main__":
    main()
