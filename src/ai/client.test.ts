import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError, complete, stream, type AiConfig } from './client';
import { estimatePrice, suggestPartOut } from './tasks';
import { makeItem } from '@/test/factories';

const cfg: AiConfig = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  temperature: 0.4,
  apiKey: 'sk-test',
  viaProxy: false,
  proxyUrl: '',
  proxyToken: '',
};

const ctx = {
  cfg,
  settings: { currency: 'EUR', country: 'LV', city: 'Riga', locale: 'en-GB', ebayMarketplaceId: 'EBAY_DE' },
};

function reply(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

describe('AI client', () => {
  it('posts an OpenAI-compatible request with the key and JSON mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    await complete(cfg, [{ role: 'user', content: 'hi' }], { json: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
      stream: false,
    });
  });

  it('routes through the proxy when enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await complete(
      { ...cfg, viaProxy: true, proxyUrl: 'https://p.example.workers.dev/', proxyToken: 't0k' },
      [{ role: 'user', content: 'x' }],
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://p.example.workers.dev/ai/chat/completions');
    expect(init.headers['X-AI-Base']).toBe('https://api.deepseek.com');
    expect(init.headers['X-Proxy-Token']).toBe('t0k');
  });

  it('maps provider errors to friendly messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":{"message":"bad key"}}', { status: 401 })),
    );
    await expect(complete(cfg, [])).rejects.toMatchObject({ kind: 'auth' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 402 })));
    await expect(complete(cfg, [])).rejects.toMatchObject({ kind: 'balance' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(complete(cfg, [])).rejects.toMatchObject({ kind: 'network' });
  });

  it('refuses to call a remote provider without a key', async () => {
    await expect(complete({ ...cfg, apiKey: '' }, [])).rejects.toBeInstanceOf(AiError);
  });

  it('parses a server-sent event stream', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      ': keep-alive\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of sse) c.enqueue(new TextEncoder().encode(chunk));
        c.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    let text = '';
    for await (const d of stream(cfg, [{ role: 'user', content: 'x' }])) text += d;
    expect(text).toBe('Hello');
  });
});

describe('AI tasks validate model output', () => {
  it('accepts loosely typed price answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          reply(
            '```json\n{"suggestedPrice":"120","quickSalePrice":95,"low":"90","high":150,"confidence":"High","demand":"medium","reasoning":"ok"}\n```',
          ),
        ),
    );
    const r = await estimatePrice(ctx, makeItem({ name: 'Camera' }), []);
    expect(r).toMatchObject({
      suggestedPrice: 120,
      quickSalePrice: 95,
      low: 90,
      high: 150,
      confidence: 'high',
      bestPlatforms: [],
    });
  });

  it('rejects answers missing required fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('{"parts": []}')));
    await expect(suggestPartOut(ctx, { name: 'Car', description: '' }, [])).rejects.toThrow(
      /missing required/,
    );
  });
});
