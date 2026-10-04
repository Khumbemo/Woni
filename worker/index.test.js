import { describe, it, expect, vi, afterEach } from 'vitest';
import worker, { sanitizeBody, MODEL, MAX_TOKENS, MAX_PROMPT_CHARS } from './index.js';

const ORIGIN = 'https://woni-f6a2a.web.app';
const req = (body, { origin = ORIGIN, method = 'POST', path = '/chat', ip = '1.2.3.4' } = {}) =>
  new Request(`https://proxy.example${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), 'CF-Connecting-IP': ip },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
const okBody = { messages: [{ role: 'user', content: 'hi' }] };

function kv() {
  const m = new Map();
  return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } };
}

afterEach(() => vi.unstubAllGlobals());

describe('sanitizeBody', () => {
  it('forces the model and caps max_tokens', () => {
    const { body } = sanitizeBody({ ...okBody, model: 'some-expensive-model', max_tokens: 100000 });
    expect(body.model).toBe(MODEL);
    expect(body.max_tokens).toBe(MAX_TOKENS);
  });
  it('drops unknown fields and keeps json mode', () => {
    const { body } = sanitizeBody({ ...okBody, response_format: { type: 'json_object' }, tools: [{}], n: 5 });
    expect(body).toEqual({ model: MODEL, messages: okBody.messages, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' } });
  });
  it('rejects oversized and malformed prompts', () => {
    expect(sanitizeBody({ messages: [{ role: 'user', content: 'x'.repeat(MAX_PROMPT_CHARS + 1) }] }).error).toBeTruthy();
    expect(sanitizeBody({ messages: [{ role: 'tool', content: 'x' }] }).error).toBeTruthy();
    expect(sanitizeBody({ messages: [] }).error).toBeTruthy();
  });
});

describe('worker fetch', () => {
  it('rejects requests from other origins', async () => {
    const res = await worker.fetch(req(okBody, { origin: 'https://evil.example' }), {});
    expect(res.status).toBe(403);
  });

  it('forwards a sanitized body to Groq with the secret key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await worker.fetch(req({ ...okBody, model: 'other' }), { GROQ_API_KEY: 'k' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body).model).toBe(MODEL);
  });

  it('returns 429 when the burst limiter says no', async () => {
    const env = { RATE_LIMITER: { limit: async () => ({ success: false }) } };
    expect((await worker.fetch(req(okBody), env)).status).toBe(429);
  });

  it('enforces the daily quota per IP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const env = { USAGE: kv(), DAILY_LIMIT: '2', GROQ_API_KEY: 'k' };
    expect((await worker.fetch(req(okBody), env)).status).toBe(200);
    expect((await worker.fetch(req(okBody), env)).status).toBe(200);
    expect((await worker.fetch(req(okBody), env)).status).toBe(429);
    expect((await worker.fetch(req(okBody, { ip: '5.6.7.8' }), env)).status).toBe(200);
  });
});
