/**
 * AI client. Speaks three protocols and hides the differences from the rest of
 * the app:
 *  - OpenAI chat completions (DeepSeek, OpenAI, OpenRouter, Ollama, LM Studio…) — here;
 *  - Anthropic Messages (Claude, and DeepSeek when web search is on) — ./anthropic;
 *  - Gemini generateContent — ./gemini.
 * Calls go straight from the browser to the provider, or through the optional proxy.
 */
import { AI_PROVIDER_PRESETS } from '@/db/defaults';
import { sseData } from './sse';
import {
  AiError,
  hostOf,
  isAbort,
  isLocalUrl,
  networkError,
  trimUrl,
  type AiConfig,
  type AiEvent,
  type AiMessage,
  type AiReply,
  type AiSource,
  type RequestOpts,
} from './types';

export * from './types';

type Protocol = 'openai' | 'anthropic' | 'gemini';

// ---------------------------------------------------------------- Capabilities

/** Provider has built-in web search the app can switch on. */
export function canSearch(cfg: Pick<AiConfig, 'provider' | 'baseUrl'>): boolean {
  if (!AI_PROVIDER_PRESETS[cfg.provider]?.webSearch) return false;
  // DeepSeek search goes through its own Anthropic-compatible endpoint.
  if (cfg.provider === 'deepseek') return hostOf(cfg.baseUrl) === 'api.deepseek.com';
  return true;
}

/** Model accepts photos. Unknown models are assumed to (the user can turn photos off). */
export function canSeeImages(cfg: Pick<AiConfig, 'provider' | 'model'>): boolean {
  const known = AI_PROVIDER_PRESETS[cfg.provider]?.models.find((m) => m.id === cfg.model);
  if (known) return known.vision;
  if (cfg.provider === 'deepseek') return cfg.model.includes('flash');
  return true;
}

export function photosEnabled(cfg: AiConfig): boolean {
  return cfg.sendPhotos && canSeeImages(cfg);
}

export function searchEnabled(cfg: AiConfig, override?: boolean): boolean {
  return (override ?? cfg.webSearch) && canSearch(cfg);
}

function protocolFor(cfg: AiConfig, search: boolean): Protocol {
  if (cfg.provider === 'deepseek' && search) return 'anthropic';
  return AI_PROVIDER_PRESETS[cfg.provider]?.protocol ?? 'openai';
}

function ensureConfigured(cfg: AiConfig): void {
  if (!cfg.baseUrl) throw new AiError('config', 'Set the AI provider base URL in Settings → AI.');
  if (!cfg.apiKey && !isLocalUrl(cfg.baseUrl))
    throw new AiError('no_key', 'Add your API key in Settings → AI to use the assistant.');
}

// ---------------------------------------------------------------- OpenAI-compatible protocol

function toOpenAi(m: AiMessage): object {
  if (!m.images?.length) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [
      { type: 'text', text: m.content },
      ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } })),
    ],
  };
}

function buildRequest(cfg: AiConfig, body: object): { url: string; init: RequestInit } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (cfg.baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'Flipper';
  }
  let url = `${trimUrl(cfg.baseUrl)}/chat/completions`;
  if (cfg.viaProxy) {
    if (!cfg.proxyUrl)
      throw new AiError('config', 'AI is set to use the proxy, but no proxy URL is configured.');
    url = `${trimUrl(cfg.proxyUrl)}/ai/chat/completions`;
    headers['X-AI-Base'] = trimUrl(cfg.baseUrl);
    if (cfg.proxyToken) headers['X-Proxy-Token'] = cfg.proxyToken;
  }
  return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

async function toError(res: Response): Promise<AiError> {
  let detail = '';
  try {
    const data = await res.json();
    detail = data?.error?.message ?? data?.message ?? '';
  } catch {
    /* body not JSON */
  }
  const suffix = detail ? ` (${detail})` : '';
  switch (res.status) {
    case 401:
    case 403:
      return new AiError('auth', `The API key was rejected${suffix}.`);
    case 402:
      return new AiError('balance', `Your AI account has insufficient balance${suffix}.`);
    case 429:
      return new AiError('rate', `Rate limited by the AI provider — wait a moment and retry${suffix}.`);
    default:
      return new AiError('server', `AI request failed: HTTP ${res.status}${suffix}`);
  }
}

async function send(cfg: AiConfig, body: object, signal?: AbortSignal): Promise<Response> {
  const { url, init } = buildRequest(cfg, body);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (e) {
    if (isAbort(e)) throw new AiError('aborted', 'Cancelled');
    throw networkError(cfg);
  }
  if (!res.ok) throw await toError(res);
  return res;
}

function openAiBody(cfg: AiConfig, messages: AiMessage[], opts: RequestOpts, streaming: boolean) {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: messages.map(toOpenAi),
    temperature: opts.temperature ?? cfg.temperature,
    stream: streaming,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.json && !streaming) body.response_format = { type: 'json_object' };
  return body;
}

async function openAiComplete(cfg: AiConfig, messages: AiMessage[], opts: RequestOpts): Promise<string> {
  const res = await send(cfg, openAiBody(cfg, messages, opts, false), opts.signal);
  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new AiError('parse', 'The AI returned an empty response.');
  return text;
}

async function* openAiStream(
  cfg: AiConfig,
  messages: AiMessage[],
  opts: RequestOpts,
): AsyncGenerator<AiEvent> {
  const res = await send(cfg, openAiBody(cfg, messages, opts, true), opts.signal);
  if (!res.body) {
    const data = await res.json();
    yield { type: 'text', text: data?.choices?.[0]?.message?.content ?? '' };
    return;
  }
  for await (const payload of sseData(res.body)) {
    if (payload === '[DONE]') return;
    try {
      const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
      if (delta) yield { type: 'text', text: delta as string };
    } catch {
      /* keep-alive or partial line */
    }
  }
}

// ---------------------------------------------------------------- Dispatch

async function* runProtocol(
  cfg: AiConfig,
  messages: AiMessage[],
  opts: RequestOpts,
  search: boolean,
): AsyncGenerator<AiEvent> {
  switch (protocolFor(cfg, search)) {
    case 'anthropic': {
      const { anthropicStream } = await import('./anthropic');
      yield* anthropicStream(cfg, messages, opts, search);
      return;
    }
    case 'gemini': {
      const { geminiStream } = await import('./gemini');
      yield* geminiStream(cfg, messages, opts, search);
      return;
    }
    default:
      yield* openAiStream(cfg, messages, opts);
  }
}

/**
 * Drop photos the model can't use, and any assistant turns before the first
 * user turn (a trimmed history can start mid-conversation; Claude and Gemini
 * expect the conversation to open with the user).
 */
function prepare(cfg: AiConfig, messages: AiMessage[]): AiMessage[] {
  const firstUser = messages.findIndex((m) => m.role === 'user');
  const trimmed = messages.filter((m, i) => m.role !== 'assistant' || (firstUser !== -1 && i > firstUser));
  return photosEnabled(cfg) ? trimmed : trimmed.map(({ images: _images, ...m }) => m);
}

/**
 * Stream a reply as events (text deltas, search progress, sources). If web
 * search is on but the search request fails before any text arrives (e.g. the
 * endpoint blocks browsers), the question is retried without search.
 */
export async function* stream(
  cfg: AiConfig,
  messages: AiMessage[],
  opts: RequestOpts = {},
): AsyncGenerator<AiEvent> {
  ensureConfigured(cfg);
  const msgs = prepare(cfg, messages);
  if (searchEnabled(cfg, opts.search)) {
    yield { type: 'search', enabled: true };
    let gotText = false;
    try {
      for await (const ev of runProtocol(cfg, msgs, opts, true)) {
        if (ev.type === 'text') gotText = true;
        yield ev;
      }
      return;
    } catch (e) {
      if (gotText || !(e instanceof AiError) || !['network', 'server'].includes(e.kind)) throw e;
      console.warn('Web search request failed, retrying without search:', e.message);
      yield { type: 'status', text: 'Web search failed — answering without it.' };
    }
  }
  yield { type: 'search', enabled: false };
  yield* runProtocol(cfg, msgs, opts, false);
}

/** Collect a streamed reply. */
export async function collect(events: AsyncIterable<AiEvent>): Promise<AiReply> {
  let text = '';
  let sources: AiSource[] = [];
  let searched = false;
  for await (const ev of events) {
    if (ev.type === 'text') text += ev.text;
    else if (ev.type === 'reset') text = '';
    else if (ev.type === 'sources') sources = ev.sources;
    else if (ev.type === 'search') searched = ev.enabled;
  }
  if (!text.trim()) throw new AiError('parse', 'The AI returned an empty response.');
  return { text, sources, searched };
}

export async function complete(
  cfg: AiConfig,
  messages: AiMessage[],
  opts: RequestOpts = {},
): Promise<AiReply> {
  ensureConfigured(cfg);
  const search = searchEnabled(cfg, opts.search);
  if (!search && protocolFor(cfg, false) === 'openai') {
    const text = await openAiComplete(cfg, prepare(cfg, messages), opts);
    return { text, sources: [], searched: false };
  }
  return collect(stream(cfg, messages, opts));
}

/** Pull a JSON object out of a model reply, tolerating code fences and chatter. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start)
    throw new AiError('parse', 'The AI did not return structured data. Try again.');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiError('parse', 'The AI returned malformed data. Try again.');
  }
}

export async function testConnection(cfg: AiConfig): Promise<string> {
  const openai = protocolFor(cfg, false) === 'openai';
  const reply = await complete(cfg, [{ role: 'user', content: 'Reply with the single word: OK' }], {
    search: false,
    temperature: 0,
    // Thinking models spend tokens before answering, so only cap simple chat APIs.
    maxTokens: openai ? 10 : undefined,
  });
  return reply.text.trim();
}

/** Ask a question that needs live data, to check web search end to end. */
export async function testWebSearch(cfg: AiConfig, currency: string): Promise<AiReply> {
  return complete(
    cfg,
    [
      {
        role: 'user',
        content: `Search the web for today's spot price of silver per gram in ${currency}. Reply in one short sentence with the price and where you found it.`,
      },
    ],
    { search: true },
  );
}
