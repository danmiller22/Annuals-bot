const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const STATE_KEY = "annuals_state_v1";

if (!REDIS_URL || !REDIS_TOKEN) {
  throw new Error(
    "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars"
  );
}

async function redis(command, ...args) {
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([command, ...args])
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Redis error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function getState() {
  const data = await redis("GET", STATE_KEY);
  if (!data.result) return {};
  try {
    return JSON.parse(data.result);
  } catch {
    return {};
  }
}

export async function saveState(state) {
  const value = JSON.stringify(state);
  await redis("SET", STATE_KEY, value);
}
