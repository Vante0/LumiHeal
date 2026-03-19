# LumiHeal

An ambient wellbeing lamp for people recovering from illness, injury, or emotional distress. Emotional recovery is hard to measure through clinical reports alone, and existing wellbeing trackers rely on screens and numerical dashboards that increase cognitive load and reduce engagement over time.

LumiHeal offers a different approach: a physical lamp that lets users reflect on their emotional energy each day without opening an app or interpreting complex data. Twist the lamp to bring an ArUco marker tag into view — each tag represents an energy level. Hold it still and it logs to a database and shifts the LED strip's colour to reflect your day. A Flask dashboard is available for reviewing trends over time, but the primary interaction is entirely screen-free.

**Key contributions:**
- Ambient interaction instead of screen-based input
- Encourages daily emotional reflection through a familiar physical gesture
- Combines physical interaction with digital wellbeing data
- Designed to support recovery and life transitions

---

## How it works

The lamp has 5 ArUco marker tags (IDs 0–4) placed inside a 3D-printed translucent shell. A camera sits at the base, pointed up. When you twist the lamp, a tag rotates into view. The Pi detects it, confirms it over a 2-second sliding window, and logs it.

The LED strip wraps around the lamp body and is divided into 5 segments — one per day. Colours blend from blue (Drained) through teal, green, and lime to yellow (Vibrant), reflecting your average energy for each of the last 5 days with data.

**Energy scale:**
| Tag | Label | Colour |
|-----|-------|--------|
| 0 | Drained | `rgb(0, 100, 255)` |
| 1 | Low | `rgb(0, 160, 200)` |
| 2 | Okay | `rgb(0, 180, 120)` |
| 3 | Good | `rgb(80, 200, 0)` |
| 4 | Vibrant | `rgb(220, 220, 0)` |

Up to 3 inputs per day. Entries are timestamped at 09:00, 14:00, and 20:00 regardless of actual time, to represent morning, afternoon, and evening check-ins. Once a day hits 3 entries, the next input automatically rolls to the following day.

---

## Hardware

- Raspberry Pi (tested on Pi 5)
- Pi Camera Module
- SK6812 RGBW NeoPixel LED strip (60 LEDs, wired to GPIO18)
- 3D-printed lamp shell with ArUco marker tags attached inside
- Separate 5V power supply for the LED strip (shared ground with Pi)

---

## Project structure

```
lumiheal/
├── app.py                  # Flask dashboard backend
├── lamp_test.py            # Main lamp detection + LED control script
├── detections.db           # Individual detection logs
├── daily_averages.db       # Per-day averaged energy data
├── static/
│   ├── charts.js           # All chart and UI logic
│   ├── styles.css          # Dark/light theme styles
│   └── Logo 1.png          # Logo
└── templates/
    └── index.html          # Dashboard HTML
```

---

## Databases

### `detections.db` — table `detections`
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `tag_id` | INTEGER | ArUco tag ID (0–4) |
| `detected_at` | TEXT | Timestamp (spread across 09:00 / 14:00 / 20:00) |
| `color` | TEXT | RGB string e.g. `rgb(0,180,120)` |
| `notes` | TEXT | Optional user note |

### `daily_averages.db` — table `daily_averages`
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `date` | TEXT | ISO date e.g. `2026-03-19` |
| `avg_tag` | REAL | Average tag value for the day |
| `num_readings` | INTEGER | Number of inputs that day |
| `color` | TEXT | Blended RGB string |
| `r`, `g`, `b` | INTEGER | Individual RGB channels of blended colour |
| `notes` | TEXT | Optional daily note |

---

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/daily` | All daily averages |
| POST | `/api/daily/<date>/notes` | Save a note for a day |
| GET | `/api/detections` | All detections (includes id, tag_id, detected_at, color, notes) |
| POST | `/api/detections/<id>/notes` | Save a note for a detection |
| GET | `/api/health` | Health check |

Flask runs on `host='0.0.0.0', port=5000`. The lamp camera stream runs on port `5001`.

---

## Dashboard features

Built with Flask, SQLite, Chart.js, and vanilla JS/CSS. Font: Google Fonts Outfit.

- **Energy trend chart** — scatter/dot plot with Daily / Weekly / Monthly toggle
  - Daily: individual detections by time of day + daily average swatch
  - Weekly: daily averages for Mon–Sun of selected week
  - Monthly: daily averages for each day of selected month
  - Y-axis labels: Drained · Low · Okay · Good · Vibrant
- **Energy distribution** — doughnut chart with the same Daily / Weekly / Monthly toggle
- **Energy calendar** — heatmap coloured by average energy, click to add or view notes
- **Notes modal** — works for daily averages (from calendar and weekly/monthly dots) and individual detections (from daily dots)
- **Hover tooltips** — show notes on trend chart dots
- **Light/dark theme toggle** — saves preference to localStorage
- **Logo in header**

---

## Installation

### 1. Clone the repo
```bash
git clone https://github.com/<your-username>/lumiheal.git
cd lumiheal
```

### 2. Create a virtual environment
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies
```bash
pip install flask opencv-contrib-python picamera2 adafruit-circuitpython-neopixel rpi_ws281x
```

> `opencv-contrib-python` is required (not `opencv-python`) — it includes the ArUco module.

### 4. Enable camera on the Pi
```bash
sudo raspi-config
```
Interface Options → Camera → Enable, then reboot.

### 5. Print ArUco tags
Go to [chev.me/arucogen](https://chev.me/arucogen/) and generate tags:
- Dictionary: **4x4 (50)**
- Marker IDs: **0, 1, 2, 3, 4** (one at a time)
- Print as large as possible, cut with a white border, stick inside the lamp shell

### 6. Wire the LED strip
- LED strip 5V → separate 5V power supply positive
- LED strip GND → power supply GND **and** Pi GND pin (shared ground is required)
- LED strip Data → Pi GPIO18

### 7. Run with sudo
The NeoPixel library requires root to control GPIO:
```bash
sudo /path/to/.venv/bin/python3 lamp_test.py
```

## Running

### Dashboard
```bash
python3 app.py
```
Access at `http://<pi-ip>:5000`

### Lamp detection + LEDs
```bash
sudo python3 lamp_test.py
```
Camera stream at `http://<pi-ip>:5001`

Run both simultaneously — they use separate ports and the same databases.

---

## Detection logic

- Camera checks for ArUco tags every 200ms
- Results are added to a 2-second sliding window
- If a tag makes up 40% or more of checks in the window, it's confirmed and logged
- The same tag cannot log twice in a row — the lamp must be rotated to a new tag first
- This prevents fleeting mid-rotation tags from triggering a log

---

## LED strip notes

The SK6812 strip has a GRBW byte order (not standard RGB). The code uses a `grbw(r, g, b)` helper that swaps R and G and sets W=0 to suppress the white channel and keep colours accurate.

Strip layout (60 LEDs total):
- Days 1–4: 11 LEDs each
- Day 5 (most recent active day): 16 LEDs

---

## Tech stack

- Python 3, Flask, SQLite3
- OpenCV (ArUco detection, CLAHE contrast enhancement)
- Picamera2
- Adafruit NeoPixel / CircuitPython
- Chart.js
- Vanilla JS / CSS
- Google Fonts (Outfit)
