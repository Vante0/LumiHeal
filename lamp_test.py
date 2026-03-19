import cv2
import sqlite3
import board
import neopixel
import time
import threading
from collections import deque
from flask import Flask, Response
from picamera2 import Picamera2
from datetime import datetime, date, timedelta

# ── Constants ─────────────────────────────────────────────────
NUM_LEDS        = 60
NUM_DAYS        = 5
LEDS_PER_DAY    = 11
MAX_ENTRIES_DAY = 3

DRIFT_STEPS = 8
DRIFT_DELAY = 0.1

DETECTION_INTERVAL = 0.2
WINDOW_SECONDS     = 2.0
CONFIRM_THRESHOLD  = 0.2

DETECTIONS_DB = "detections.db"
DAILY_DB      = "daily_averages.db"

TAG_COLORS = {
    0: (0,   100, 255),
    1: (0,   160, 200),
    2: (0,   180, 120),
    3: (80,  200,   0),
    4: (220, 220,   0),
}

DIM = (5, 5, 5)

# Spread log times across morning, afternoon, evening
LOG_TIMES = ["09:00:00", "14:00:00", "20:00:00"]

# ── NeoPixel setup ────────────────────────────────────────────
pixels = neopixel.NeoPixel(
    board.D18, NUM_LEDS,
    brightness=0.3,
    auto_write=False,
    pixel_order=neopixel.RGBW
)

def grbw(r, g, b):
    return (g, r, b, 0)

# ── Flask Stream Setup ────────────────────────────────────────
app = Flask(__name__)
latest_frame = None

def generate_stream():
    global latest_frame
    while True:
        if latest_frame is None:
            continue
        ret, jpeg = cv2.imencode('.jpg', latest_frame)
        if not ret:
            continue
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' +
               jpeg.tobytes() + b'\r\n')

@app.route('/')
def video_feed():
    return Response(generate_stream(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

def run_server():
    app.run(host='0.0.0.0', port=5001, debug=False)

# ── Database helpers ──────────────────────────────────────────
def init_dbs():
    conn = sqlite3.connect(DETECTIONS_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS detections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id INTEGER NOT NULL,
            detected_at TEXT NOT NULL,
            color TEXT
        )
    """)
    conn.commit()
    conn.close()

    conn = sqlite3.connect(DAILY_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_averages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL UNIQUE,
            avg_tag REAL NOT NULL,
            num_readings INTEGER NOT NULL,
            color TEXT NOT NULL,
            r INTEGER NOT NULL,
            g INTEGER NOT NULL,
            b INTEGER NOT NULL
        )
    """)
    conn.commit()
    conn.close()

def get_entries_for_date(d):
    conn = sqlite3.connect(DETECTIONS_DB)
    rows = conn.execute(
        "SELECT tag_id FROM detections WHERE detected_at LIKE ? ORDER BY detected_at",
        (d + "%",)
    ).fetchall()
    conn.close()
    return [r[0] for r in rows]

def get_active_date():
    """
    Returns the date we are currently logging to.
    If today already has MAX entries, returns tomorrow.
    If tomorrow has MAX entries, returns day after, etc.
    """
    d = date.today()
    while True:
        entries = get_entries_for_date(d.isoformat())
        if len(entries) < MAX_ENTRIES_DAY:
            return d, entries
        d += timedelta(days=1)

def get_strip_colors():
    """Returns 5 (r,g,b) tuples for the strip from the last 5 days with data."""
    active_date, active_entries = get_active_date()
    active_str = active_date.isoformat()
    conn = sqlite3.connect(DAILY_DB)

    if active_entries:
        # Active date has entries — show last 4 other days + active day
        rows = conn.execute(
            "SELECT r, g, b FROM daily_averages WHERE date != ? ORDER BY date DESC LIMIT 4",
            (active_str,)
        ).fetchall()
        rows.reverse()
        history = [tuple(r) for r in rows]
        while len(history) < 4:
            history.insert(0, DIM)
        n    = len(active_entries)
        live = (
            sum(TAG_COLORS[t][0] for t in active_entries) // n,
            sum(TAG_COLORS[t][1] for t in active_entries) // n,
            sum(TAG_COLORS[t][2] for t in active_entries) // n,
        )
        conn.close()
        return history + [live]
    else:
        # Active date has no entries yet — show last 5 days with data
        rows = conn.execute(
            "SELECT r, g, b FROM daily_averages ORDER BY date DESC LIMIT 5"
        ).fetchall()
        rows.reverse()
        conn.close()
        colors = [tuple(r) for r in rows]
        while len(colors) < 5:
            colors.insert(0, DIM)
        return colors

def log_detection(tag_id, target_date, entry_index):
    """Log detection with a spread timestamp (morning/afternoon/evening)."""
    color     = TAG_COLORS[tag_id]
    log_time  = LOG_TIMES[min(entry_index, len(LOG_TIMES) - 1)]
    timestamp = f"{target_date} {log_time}"
    conn = sqlite3.connect(DETECTIONS_DB)
    conn.execute(
        "INSERT INTO detections (tag_id, detected_at, color) VALUES (?, ?, ?)",
        (tag_id, timestamp, f"rgb({color[0]},{color[1]},{color[2]})")
    )
    conn.commit()
    conn.close()
    print(f"\n[{timestamp}] Tag {tag_id} logged!", flush=True)

def update_daily_avg(tag_ids, target_date):
    d = target_date.isoformat()
    n = len(tag_ids)
    r = sum(TAG_COLORS[t][0] for t in tag_ids) // n
    g = sum(TAG_COLORS[t][1] for t in tag_ids) // n
    b = sum(TAG_COLORS[t][2] for t in tag_ids) // n
    conn = sqlite3.connect(DAILY_DB)
    conn.execute("""
        INSERT INTO daily_averages (date, avg_tag, num_readings, color, r, g, b)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            avg_tag=excluded.avg_tag,
            num_readings=excluded.num_readings,
            color=excluded.color,
            r=excluded.r, g=excluded.g, b=excluded.b
    """, (d, round(sum(tag_ids)/n, 2), n, f"rgb({r},{g},{b})", r, g, b))
    conn.commit()
    conn.close()

# ── LED helpers ───────────────────────────────────────────────
def segment_range(day_index):
    start = day_index * LEDS_PER_DAY
    end   = start + LEDS_PER_DAY if day_index < NUM_DAYS - 1 else NUM_LEDS
    return start, end

def drift_segment(day_index, from_color, to_color):
    start, end = segment_range(day_index)
    for step in range(DRIFT_STEPS + 1):
        t = step / DRIFT_STEPS
        blended = (
            int(from_color[0] + (to_color[0] - from_color[0]) * t),
            int(from_color[1] + (to_color[1] - from_color[1]) * t),
            int(from_color[2] + (to_color[2] - from_color[2]) * t)
        )
        for i in range(start, end):
            pixels[i] = grbw(*blended)
        pixels.show()
        time.sleep(DRIFT_DELAY)

def render_strip(colors):
    for i, color in enumerate(colors):
        start, end = segment_range(i)
        for j in range(start, end):
            pixels[j] = grbw(*color)
    pixels.show()

def animate_new_input(old_colors, new_colors):
    print("Updating strip...", flush=True)
    for i in range(NUM_DAYS):
        if old_colors[i] != new_colors[i]:
            drift_segment(i, old_colors[i], new_colors[i])

# ── Camera setup ──────────────────────────────────────────────
picam2 = Picamera2()
picam2.configure(picam2.create_preview_configuration(
    main={"size": (1280, 720), "format": "RGB888"}
))
picam2.start()

aruco_dict   = cv2.aruco.Dictionary_get(cv2.aruco.DICT_4X4_50)
aruco_params = cv2.aruco.DetectorParameters_create()
aruco_params.adaptiveThreshWinSizeMin  = 3
aruco_params.adaptiveThreshWinSizeMax  = 99
aruco_params.adaptiveThreshWinSizeStep = 5
aruco_params.minMarkerPerimeterRate    = 0.005
aruco_params.errorCorrectionRate       = 1.0

clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

# ── Startup ───────────────────────────────────────────────────
init_dbs()
active_date, active_entries = get_active_date()
strip_colors = get_strip_colors()

print(f"Active date: {active_date} | entries: {active_entries} | {MAX_ENTRIES_DAY - len(active_entries)} remaining", flush=True)
print(f"Strip colors: {strip_colors}", flush=True)
render_strip(strip_colors)

threading.Thread(target=run_server, daemon=True).start()
print("Camera stream ready at: http://<pi-ip>:5001", flush=True)
print(f"Detection: {int(CONFIRM_THRESHOLD*100)}% of checks in {WINDOW_SECONDS}s window needed to log.", flush=True)

# ── Detection state ───────────────────────────────────────────
last_logged_tag = None
window          = deque()
last_check_time = 0

# ── Main loop ─────────────────────────────────────────────────
try:
    while True:
        frame = picam2.capture_array("main")
        bgr   = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

        now = time.time()

        if now - last_check_time < DETECTION_INTERVAL:
            latest_frame = bgr.copy()
            time.sleep(0.01)
            continue

        last_check_time = now

        gray       = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        gray_clahe = clahe.apply(gray)

        corners, ids, _ = cv2.aruco.detectMarkers(gray_clahe, aruco_dict, parameters=aruco_params)

        current_tag = None
        if ids is not None:
            cv2.aruco.drawDetectedMarkers(bgr, corners, ids)
            detected = int(ids.flatten()[0])
            if detected in TAG_COLORS:
                current_tag = detected

        latest_frame = bgr.copy()

        window.append((now, current_tag))
        while window and now - window[0][0] > WINDOW_SECONDS:
            window.popleft()

        total = len(window)
        if total == 0:
            time.sleep(0.01)
            continue

        tag_counts = {}
        for _, t in window:
            if t is not None:
                tag_counts[t] = tag_counts.get(t, 0) + 1

        if not tag_counts:
            print("No tag in window.   ", end="\r", flush=True)
            time.sleep(0.01)
            continue

        dominant_tag   = max(tag_counts, key=tag_counts.get)
        dominant_count = tag_counts[dominant_tag]
        dominant_pct   = dominant_count / total

        # Refresh active date in case it rolled over
        active_date, active_entries = get_active_date()

        if dominant_tag == last_logged_tag:
            print(f"Tag {dominant_tag} already logged — rotate to new tag.   ", end="\r", flush=True)
        else:
            remaining = MAX_ENTRIES_DAY - len(active_entries)
            print(f"Tag {dominant_tag} | {dominant_count}/{total} ({int(dominant_pct*100)}%) | {remaining} remaining on {active_date}   ", end="\r", flush=True)

            if dominant_pct >= CONFIRM_THRESHOLD:
                entry_index = len(active_entries)  # 0, 1, or 2 → morning, afternoon, evening -> only for demo purposes

                log_detection(dominant_tag, active_date, entry_index)
                active_entries.append(dominant_tag)
                update_daily_avg(active_entries, active_date)

                if len(active_entries) >= MAX_ENTRIES_DAY:
                    next_date = active_date + timedelta(days=1)
                    print(f"\n{active_date} full. Next input goes to {next_date}.", flush=True)
                else:
                    print(f"\n{MAX_ENTRIES_DAY - len(active_entries)} input(s) remaining for {active_date}.", flush=True)

                old_colors   = strip_colors
                strip_colors = get_strip_colors()
                animate_new_input(old_colors, strip_colors)

                last_logged_tag = dominant_tag
                window.clear()

        time.sleep(0.01)

except KeyboardInterrupt:
    print("\nExiting...", flush=True)
finally:
    pixels.fill((0, 0, 0, 0))
    pixels.show()
    picam2.stop()
    print("LEDs off. Bye.", flush=True)