/**
 * The optional integration proxy (see /proxy) is a tiny Cloudflare Worker the
 * user deploys themselves. It holds the eBay API credentials server-side and
 * adds CORS headers for APIs/feeds that browsers can't call directly.
 */
export interface ProxyConfig {
  proxyUrl: string;
  proxyToken: string;
}

export interface ProxyHealth {
  ok: boolean;
  ebay: boolean;
  fetch: boolean;
  ai: boolean;
}

export function hasProxy(cfg: ProxyConfig): boolean {
  return Boolean(cfg.proxyUrl.trim());
}

export async function proxyFetch(cfg: ProxyConfig, path: string, init: RequestInit = {}): Promise<Response> {
  if (!hasProxy(cfg)) throw new Error('No proxy configured. Add one in Settings → Marketplaces.');
  const url = `${cfg.proxyUrl.trim().replace(/\/+$/, '')}${path}`;
  const headers = new Headers(init.headers);
  if (cfg.proxyToken) headers.set('X-Proxy-Token', cfg.proxyToken);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new Error('Could not reach the proxy. Check the URL and that it is deployed.');
  }
  if (res.status === 401) throw new Error('The proxy rejected the access token.');
  if (!res.ok) {
    let msg = `Proxy error: HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = String(data.error);
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res;
}

export async function checkProxy(cfg: ProxyConfig): Promise<ProxyHealth> {
  const res = await proxyFetch(cfg, '/health');
  return (await res.json()) as ProxyHealth;
}
