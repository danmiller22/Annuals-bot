import os
import json
import re
from datetime import date, datetime
from typing import Iterable, Tuple

from upstash_redis import Redis
import urllib.request
import urllib.error

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN")
if not TELEGRAM_TOKEN:
    raise RuntimeError("TELEGRAM_TOKEN env var is required")

redis = Redis.from_env()


def parse_annual(text: str):
    """
    Ищем дату YYYY-MM-DD и последнее слово перед ней как plate.
    Возвращаем (plate, date_str) или None.
    """
    if not text:
        return None

    m = re.search(r"\d{4}-\d{2}-\d{2}", text)
    if not m:
        return None

    date_str = m.group(0)
    before = text[: m.start()].strip().split()
    if not before:
        return None

    plate = before[-1].upper()

    try:
        datetime.fromisoformat(date_str)
    except ValueError:
        return None

    return plate, date_str


def save_annual(plate: str, date_str: str, chat_id: int) -> None:
    """
    Храним только самый свежий annual по номеру.
    key:  annual:PLATE
    value: {"chat_id": int, "date": "YYYY-MM-DD"}
    """
    key = f"annual:{plate.upper()}"
    new_date = date.fromisoformat(date_str)

    old_raw = redis.get(key)
    if isinstance(old_raw, bytes):
        old_raw = old_raw.decode("utf-8")

    if old_raw:
        try:
            obj = json.loads(old_raw)
            old_date = date.fromisoformat(obj.get("date", ""))
            if new_date <= old_date:
                return
        except Exception:
            # битые данные просто перезаписываем
            pass

    value = json.dumps({"chat_id": chat_id, "date": date_str})
    redis.set(key, value)


def iter_annuals() -> Iterable[Tuple[str, str, int]]:
    """
    Итерируем все annual’ы: (plate, date_str, chat_id)
    """
    cursor = 0
    while True:
        cursor, keys = redis.scan(cursor, match="annual:*")
        for key in keys:
            plate = key.split("annual:", 1)[-1]
            raw = redis.get(key)
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            if not raw:
                continue

            try:
                obj = json.loads(raw)
                date_str = obj["date"]
                chat_id = int(obj["chat_id"])
            except Exception:
                continue

            yield plate, date_str, chat_id

        if cursor == 0:
            break


def send_telegram(chat_id: int, text: str) -> None:
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": text}).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except urllib.error.URLError:
        # в логах Vercel будет видно, здесь просто глушим
        pass
