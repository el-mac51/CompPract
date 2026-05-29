## Веб-приложение с поддержкой GET и POST запросов
---
## Инструментарий

Язык: `Python 3.12.9`
Фреймворк: `Flask` (версия 3.1.0)  
Доп. инструменты: cURL  / браузер brave

Внутри терминала `MSYS2` установим `flask`:

```bash
pacman -S mingw-w64-x86_64-python-flask
```

## Полный исходный код приложения

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

notes = []

@app.route('/notes', methods=['GET'])
def get_notes():
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

    # Валидация обязательных полей
    if 'title' not in data or 'content' not in data:
        return jsonify({"status": "error", "message": "Missing required fields: 'title' and 'content'"}), 400

      # Формируем объект заметки
    new_note = {
        "id": len(notes) + 1,
        "title": data['title'],
        "content": data['content']
    }
  
    # Сохраняем
    notes.append(new_note)

    return jsonify({
        "status": "success",
        "message": "Note created",
        "note": new_note
    }), 201
  
if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
```

## Демонстрация работы через терминал

![](кп51.png)
Запуск сервера в терминале

![](кп2.png)
Выполнение Post и Get запросов

![](кп3.png)
Результат выполнения в браузере
