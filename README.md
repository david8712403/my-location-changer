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
