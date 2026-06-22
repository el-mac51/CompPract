import re
import csv
import time
import json
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://atlas.herzen.spb.ru"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
}
DELAY = 0.5         
MAX_WORKERS = 5      # 5 параллельных потоков
TIMEOUT = 30

OUTPUT_DIR = Path(__file__).parent
CSV_PATH = OUTPUT_DIR / "pythonsoup.csv"
LINKS_PATH = OUTPUT_DIR / "teachers_links.json"

def fetch(url: str) -> str | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        return resp.text
    except Exception as exc:
        print(f" {exc}")
        return None


def parse_list_page(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    teachers = []
    for a in soup.find_all("a", class_="text-blue-600", href=re.compile(r"/teachers/\d+")):
        href = a.get("href")
        name = a.get_text(strip=True)
        if href and name and len(name) > 3:
            teachers.append({"name": name, "link": href})
    seen = set()
    unique = []
    for t in teachers:
        if t["link"] not in seen:
            seen.add(t["link"])
            unique.append(t)
    return unique


def parse_profile(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    h2 = soup.find("h2")
    name = h2.get_text(strip=True) if h2 else "Не указано"

    email = "Не указано"
    phone = "Не указано"
    for div in soup.find_all("div", class_="text-blue-400"):
        h1 = div.find("h1", class_="text-m")
        if not h1:
            continue
        text = h1.get_text(strip=True)
        if "@" in text:
            email = text
        elif text.startswith(("+", "8", "7")):
            phone = text
    return {"name": name, "email": email, "phone": phone}


def process_teacher(teacher: dict) -> dict:
    time.sleep(DELAY)
    html = fetch(teacher["link"])
    if html:
        d = parse_profile(html)
        d["link"] = teacher["link"]
        return d
    return {
        "name": teacher["name"],
        "email": "Не указано",
        "phone": "Не указано",
        "link": teacher["link"],
    }

def load_or_collect_links() -> list[dict]:
    if LINKS_PATH.exists():
        print("Загрузка ссылок...")
        with open(LINKS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)

    all_t = []
    for page in range(1, 55):
        print(f"Страница {page}/54...")
        html = fetch(f"{BASE_URL}/teachers?page={page}")
        if html:
            t = parse_list_page(html)
            all_t.extend(t)
            print(f"   Найдено: {len(t)}")
        time.sleep(DELAY)

    with open(LINKS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_t, f, ensure_ascii=False, indent=2)
    print(f"Сохранено {len(all_t)}")
    return all_t


def main():
    print("=" * 50)
    print("Скрапинг РГПУ — Python (ускоренный, 5 потоков)")
    print("=" * 50)

    all_teachers = load_or_collect_links()

    # Уже обработанные
    processed = set()
    if CSV_PATH.exists():
        with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f, delimiter=";")
            next(reader, None)
            for row in reader:
                if len(row) >= 4:
                    processed.add(row[3].strip())

    to_process = [t for t in all_teachers if t["link"] not in processed]
    print(f"Осталось: {len(to_process)}")
    if not to_process:
        print("Все уже обработаны!")
        return

    results = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(process_teacher, t): t for t in to_process}
        for i, future in enumerate(as_completed(futures), 1):
            try:
                r = future.result()
                results.append(r)
                print(f"[{i}/{len(to_process)}] {r['name']}")
            except Exception as e:
                print(f"[{i}/{len(to_process)}] {e}")

    with open(CSV_PATH, "a", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        if not processed:
            w.writerow(["name", "email", "phone", "link"])
        for r in results:
            w.writerow([r["name"], r["email"], r["phone"], r["link"]])

    print(f"\nДобавлено {len(results)} записей. Файл: {CSV_PATH.resolve()}")


if __name__ == "__main__":
    main()
