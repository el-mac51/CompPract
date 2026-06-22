import re
import csv
import json
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://atlas.herzen.spb.ru"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
}
DELAY = 0.5
MAX_WORKERS = 5
TIMEOUT = 30

OUTPUT_DIR = Path(__file__).parent
CSV_PATH = OUTPUT_DIR / "pythonsoup.csv"
LINKS_PATH = OUTPUT_DIR / "teachers_links.json"

session = requests.Session()
session.headers.update(HEADERS)

def fetch(url: str) -> str | None:
    time.sleep(DELAY)  
    try:
        return session.get(url, timeout=TIMEOUT).text
    except Exception as exc:
        print(f" {exc}")
        return None

def parse_list_page(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    # Словарь сам обеспечит уникальность по ключу (ссылке) и сохранит порядок
    teachers = {}
    for a in soup.find_all("a", class_="text-blue-600", href=re.compile(r"/teachers/\d+")):
        href, name = a.get("href"), a.get_text(strip=True)
        if href and name and len(name) > 3:
            teachers[href] = {"name": name, "link": href}
    return list(teachers.values())

def parse_profile(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    h2 = soup.find("h2")
    res = {"name": h2.get_text(strip=True) if h2 else "Не указано", "email": "Не указано", "phone": "Не указано"}
    
    for h1 in soup.select("div.text-blue-400 h1.text-m"):
        t = h1.get_text(strip=True)
        if "@" in t: res["email"] = t
        elif t.startswith(("+", "8", "7")): res["phone"] = t
    return res

def process_teacher(teacher: dict) -> dict:
    html = fetch(teacher["link"])
    if html:
        return {**parse_profile(html), "link": teacher["link"]}
    return {**teacher, "email": "Не указано", "phone": "Не указано"}

def load_or_collect_links() -> list[dict]:
    if LINKS_PATH.exists():
        print("Загрузка ссылок...")
        return json.loads(LINKS_PATH.read_text(encoding="utf-8"))

    all_t = []
    for page in range(1, 55):
        print(f"Страница {page}/54...")
        html = fetch(f"{BASE_URL}/teachers?page={page}")
        if html:
            t = parse_list_page(html)
            all_t.extend(t)
            print(f"   Найдено: {len(t)}")

    LINKS_PATH.write_text(json.dumps(all_t, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Сохранено {len(all_t)}")
    return all_t

def main():
    print("=" * 50 + "\nСкрапинг РГПУ — Python (ускоренный, 5 потоков)\n" + "=" * 50)
    all_teachers = load_or_collect_links()

    processed = set()
    if CSV_PATH.exists():
        with CSV_PATH.open("r", encoding="utf-8-sig") as f:
            reader = csv.reader(f, delimiter=";")
            next(reader, None)  # Пропускаем заголовок
            processed = {row[3].strip() for row in reader if len(row) >= 4}

    to_process = [t for t in all_teachers if t["link"] not in processed]
    print(f"Осталось: {len(to_process)}")
    if not to_process:
        return print("Все уже обработаны!")

    results = []
    with ThreadPoolExecutor(MAX_WORKERS) as ex:
        futures = {ex.submit(process_teacher, t): t for t in to_process}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                r = fut.result()
                results.append(r)
                print(f"[{i}/{len(to_process)}] {r['name']}")
            except Exception as e:
                print(f"[{i}/{len(to_process)}] {e}")

    with CSV_PATH.open("a", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        if not processed: w.writerow(["name", "email", "phone", "link"])
        w.writerows([r["name"], r["email"], r["phone"], r["link"]] for r in results)

    print(f"\nДобавлено {len(results)} записей. Файл: {CSV_PATH.resolve()}")

if __name__ == "__main__":
    main()
