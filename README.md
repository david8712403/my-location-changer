# iOS Location Changer

A web-based tool for simulating GPS location on iOS 17+ devices. Draw routes on a map, save them, and play back movement at configurable speeds.

## Prerequisites

- **macOS** (required for pymobiledevice3 USB communication)
- **Node.js 18+**
- **Python 3.9+**
- **iPhone** with **Developer Mode** enabled (Settings → Privacy & Security → Developer Mode)
- USB cable connecting iPhone to Mac

## Setup

```bash
bash scripts/setup-python.sh
npm install
```

## Tunnel Setup (REQUIRED before use)

The iOS 17+ developer tunnel must be started manually with sudo privileges before using the app:

```bash
sudo pymobiledevice3 remote tunneld --protocol tcp
```

Keep this running in a separate terminal. The tunnel provides the secure connection to the device's developer services.

## Start the App

```bash
npm run dev
```

Open http://localhost:5173 in your browser. The server runs on port 3001.

## Usage

1. Click on the map to **draw a route** (minimum 2 waypoints)
2. Enter a **route name** and click **Save Route**
3. Adjust the **speed slider** (1–30 km/h)
4. Click **Start** to begin GPS simulation on your device
5. Use **Pause/Resume/Stop** to control playback
6. Load previously saved routes from the sidebar

## Known Limitations

- The iOS tunnel (`tunneld`) must be started manually with `sudo` before use — the app cannot start it automatically for security reasons
- The `clear` command may occasionally leave a simulated location on the device; use the **Clear Device Location** button as a workaround
- Only **USB connection** is supported (no WiFi)
- Requires macOS — pymobiledevice3's USB stack does not work on Linux or Windows for this use case

## Android Prerequisites

Android GPS simulation requires a real Android device (API 31 / Android 12 or later) connected via USB with ADB.

1. **Install Android SDK Platform-Tools** — download from [developer.android.com/tools/releases/platform-tools](https://developer.android.com/tools/releases/platform-tools) and add `adb` to your PATH (or set the `ANDROID_HOME` environment variable to the SDK root)
2. **Enable Developer Options** on your device: Settings → About Phone → tap **Build Number** 7 times
3. **Enable USB Debugging**: Developer Options → USB Debugging → ON
4. **Connect your device via USB** and run `adb devices` — authorize the RSA fingerprint prompt on your device
5. **Verify connectivity**: `adb devices` should show your device with state `device` (not `unauthorized` or `offline`)
6. **Minimum Android version**: Android 12 (API level 31) — earlier versions are not supported

## Android Usage

1. Select **Android** in the platform switcher at the top of the sidebar
2. The StatusBar shows ADB connection status, API level, and device serial number
3. Use **Teleport** mode to instantly set a GPS location on your Android device
4. Use **Navigate** mode to simulate route playback (the device location updates at ≤2 Hz)
5. Use the **Clear Device Location** button to remove the simulated location from the device
6. Switching back to iOS automatically clears the Android simulated location

> **Note**: The app uses the `cmd location` test-provider API (Android 12+) — not `adb emu geo fix` (emulator-only) or mock location settings. No companion app is required.
