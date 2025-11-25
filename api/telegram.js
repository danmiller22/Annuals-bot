import { getState, saveState } from "../storage.js";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

if (!TELEGRAM_TOKEN) {
  throw new Error("Set TELEGRAM_TOKEN env var");
}

// парсим из текста старый формат: PLATE YYYY-MM-DD (на всякий случай оставим)
function parseFromText(text) {
  if (!text) return null;

  const m = text.match(/\d{4}-\d{2}-\d{2}/);
  if (!m) return null;

  const dateStr = m[0];
  const before = text.slice(0, m.index).trim().split(/\s+/);
  if (!before.length) return null;

  const plate = before[before.length - 1].toUpperCase();

  const d = new Date(dateStr + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;

  return { plate, dateStr };
}

// парсим из имени файла формат MMYYPLATE, например: 1225H03058.pdf
// 12 -> месяц, 25 -> год (2000+25 = 2025), H03058 -> номер
// датой считаем ПОСЛЕДНИЙ день месяца
function parseFromFileName(fileName) {
  if (!fileName) return null;

  const base = fileName.replace(/\.[^/.]+$/, "").trim(); // без .pdf
  const m = base.match(/^(\d{2})(\d{2})(.+)$/);
  if (!m) return null;

  const mm = parseInt(m[1], 10);
  const yy = parseInt(m[2], 10);
  if (!(mm >= 1 && mm <= 12)) return null;

  const year = 2000 + yy; // 25 -> 2025
  const plate = m[3].toUpperCase();

  // последний день месяца: берём 1-е число след. месяца и откатываемся на 1 день
  const lastDayDate = new Date(Date.UTC(year, mm, 0));
  const lastDay = lastDayDate.getUTCDate();
  const iso = `${year}-${String(mm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  return { plate, dateStr: iso };
}

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const update = req.body || {};
  const message = update.message || update.edited_message;
  if (!message) return res.status(200).json({ ok: true });

  const chatId = message.chat.id;
  const text = message.text || message.caption || "";

  // /start просто даёт инфу, без записи
  if (typeof text === "string" && text.startsWith("/start")) {
    await sendMessage(
      chatId,
      "Бот активен.\n" +
        "Формат для PDF: имя файла = MMYYНОМЕР_ТРЕЙЛЕРА, например 1225H03058.pdf\n" +
        "12 = месяц, 25 = год (2025), H03058 = номер.\n" +
        "Бот считает датой последний день указанного месяца и за 30 дней до неё шлёт напоминание."
    );
    return res.status(200).json({ ok: true });
  }

  let parsed = null;

  // 1) пробуем старый текстовый формат (PLATE YYYY-MM-DD)
  parsed = parseFromText(text);

  // 2) если не нашли, а есть документ — парсим имя файла
  if (!parsed && message.document) {
    parsed = parseFromFileName(message.document.file_name || "");
  }

  if (!parsed) {
    return res.status(200).json({ ok: true });
  }

  const { plate, dateStr } = parsed;

  let state;
  try {
    state = await getState();
  } catch (e) {
    console.error("State load error", e);
    return res.status(200).json({ ok: true });
  }

  if (!state[chatId]) state[chatId] = {};
  const existing = state[chatId][plate];

  const newDate = new Date(dateStr + "T00:00:00Z");
  if (existing) {
    const oldDate = new Date(existing + "T00:00:00Z");
    if (!Number.isNaN(oldDate.getTime()) && newDate <= oldDate) {
      // новый аннуал не свежее — игнор
      return res.status(200).json({ ok: true });
    }
  }

  state[chatId][plate] = dateStr;

  try {
    await saveState(state);
  } catch (e) {
    console.error("State save error", e);
  }

  // работает тихо, без ответов
  return res.status(200).json({ ok: true });
}
