import os
import json
import re
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from telegram import Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

# Telegram bot token:
# - In production (Northflank, etc.) set TELEGRAM_TOKEN as env var.
# - For local testing you can either set TELEGRAM_TOKEN or replace the placeholder below.
TOKEN = os.getenv("TELEGRAM_TOKEN", "YOUR_TELEGRAM_BOT_TOKEN_HERE")
DATA_FILE = "annuals.json"
TZ = ZoneInfo("Asia/Bishkek")


def load_data() -> dict:
    if not os.path.exists(DATA_FILE):
        return {}
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return {}


def save_data(data: dict) -> None:
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def parse_annual(text: str):
    """
    Ищет в тексте дату формата YYYY-MM-DD и последнее "слово" перед датой
    считает номером полуприцепа (plate).

    Примеры:
        ABC123 annual 2026-03-10
        XYZ-789 2025-12-01
    """
    if not text:
        return None

    m = re.search(r"\d{4}-\d{2}-\d{2}", text)
    if not m:
        return None

    date_str = m.group(0)
    before = text[:m.start()].strip().split()
    if not before:
        return None

    plate = before[-1].upper()
    try:
        datetime.fromisoformat(date_str)
    except ValueError:
        return None

    return plate, date_str


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id

    # ежедневная проверка в 09:00 по Бишкеку
    context.job_queue.run_daily(
        daily_check,
        time=time(hour=9, minute=0, tzinfo=TZ),
        data=chat_id,
        name=str(chat_id),
    )

    await update.message.reply_text(
        "Бот annual inspection запущен.\n"
        "- читает сообщения в группе,\n"
        "- вытаскивает пары 'PLATE YYYY-MM-DD',\n"
        "- хранит только самый свежий annual по каждому трейлеру,\n"
        "- за 30 дней до даты шлёт предупреждение."
    )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    msg = update.effective_message
    text = msg.text or msg.caption or ""
    parsed = parse_annual(text)
    if not parsed:
        return

    plate, date_str = parsed

    data = load_data()
    new_dt = date.fromisoformat(date_str)

    old_str = data.get(plate)
    if old_str:
        try:
            old_dt = date.fromisoformat(old_str)
            # если новый аннуал старее или равен текущему – игнорируем
            if new_dt <= old_dt:
                return
        except ValueError:
            pass

    # всегда храним только самый свежий annual по трейлеру
    data[plate] = date_str
    save_data(data)
    # бот работает тихо, без ответов в чат на каждое сообщение


async def daily_check(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Каждый день: если до annual ровно 30 дней – шлём предупреждение."""
    chat_id = context.job.data
    data = load_data()
    if not data:
        return

    today = date.today()
    for plate, date_str in data.items():
        try:
            d = date.fromisoformat(date_str)
        except ValueError:
            continue

        days_left = (d - today).days
        if days_left == 30:
            text = (
                f"Через 30 дней истекает annual inspection для {plate} "
                f"({date_str})."
            )
            await context.bot.send_message(chat_id=chat_id, text=text)


def main() -> None:
    if TOKEN == "YOUR_TELEGRAM_BOT_TOKEN_HERE":
        raise RuntimeError(
            "Укажи токен бота: либо через переменную окружения TELEGRAM_TOKEN, "
            "либо впиши его в bot.py вместо YOUR_TELEGRAM_BOT_TOKEN_HERE."
        )

    app = ApplicationBuilder().token(TOKEN).build()

    # один раз в группе: /start
    app.add_handler(CommandHandler("start", start))

    # ловим все обычные сообщения и подписи к фото/докам в группах/супергруппах
    app.add_handler(
        MessageHandler(
            filters.ChatType.GROUPS & (filters.TEXT | filters.PHOTO | filters.Document.ALL),
            handle_message,
        )
    )

    app.run_polling()


if __name__ == "__main__":
    main()
