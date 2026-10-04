/**
 * Woni AI Proxy Worker for Cloudflare Workers
 *
 * Holds the master Groq API key so users can try the app (freemium tier)
 * without their own key. Because the key is ours, the worker only forwards
 * requests the app actually makes:
 *   - fixed model, capped response length, bounded prompt size
 *   - requests only from the app's own origins
 *   - per-IP burst limit (Rate Limiting binding) and daily quota (KV)
 * Both limit bindings are optional; see wrangler.toml and README.md.
 */

export const MODEL = 'llama-3.3-70b-versatile';
export const MAX_TOKENS = 2048;
export const MAX_PROMPT_CHARS = 60000;
export const MAX_MESSAGES = 20;
const DEFAULT_DAILY_LIMIT = 30;

const DEFAULT_ORIGINS = [
  'https://woni-f6a2a.web.app',
  'https://woni-f6a2a.firebaseapp.com',
  'https://localhost',          // Capacitor Android
  'capacitor://localhost',      // Capacitor iOS
  'http://localhost:5173',      // Vite dev server
];

function allowedOrigins(env) {
  return env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_ORIGINS;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(origin ? corsHeaders(origin) : {}) },
  });
}

/**
 * Build the upstream request from only the fields we allow.
 * Returns { body } or { error }.
 */
export function sanitizeBody(input) {
  if (!input || typeof input !== 'object') return { error: 'Body must be a JSON object.' };
  const { messages } = input;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return { error: `messages must be an array of 1-${MAX_MESSAGES} items.` };
  }
  let chars = 0;
  const clean = [];
  for (const m of messages) {
    if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') {
      return { error: 'Each message needs a role (system/user/assistant) and string content.' };
    }
    chars += m.content.length;
    clean.push({ role: m.role, content: m.content });
  }
  if (chars > MAX_PROMPT_CHARS) return { error: `Prompt too long (max ${MAX_PROMPT_CHARS} characters).` };

  const body = { model: MODEL, messages: clean, max_tokens: MAX_TOKENS };
  const requested = Number(input.max_tokens);
  if (Number.isFinite(requested) && requested > 0) body.max_tokens = Math.min(Math.floor(requested), MAX_TOKENS);
  const temperature = Number(input.temperature);
  if (Number.isFinite(temperature)) body.temperature = Math.min(Math.max(temperature, 0), 1.5);
  if (input.response_format?.type === 'json_object') body.response_format = { type: 'json_object' };
  return { body };
}

/** Per-IP daily quota in KV. Returns true when the request may proceed. */
async function withinDailyQuota(env, ip) {
  if (!env.USAGE) return true;
  const limit = Number(env.DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  const key = `${ip}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number(await env.USAGE.get(key)) || 0;
  if (used >= limit) return false;
  // KV is eventually consistent, so this is a soft cap; the burst limiter is the hard one.
  await env.USAGE.put(key, String(used + 1), { expirationTtl: 60 * 60 * 26 });
  return true;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const originOk = allowedOrigins(env).includes(origin);

    if (request.method === 'OPTIONS') {
      return originOk
        ? new Response(null, { headers: corsHeaders(origin) })
        : new Response(null, { status: 403 });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (new URL(request.url).pathname !== '/chat') return new Response('Not found', { status: 404 });
    if (!originOk) return json({ error: 'Origin not allowed.' }, 403);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429, origin);
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return json({ error: 'Body must be valid JSON.' }, 400, origin);
    }
    const { body, error } = sanitizeBody(input);
    if (error) return json({ error }, 400, origin);

    if (!(await withinDailyQuota(env, ip))) {
      return json({ error: 'Daily free limit reached. Add your own Groq API key in Settings.' }, 429, origin);
    }

    try {
      const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await groqResponse.json();
      return json(data, groqResponse.status, origin);
    } catch (e) {
      return json({ error: 'Upstream AI service unavailable.' }, 502, origin);
    }
  },
};
