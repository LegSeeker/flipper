/**
 * Flipper integration proxy — a Cloudflare Worker you deploy to your own account.
 *
 *   GET  /health               -> which features are configured
 *   GET  /ebay/search?q=&marketplace=EBAY_GB&limit=25&used=1
 *   GET  /fetch?url=<feed url> -> raw body of an allow-listed feed/page
 *   POST /ai/<path>            -> forwards to <X-AI-Base>/<path> (OpenAI, Anthropic and Gemini APIs)
 *
 * Environment (set with `wrangler secret put NAME` or in the dashboard):
 *   PROXY_TOKEN          shared secret; the app sends it as X-Proxy-Token (strongly recommended)
 *   ALLOWED_ORIGINS      comma list of app origins, e.g. https://you.github.io (default "*")
 *   EBAY_CLIENT_ID       eBay developer App ID (production keyset)
 *   EBAY_CLIENT_SECRET   eBay developer Cert ID
 *   ALLOWED_FETCH_HOSTS  comma list of hosts /fetch may read, e.g. example-market.com,feeds.example.org
 *   ALLOWED_AI_HOSTS     comma list (default: DeepSeek, Anthropic, Gemini, OpenAI, OpenRouter)
 */

const DEFAULT_AI_HOSTS =
  'api.deepseek.com,api.anthropic.com,generativelanguage.googleapis.com,api.openai.com,openrouter.ai';
/** Request headers passed on to the AI provider (auth and API versioning only). */
const AI_HEADERS = ['authorization', 'x-api-key', 'anthropic-version', 'anthropic-beta', 'x-goog-api-key'];

const MAX_FETCH_BYTES = 2 * 1024 * 1024;
let ebayToken = null; // { token, expiresAt } cached per isolate

function list(value, fallback = '') {
  return (value || fallback)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function hostAllowed(host, allowed) {
  const h = host.toLowerCase();
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

async function getEbayToken(env) {
  if (ebayToken && ebayToken.expiresAt > Date.now() + 60_000) return ebayToken.token;
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`)}`,
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });
  if (!res.ok)
    throw new Error(`eBay auth failed (HTTP ${res.status}) — check EBAY_CLIENT_ID / EBAY_CLIENT_SECRET`);
  const data = await res.json();
  ebayToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return ebayToken.token;
}

async function ebaySearch(url, env, cors) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET)
    return json({ error: 'eBay is not configured on the proxy' }, 501, cors);
  const q = (url.searchParams.get('q') || '').slice(0, 300);
  if (!q) return json({ error: 'Missing q' }, 400, cors);
  const marketplace = /^EBAY_[A-Z]{2}$/.test(url.searchParams.get('marketplace') || '')
    ? url.searchParams.get('marketplace')
    : 'EBAY_US';
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 25));
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (url.searchParams.get('used') === '1') params.set('filter', 'conditions:{USED}');
  const token = await getEbayToken(env);
  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': marketplace },
  });
  if (!res.ok) return json({ error: `eBay search failed (HTTP ${res.status})` }, 502, cors);
  const data = await res.json();
  const items = (data.itemSummaries || []).map((s) => ({
    itemId: s.itemId,
    title: s.title,
    price: Number(s.price?.value),
    currency: s.price?.currency || '',
    url: s.itemWebUrl,
    condition: s.condition || '',
    image: s.image?.imageUrl || '',
  }));
  return json({ items, total: data.total || items.length }, 200, cors);
}

async function proxyGet(url, env, cors) {
  const target = url.searchParams.get('url');
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: 'Invalid url' }, 400, cors);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    return json({ error: 'Unsupported protocol' }, 400, cors);
  if (!hostAllowed(parsed.hostname, list(env.ALLOWED_FETCH_HOSTS))) {
    return json({ error: `Host ${parsed.hostname} is not in ALLOWED_FETCH_HOSTS` }, 403, cors);
  }
  const res = await fetch(parsed.toString(), {
    headers: { 'User-Agent': 'FlipperProxy/1.0', Accept: '*/*' },
  });
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_FETCH_BYTES) return json({ error: 'Response too large' }, 413, cors);
  return new Response(body, {
    status: res.status,
    headers: { ...cors, 'Content-Type': res.headers.get('Content-Type') || 'text/plain' },
  });
}

async function proxyAi(request, url, env, cors) {
  const base = request.headers.get('X-AI-Base') || '';
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    return json({ error: 'Missing or invalid X-AI-Base header' }, 400, cors);
  }
  if (
    parsed.protocol !== 'https:' ||
    !hostAllowed(parsed.hostname, list(env.ALLOWED_AI_HOSTS, DEFAULT_AI_HOSTS))
  ) {
    return json({ error: `AI host ${parsed.hostname} is not allowed` }, 403, cors);
  }
  const path = url.pathname.slice('/ai'.length);
  if (!path.startsWith('/') || path.includes('..')) return json({ error: 'Invalid path' }, 400, cors);
  const headers = { 'Content-Type': 'application/json' };
  for (const name of AI_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  const upstream = await fetch(`${base.replace(/\/+$/, '')}${path}${url.search}`, {
    method: 'POST',
    headers,
    body: request.body,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = list(env.ALLOWED_ORIGINS, '*');
    const originOk = allowedOrigins.includes('*') || allowedOrigins.includes(origin.toLowerCase());
    const cors = {
      'Access-Control-Allow-Origin': allowedOrigins.includes('*') ? '*' : origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      // Echo the requested headers: AI SDKs add their own (x-api-key, anthropic-version, x-stainless-*…).
      'Access-Control-Allow-Headers':
        request.headers.get('Access-Control-Request-Headers') ||
        'Content-Type, Authorization, X-Proxy-Token, X-AI-Base',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (!originOk) return json({ error: 'Origin not allowed' }, 403, {});
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (env.PROXY_TOKEN && request.headers.get('X-Proxy-Token') !== env.PROXY_TOKEN) {
      return json({ error: 'Unauthorized' }, 401, cors);
    }
    try {
      switch (url.pathname) {
        case '/health':
          return json(
            {
              ok: true,
              ebay: Boolean(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET),
              fetch: list(env.ALLOWED_FETCH_HOSTS).length > 0,
              ai: true,
            },
            200,
            cors,
          );
        case '/ebay/search':
          return await ebaySearch(url, env, cors);
        case '/fetch':
          return await proxyGet(url, env, cors);
      }
      if (url.pathname.startsWith('/ai/') && request.method === 'POST') {
        return await proxyAi(request, url, env, cors);
      }
      return json({ error: 'Not found' }, 404, cors);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'Proxy error' }, 502, cors);
    }
  },
};
