import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiError,
  canSearch,
  canSeeImages,
  collect,
  complete,
  stream,
  type AiConfig,
  type AiEvent,
} from './client';
import { geminiBody } from './gemini';
import { estimatePrice, suggestPartOut } from './tasks';
import { makeItem } from '@/test/factories';
import { migrateSettings } from '@/db/defaults';

const cfg: AiConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  temperature: 0.4,
  apiKey: 'sk-test',
  viaProxy: false,
  proxyUrl: '',
  proxyToken: '',
  webSearch: false,
  sendPhotos: true,
  country: 'GB',
  city: 'Douglas',
};

const claude: AiConfig = {
  ...cfg,
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-opus-5',
  apiKey: 'sk-ant-test',
};

const gemini: AiConfig = {
  ...cfg,
  provider: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-3.8-flash',
  apiKey: 'AIza-test',
};

const photo = { mime: 'image/jpeg', data: 'AAAA' };

/** A streamed HTTP response made of server-sent events. */
function sse(events: (object | string)[], named = false): Response {
  const text = events
    .map((e) => {
      const data = typeof e === 'string' ? e : JSON.stringify(e);
      const type = typeof e === 'object' && 'type' in e && named ? `event: ${String(e.type)}\n` : '';
      return `${type}data: ${data}\n\n`;
    })
    .join('');
  return new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function events(gen: AsyncIterable<AiEvent>): Promise<AiEvent[]> {
  const out: AiEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const textOf = (list: AiEvent[]) =>
  list.map((e) => (e.type === 'text' ? e.text : e.type === 'reset' ? '\u0000' : '')).join('');

/** Anthropic stream: one web search, then a cited answer. */
function claudeSearchStream(model = 'claude-opus-5', answer = 'Silver is £0.80/g (live).'): Response {
  return sse(
    [
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query":"silver price per gram"}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_1',
          content: [
            {
              type: 'web_search_result',
              url: 'https://example.com/silver',
              title: 'Silver price today',
              encrypted_content: 'x',
              page_age: null,
            },
            {
              type: 'web_search_result',
              url: 'https://other.example.org/metals',
              title: 'Metals',
              encrypted_content: 'y',
              page_age: null,
            },
          ],
        },
      },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: answer.slice(0, 10) } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: answer.slice(10) } },
      {
        type: 'content_block_delta',
        index: 2,
        delta: {
          type: 'citations_delta',
          citation: {
            type: 'web_search_result_location',
            url: 'https://other.example.org/metals',
            title: 'Metals',
            encrypted_index: 'z',
            cited_text: 'silver',
          },
        },
      },
      { type: 'content_block_stop', index: 2 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 20 },
      },
      { type: 'message_stop' },
    ],
    true,
  );
}

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
      model: 'deepseek-flash',
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
    const list = await events(stream(cfg, [{ role: 'user', content: 'x' }]));
    expect(textOf(list)).toBe('Hello');
    expect(list).toContainEqual({ type: 'search', enabled: false });
  });

  it('sends photos as image parts when the model can see them', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(reply('ok')));
    const sent = (i: number) => JSON.parse(String(fetchMock.mock.calls[i][1].body));
    vi.stubGlobal('fetch', fetchMock);
    await complete(cfg, [{ role: 'user', content: 'What is this?', images: [photo] }]);
    expect(sent(0).messages[0].content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ]);

    // Text-only model: photos are dropped rather than causing an API error.
    await complete({ ...cfg, model: 'deepseek-v4-pro' }, [{ role: 'user', content: 'x', images: [photo] }]);
    expect(sent(1).messages[0].content).toBe('x');
    // Photos switched off in settings.
    await complete({ ...cfg, sendPhotos: false }, [{ role: 'user', content: 'x', images: [photo] }]);
    expect(sent(2).messages[0].content).toBe('x');
  });

  it('starts the conversation at the first user turn', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(reply('ok')));
    vi.stubGlobal('fetch', fetchMock);
    await complete(cfg, [
      { role: 'system', content: 's' },
      { role: 'assistant', content: 'left over from a trimmed history' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const roles = JSON.parse(String(fetchMock.mock.calls[0][1].body)).messages.map(
      (m: { role: string }) => m.role,
    );
    expect(roles).toEqual(['system', 'user', 'assistant']);
  });

  it('knows which providers can search and see photos', () => {
    expect(canSearch(cfg)).toBe(true);
    expect(canSearch({ ...cfg, baseUrl: 'http://localhost:1234' })).toBe(false);
    expect(canSearch(claude)).toBe(true);
    expect(canSearch(gemini)).toBe(true);
    expect(canSearch({ ...cfg, provider: 'openai' })).toBe(false);
    expect(canSeeImages(cfg)).toBe(true);
    expect(canSeeImages({ ...cfg, model: 'deepseek-v4-pro' })).toBe(false);
    expect(canSeeImages(claude)).toBe(true);
  });
});

describe('Claude (Anthropic Messages API)', () => {
  it('streams text, reports searches and collects cited sources', async () => {
    const fetchMock = vi.fn().mockResolvedValue(claudeSearchStream());
    vi.stubGlobal('fetch', fetchMock);
    const list = await events(
      stream({ ...claude, webSearch: true }, [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Silver price?', images: [photo] },
      ]),
    );
    expect(textOf(list)).toBe('Silver is £0.80/g (live).');
    expect(list).toContainEqual({ type: 'status', text: 'Searching the web…' });
    const sources = list.find((e) => e.type === 'sources');
    // Cited page first, then the other search results.
    expect(sources).toEqual({
      type: 'sources',
      sources: [
        { url: 'https://other.example.org/metals', title: 'Metals' },
        { url: 'https://example.com/silver', title: 'Silver price today' },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    const headers = new Headers(init.headers);
    expect(headers.get('x-api-key')).toBe('sk-ant-test');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'claude-opus-5', system: 'Be brief.', fallbacks: 'default' });
    expect(body.temperature).toBeUndefined();
    expect(body.tools[0]).toMatchObject({
      type: 'web_search_20260209',
      name: 'web_search',
      user_location: { type: 'approximate', country: 'GB', city: 'Douglas' },
    });
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
    });
  });

  it('collects a whole reply for JSON tasks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(claudeSearchStream()));
    const r = await collect(stream({ ...claude, webSearch: true }, [{ role: 'user', content: 'x' }]));
    expect(r).toMatchObject({ text: 'Silver is £0.80/g (live).', searched: true });
    expect(r.sources).toHaveLength(2);
  });

  it('maps a rejected key to an auth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
    );
    await expect(complete(claude, [{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      kind: 'auth',
    });
  });
});

describe('DeepSeek web search', () => {
  it("uses DeepSeek's Anthropic-compatible endpoint with a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(claudeSearchStream('deepseek-flash'));
    vi.stubGlobal('fetch', fetchMock);
    const r = await complete({ ...cfg, webSearch: true }, [{ role: 'user', content: 'x' }]);
    expect(r.sources).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.deepseek.com/anthropic/v1/messages');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-test');
    expect([...headers.keys()].some((k) => k.startsWith('x-stainless'))).toBe(false);
    const body = JSON.parse(init.body);
    expect(body.tools[0]).toMatchObject({ type: 'web_search_20250305', name: 'web_search' });
    expect(body.fallbacks).toBeUndefined();
  });

  it('falls back to a normal answer when the search endpoint is unreachable', async () => {
    const fetchMock = vi.fn((url: string | URL) =>
      String(url).includes('/anthropic/')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(sse([{ choices: [{ delta: { content: 'Estimate: £50' } }] }, '[DONE]'])),
    );
    vi.stubGlobal('fetch', fetchMock);
    const list = await events(stream({ ...cfg, webSearch: true }, [{ role: 'user', content: 'x' }]));
    expect(textOf(list)).toBe('Estimate: £50');
    expect(list).toContainEqual({ type: 'status', text: 'Web search failed — answering without it.' });
    expect(list.filter((e) => e.type === 'search').at(-1)).toEqual({ type: 'search', enabled: false });
  });
});

describe('Gemini', () => {
  it('uses Google Search grounding and reports queries and sources', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sse([
        { candidates: [{ content: { parts: [{ text: 'Thinking', thought: true }, { text: 'About ' }] } }] },
        {
          candidates: [
            {
              content: { parts: [{ text: '£40 (live).' }] },
              groundingMetadata: {
                webSearchQueries: ['canon 50mm sold uk'],
                groundingChunks: [
                  { web: { uri: 'https://vertexaisearch.example/r/1', title: 'ebay.co.uk' } },
                ],
              },
            },
          ],
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const list = await events(stream({ ...gemini, webSearch: true }, [{ role: 'user', content: 'x' }]));
    expect(textOf(list)).toBe('About £40 (live).');
    expect(list).toContainEqual({ type: 'status', text: 'Searched: “canon 50mm sold uk”' });
    expect(list).toContainEqual({
      type: 'sources',
      sources: [{ url: 'https://vertexaisearch.example/r/1', title: 'ebay.co.uk' }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
    );
    expect(init.headers['x-goog-api-key']).toBe('AIza-test');
    expect(JSON.parse(init.body).tools).toEqual([{ google_search: {} }]);
  });

  it('merges consecutive turns from the same side', () => {
    const body = geminiBody(
      [
        { role: 'system', content: 's' },
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second', images: [photo] },
        { role: 'assistant', content: 'reply' },
      ],
      {},
      false,
    ) as { contents: { role: string; parts: object[] }[]; systemInstruction: object };
    expect(body.systemInstruction).toEqual({ parts: [{ text: 's' }] });
    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'first' },
          { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } },
          { text: 'second' },
        ],
      },
      { role: 'model', parts: [{ text: 'reply' }] },
    ]);
  });

  it('maps an invalid key to an auth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":{"message":"API key not valid."}}', { status: 400 })),
    );
    await expect(complete(gemini, [{ role: 'user', content: 'x' }])).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('settings migration', () => {
  it('moves off retired DeepSeek names and adds new AI options', () => {
    const s = migrateSettings({
      ai: {
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        temperature: 0.4,
        viaProxy: false,
      } as never,
    });
    expect(s.ai).toMatchObject({ model: 'deepseek-flash', webSearch: true, sendPhotos: true });
    expect(migrateSettings({}).ai.model).toBe('deepseek-flash');
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
      // No web search and no comparables: always labelled an estimate.
      basis: 'estimate',
      webComps: [],
    });
  });

  it('keeps web listings only when the model really searched', async () => {
    const answer = JSON.stringify({
      suggestedPrice: 60,
      basis: 'live',
      comps: [
        { title: 'Canon 50mm sold', price: '55', sold: 'true', url: 'https://www.ebay.co.uk/itm/1' },
        { title: 'No link', price: 40, sold: false, url: '' },
      ],
    });
    // Without search the model's "live" claim and listings are not trusted.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(answer)));
    const offline = await estimatePrice(ctx, makeItem({ name: 'Lens' }), []);
    expect(offline).toMatchObject({ basis: 'estimate', webComps: [] });

    // With Claude searching, they are kept (links only).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(claudeSearchStream('claude-opus-5', answer)));
    const live = await estimatePrice(
      { ...ctx, cfg: { ...claude, webSearch: true } },
      makeItem({ name: 'Lens' }),
      [],
    );
    expect(live.basis).toBe('live');
    expect(live.webComps).toEqual([
      { title: 'Canon 50mm sold', price: 55, sold: true, url: 'https://www.ebay.co.uk/itm/1', source: '' },
    ]);
    expect(live.sources).toHaveLength(2);
  });

  it('rejects answers missing required fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('{"parts": []}')));
    await expect(suggestPartOut(ctx, { name: 'Car', description: '' }, [])).rejects.toThrow(
      /missing required/,
    );
  });
});
