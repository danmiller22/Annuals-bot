import { getState } from "../storage.js";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

if (!TELEGRAM_TOKEN) {
  throw new Error("Set TELEGRAM_TOKEN env var");
}

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

function diffDays(dateStr) {
  const today = new Date();
  const todayUtcMidnight = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );

  const target = new Date(dateStr + "T00:00:00Z").getTime();
  return Math.round((target - todayUtcMidnight) / 86400000);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(200).send("OK");
  }

  let state;
  try {
    state = await getState();
  } catch (e) {
    console.error("State load error", e);
    return res.status(200).json({ ok: true });
  }

  const tasks = [];

  for (const [chatId, trailers] of Object.entries(state || {})) {
    for (const [plate, dateStr] of Object.entries(trailers || {})) {
      const days = diffDays(dateStr);
      if (days === 30) {
        const text = `Через 30 дней истекает annual inspection для ${plate} (${dateStr}).`;
        tasks.push(sendMessage(chatId, text));
      }
    }
  }

  await Promise.allSettled(tasks);

  return res
    .status(200)
    .json({ ok: true, notificationsSent: tasks.length });
}
