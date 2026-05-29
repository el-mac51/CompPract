from flask import Flask, request, jsonify

app = Flask(__name__)

notes = []

@app.route('/notes', methods=['GET'])
def get_notes():
    """Возвращает все сохранённые заметки"""
    return jsonify({
        "status": "success",
        "count": len(notes),
        "notes": notes
    }), 200

@app.route('/notes', methods=['POST'])
def create_note():
    if not request.is_json:
        return jsonify({"status": "error", "message": "Request must be JSON"}), 400

    data = request.get_json()

    if 'title' not in data or 'content' not in data:
        return jsonify({"status": "error", "message": "Missing required fields: 'title' and 'content'"}), 400

    new_note = {
        "id": len(notes) + 1,
        "title": data['title'],
        "content": data['content']
    }

    notes.append(new_note)

    return jsonify({
        "status": "success",
        "message": "Note created",
        "note": new_note
    }), 201

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)