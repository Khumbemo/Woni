# Woni AI Proxy Worker

A Cloudflare Worker that forwards the app's AI requests to Groq using your Groq API key, so new users can try AI analysis before adding their own key.

Because the key is yours, the Worker only forwards what the app needs:

| Protection | Default | Where |
|---|---|---|
| Model fixed to `llama-3.3-70b-versatile` | always on | `index.js` |
| Response capped at 2,048 tokens, prompt at 60,000 characters, 20 messages | always on | `index.js` |
| Only the app's origins may call it | Firebase Hosting, Capacitor, `localhost:5173` | `ALLOWED_ORIGINS` var |
| Burst limit per IP | 10 requests / minute | `[[ratelimits]]` in `wrangler.toml` |
| Daily quota per IP | 30 requests / day | `USAGE` KV namespace + `DAILY_LIMIT` var |

The origin check stops other websites from using the proxy from a browser, but a script can fake the `Origin` header. The per-IP limits are what cap the cost.

## Deploy

```bash
npm install -g wrangler
wrangler login
cd worker

wrangler secret put GROQ_API_KEY          # paste your Groq key

# Optional but recommended: daily quota
wrangler kv namespace create USAGE        # copy the id into wrangler.toml and uncomment [[kv_namespaces]]

wrangler deploy
```

If you deploy the app on another domain, set `ALLOWED_ORIGINS` in `wrangler.toml` (comma-separated).

The app calls the proxy from `getProxyUrl()` in `src/ai.js`. Update that URL if your Worker's address changes.

## Test

```bash
npm run test:unit     # includes worker/index.test.js
```
