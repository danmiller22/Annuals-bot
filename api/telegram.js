import { getState, saveState } from "../storage.js";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

if (!TELEGRAM_TOKEN) {
  throw new Error("Set TELEGRAM_TOKEN env var");
}

function parseAnnual(text) {
  if (!text) return null;

  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) return null;

  const dateStr = match[0];
  const before = text.slice(0, match.index).trim().split(/\s+/);
  if (!before.length) return null;

  const plate = before[before.length - 1].toUpperCase();

  const d = new Date(dateStr + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;

  return { plate, dateStr };
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

  if (typeof text === "string" && text.startsWith("/start")) {
    await sendMessage(
      chatId,
      "Бот активен.\nКидайте сообщения вида 'PLATE YYYY-MM-DD'.\n" +
        "Он хранит только самый свежий annual по каждому трейлеру и за 30 дней до даты шлёт напоминание."
    );
    return res.status(200).json({ ok: true });
  }

  const parsed = parseAnnual(text);
  if (!parsed) return res.status(200).json({ ok: true });

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
      // новый annual не свежее старого — игнор
      return res.status(200).json({ ok: true });
    }
  }

  state[chatId][plate] = dateStr;

  try {
    await saveState(state);
  } catch (e) {
    console.error("State save error", e);
  }

  // бот молчит, без ответов в чат
  return res.status(200).json({ ok: true });
}
