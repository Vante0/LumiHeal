# LumiHeal

Emotional recovery is hard to track. Clinical reports capture snapshots, not the day-to-day texture of how someone actually feels. Most wellbeing apps ask you to open a screen, pick a number, and interpret a chart — which adds friction at exactly the moments when you have the least energy for it.

LumiHeal is a lamp. You twist it. That's it.

Each twist brings a different ArUco marker tag into view inside the translucent shell. Each tag maps to an energy level — from Drained to Vibrant. Hold the lamp still for a moment and it logs your input, then shifts the LED strip's colour to reflect your day. No screen needed. The lamp itself is the feedback.

A Flask dashboard is available for reviewing trends over time, but it's a secondary layer — the core interaction is entirely physical.

---

## How it works

Five ArUco marker tags (IDs 0–4) are fixed inside the 3D-printed lamp shell. A Pi Camera sits at the base, pointing up through the LED strip. When you twist the lamp, a tag rotates into the camera's field of view. The script detects it over a short sliding window to filter out accidental mid-rotation reads, then logs it.

The LED strip is divided into 5 segments, one per day. The colour of each segment is the blended average of that day's inputs — shifting from blue at the low end to yellow at the high end.

**Energy scale:**

| Tag | Label | Colour |
|-----|-------|--------|
| 0 | Drained | `rgb(0, 100, 255)` — blue |
| 1 | Low | `rgb(0, 160, 200)` — teal-blue |
| 2 | Okay | `rgb(0, 180, 120)` — teal-green |
| 3 | Good | `rgb(80, 200, 0)` — lime |
| 4 | Vibrant | `rgb(220, 220, 0)` — yellow |

The strip always shows the last 5 days that have data. Once a day has entries, it appears as the rightmost segment. Older days shift left over time.

---

## Demo notes

A few things were simplified for the demo and aren't representative of how the full system would work in production:

- **3 inputs per day** — capped at 3 to keep the demo short. In real use this would likely be higher or uncapped.
- **Spread timestamps** — entries are logged at fixed times (09:00, 14:00, 20:00) regardless of when they actually happen. This makes the dashboard's daily view look realistic without needing to wait across a full day.
- **Auto day rollover** — once a day hits 3 entries, the next input automatically goes to the following date. This lets you demo multiple days in a single session.
- **Test databases** — `detections.db` and `daily_averages.db` in the repo contain populated test data so the dashboard has something to show on first load.

---

## Hardware

- Raspberry Pi (tested on Pi 4 model b)
- Pi Camera Module
- SK6812 GRBW NeoPixel LED strip — 60 LEDs, wired to GPIO18
- 3D-printed translucent lamp shell
- ArUco marker tags (printed, cut, and stuck inside the shell)
- Separate 5V power supply for the LED strip with shared ground to the Pi

---

## Project structure

```
lumiheal/
├── app.py                  # Flask dashboard backend
├── lamp_test.py            # Lamp detection and LED control
├── detections.db           # Individual detection logs
├── daily_averages.db       # Per-day averaged energy data
├── static/
│   ├── charts.js           # Chart and UI logic
│   ├── styles.css          # Dark/light theme
│   └── Logo 1.png
└── templates/
    └── index.html
```

---

## Databases

### `detections.db` — table `detections`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `tag_id` | INTEGER | ArUco tag ID (0–4) |
| `detected_at` | TEXT | Timestamp — spread to 09:00, 14:00, or 20:00 for demo |
| `color` | TEXT | RGB string e.g. `rgb(0,180,120)` |
| `notes` | TEXT | Optional user note |

### `daily_averages.db` — table `daily_averages`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `date` | TEXT | ISO date e.g. `2026-03-19` |
| `avg_tag` | REAL | Average tag value for the day |
| `num_readings` | INTEGER | Number of inputs logged |
| `color` | TEXT | Blended RGB string |
| `r`, `g`, `b` | INTEGER | Individual RGB channels |
| `notes` | TEXT | Optional daily note |

---

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/daily` | All daily averages |
| POST | `/api/daily/<date>/notes` | Save a note for a day |
| GET | `/api/detections` | All individual detections |
| POST | `/api/detections/<id>/notes` | Save a note for a detection |
| GET | `/api/health` | Health check |

Dashboard runs on port `5000`. Camera stream (from `lamp_test.py`) runs on port `5001` to avoid conflicts when both are running together.

---

## Dashboard

Built with Flask, SQLite, Chart.js, and vanilla JS/CSS. Font: Google Fonts Outfit.

- **Energy trend chart** — dot/scatter plot, no lines or fill. Daily / Weekly / Monthly toggle.
  - Daily: individual detections plotted by time of day, daily average shown below
  - Weekly: one dot per day for the selected week
  - Monthly: one dot per day for the selected month
  - Y-axis: Drained · Low · Okay · Good · Vibrant
- **Energy distribution** — doughnut chart with the same toggle
- **Energy calendar** — heatmap by average energy per day, click to add or view notes
- **Notes** — attachable to individual detections or daily averages, visible on hover in the chart
- **Light/dark theme** — toggle in the navbar, saved to localStorage

---

## Installation

### 1. Clone the repo
```bash
git clone https://github.com/Vante0/LumiHeal.git
cd LumiHeal
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

`opencv-contrib-python` is needed specifically — the standard `opencv-python` doesn't include the ArUco module.

### 4. Enable the camera
```bash
sudo raspi-config
```
Interface Options → Camera → Enable, then reboot.

### 5. Print ArUco tags
Go to [chev.me/arucogen](https://chev.me/arucogen/):
- Dictionary: **4x4 (50)**
- Generate IDs **0, 1, 2, 3, 4** separately
- Print large, cut with a white border, and fix inside the lamp shell

### 6. Wire the LED strip
- Strip 5V → separate 5V supply (do not power from the Pi's 5V pin)
- Strip GND → supply GND and Pi GND (shared ground is required for the data signal to work)
- Strip Data → GPIO18

### 7. Run with sudo
NeoPixel GPIO access requires root:
```bash
sudo /path/to/.venv/bin/python3 lamp_test.py
```

---

## Running

**Dashboard:**
```bash
python3 app.py
```
Open `http://<pi-ip>:5000`

**Lamp:**
```bash
sudo python3 lamp_test.py
```
Camera stream at `http://<pi-ip>:5001`

Both can run at the same time — they share the same databases and use separate ports.

---

## Detection logic

The camera runs every 200ms rather than every frame, which reduces CPU load and gives each check enough time to be meaningful. Each result goes into a 2-second sliding window. If a single tag makes up 20% or more of that window, it gets logged.

The 20% threshold is low by design. The camera sits very close to the tags inside the lamp, the image is often blurry, and the LED strip causes glare that further reduces contrast. Some tags would fail to confirm at all with a higher threshold. In practice it still takes roughly 1–2 seconds of holding the lamp still for a tag to confirm reliably. The same tag can't log twice in a row — you have to rotate to a different tag and back.

---

## LED strip quirks

The SK6812 strip uses GRBW byte order, not the standard RGB. There's a `grbw(r, g, b)` helper in `lamp_test.py` that swaps R and G and sets W to 0. Without this, colours come out wrong and the white channel washes everything out.

Strip layout:
- Segments 1–4: 11 LEDs each (4 days of history)
- Segment 5: 16 LEDs (current active day, wider for visual emphasis)

---

## Tech stack

- Python 3, Flask, SQLite3
- OpenCV with ArUco — detection and CLAHE contrast enhancement
- Picamera2
- Adafruit NeoPixel / CircuitPython
- Chart.js
- Vanilla JS and CSS
- Google Fonts (Outfit)