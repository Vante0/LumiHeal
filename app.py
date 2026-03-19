import sqlite3
import os
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_db_connection(db_name):
    path = os.path.join(BASE_DIR, db_name)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    try:
        conn = get_db_connection('daily_averages.db')
        cursor = conn.execute("PRAGMA table_info(daily_averages)")
        columns = [row[1] for row in cursor.fetchall()]
        conn.close()

        if 'notes' not in columns:
            raise Exception("Missing 'notes' column in daily_averages table")

    except Exception as e:
        print("DB validation error:", e)

    # Ensure detections.db has notes column
    try:
        conn = get_db_connection('detections.db')
        cursor = conn.execute("PRAGMA table_info(detections)")
        columns = [row[1] for row in cursor.fetchall()]
        if 'notes' not in columns:
            conn.execute("ALTER TABLE detections ADD COLUMN notes TEXT")
            conn.commit()
            print("Added notes column to detections table")
        conn.close()
    except Exception as e:
        print("Detections DB init error:", e)

init_db()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/daily', methods=['GET'])
def get_daily():
    try:
        conn = get_db_connection('daily_averages.db')
        items = conn.execute('SELECT * FROM daily_averages ORDER BY date ASC').fetchall()
        conn.close()
        return jsonify([dict(item) for item in items])
    except Exception as e:
        return jsonify({
            "error": str(e),
            "message": "Check if database file exists and has correct schema"
        }), 500

@app.route('/api/daily/<date>/notes', methods=['POST'])
def update_notes(date):
    data = request.get_json(silent=True) or {}
    notes = data.get('notes', '')
    try:
        conn = get_db_connection('daily_averages.db')
        conn.execute('UPDATE daily_averages SET notes = ? WHERE date = ?', (notes, date))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({
            "error": str(e),
            "message": "Check if database file exists and has correct schema"
        }), 500

@app.route('/api/detections', methods=['GET'])
def get_detections():
    try:
        conn = get_db_connection('detections.db')
        items = conn.execute(
            'SELECT id, tag_id, detected_at, color, notes FROM detections ORDER BY detected_at ASC'
        ).fetchall()
        conn.close()
        return jsonify([dict(item) for item in items])
    except Exception as e:
        return jsonify({
            "error": str(e),
            "message": "Check if database file exists and has correct schema"
        }), 500

@app.route('/api/detections/<int:detection_id>/notes', methods=['POST'])
def update_detection_notes(detection_id):
    data = request.get_json(silent=True) or {}
    notes = data.get('notes', '')
    try:
        conn = get_db_connection('detections.db')
        conn.execute('UPDATE detections SET notes = ? WHERE id = ?', (notes, detection_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({
            "error": str(e),
            "message": "Check if database file exists and has correct schema"
        }), 500

@app.route('/api/health')
def health():
    return {"status": "ok"}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)