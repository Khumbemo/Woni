# Woni AI Proxy Worker

This folder contains a lightweight Cloudflare Worker script that securely proxies requests to the Groq API. By deploying this, you allow new users to try the AI analysis feature up to 5 times (Freemium Tier) without requiring them to input their own API key immediately.

## How to Deploy

1. **Install Wrangler (Cloudflare's CLI):**
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare:**
   ```bash
   wrangler login
   ```

3. **Deploy the Worker:**
   ```bash
   wrangler deploy index.js --name woni-ai-proxy
   ```
   *Note the URL it gives you (e.g., `https://woni-ai-proxy.YOUR_USERNAME.workers.dev`).*

4. **Add your Master Groq API Key as a Secret:**
   ```bash
   wrangler secret put GROQ_API_KEY
   ```
   Paste your real Groq API key when prompted. Cloudflare securely stores this and it is never exposed to the frontend.

5. **Update the Frontend:**
   Go to `src/app.js` and update the `getProxyUrl()` method to return the new URL you got in Step 3.

```javascript
  getProxyUrl() {
    return 'https://woni-ai-proxy.YOUR_USERNAME.workers.dev/chat';
  }
```

That's it! Users will now automatically use the proxy for their first 5 analyses.
