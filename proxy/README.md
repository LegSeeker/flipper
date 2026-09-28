# Flipper integration proxy

An optional Cloudflare Worker that gives the app:

| Endpoint           | What it does                                                                         |
| ------------------ | ------------------------------------------------------------------------------------ |
| `GET /health`      | Reports which features are configured.                                               |
| `GET /ebay/search` | Searches **active** eBay listings (Browse API) with your keys, kept on the server.   |
| `GET /fetch?url=`  | Fetches an RSS/Atom/JSON feed from hosts you allow, adding CORS headers.             |
| `POST /ai/<path>`  | Forwards AI requests to an allowed provider, for providers that block browser calls. |

Every request must carry your `PROXY_TOKEN` (the app sends it automatically), and only your app's origin(s) are accepted if you set `ALLOWED_ORIGINS`.

## Deploy (about 5 minutes, free tier)

```bash
cd proxy
npx wrangler login                        # opens Cloudflare in the browser
npx wrangler deploy                       # prints https://flipper-proxy.<you>.workers.dev
npx wrangler secret put PROXY_TOKEN       # paste a long random string
```

Then in the app: **Settings → Marketplaces → Integration proxy**, paste the worker URL and the same token, and press **Test proxy**.

Edit `wrangler.toml` before deploying to lock things down:

- `ALLOWED_ORIGINS` — your app's origin, e.g. `https://you.github.io` (default `*`).
- `ALLOWED_FETCH_HOSTS` — hosts `/fetch` may read, comma separated (default: none).
- `ALLOWED_AI_HOSTS` — AI providers `/ai` may forward to (default: DeepSeek, Anthropic, Gemini, OpenAI, OpenRouter). The app sends the provider's base URL in `X-AI-Base`; only auth and API-version headers are passed on.

## eBay keys (for live listing prices)

1. Sign up at [developer.ebay.com](https://developer.ebay.com/) and create an application.
2. Create a **Production** keyset. Copy the **App ID (Client ID)** and **Cert ID (Client Secret)**.
3. Store them on the worker:

   ```bash
   npx wrangler secret put EBAY_CLIENT_ID
   npx wrangler secret put EBAY_CLIENT_SECRET
   ```

The worker uses the OAuth client-credentials flow and caches the token. The Browse API returns active listings only; eBay restricts sold-price data to approved partners, so the app keeps a "sold listings" research link for that.

## Custom feeds

If a marketplace offers a search feed (RSS/Atom or JSON), add it in the app as a custom marketplace **Feed URL** with `{query}`, and add its host to `ALLOWED_FETCH_HOSTS`. Only fetch sites whose terms allow automated access.
