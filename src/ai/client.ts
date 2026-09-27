/**
 * Minimal client for OpenAI-compatible chat completion APIs (DeepSeek, OpenAI,
 * OpenRouter, Ollama, LM Studio...). Calls go straight from the browser to the
 * provider, or through the optional proxy when the provider blocks CORS.
 */

export interface AiConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  apiKey: string;
  viaProxy: boolean;
  proxyUrl: string;
  proxyToken: string;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type AiErrorKind =
  'no_key' | 'auth' | 'balance' | 'rate' | 'network' | 'server' | 'parse' | 'aborted' | 'config';

export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

interface RequestOpts {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

const trim = (s: string) => s.trim().replace(/\/+$/, '');

function isLocal(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url);
}

function buildRequest(cfg: AiConfig, body: object): { url: string; init: RequestInit } {
  if (!cfg.baseUrl) throw new AiError('config', 'Set the AI provider base URL in Settings → AI.');
  if (!cfg.apiKey && !isLocal(cfg.baseUrl))
    throw new AiError('no_key', 'Add your API key in Settings → AI to use the assistant.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (cfg.baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'Flipper';
  }
  let url = `${trim(cfg.baseUrl)}/chat/completions`;
  if (cfg.viaProxy) {
    if (!cfg.proxyUrl)
      throw new AiError('config', 'AI is set to use the proxy, but no proxy URL is configured.');
    url = `${trim(cfg.proxyUrl)}/ai/chat/completions`;
    headers['X-AI-Base'] = trim(cfg.baseUrl);
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
    if (e instanceof DOMException && e.name === 'AbortError') throw new AiError('aborted', 'Cancelled');
    throw new AiError(
      'network',
      cfg.viaProxy
        ? 'Could not reach the proxy. Check the proxy URL and your connection.'
        : 'Could not reach the AI provider. Check your connection — if it keeps failing, the provider may block browser requests (CORS); enable "Route through proxy" in Settings → AI.',
    );
  }
  if (!res.ok) throw await toError(res);
  return res;
}

export async function complete(
  cfg: AiConfig,
  messages: AiMessage[],
  opts: RequestOpts = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? cfg.temperature,
    stream: false,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.json) body.response_format = { type: 'json_object' };
  const res = await send(cfg, body, opts.signal);
  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new AiError('parse', 'The AI returned an empty response.');
  return text;
}

/** Stream a chat completion; yields text deltas as they arrive (server-sent events). */
export async function* stream(
  cfg: AiConfig,
  messages: AiMessage[],
  opts: RequestOpts = {},
): AsyncGenerator<string> {
  const body = { model: cfg.model, messages, temperature: opts.temperature ?? cfg.temperature, stream: true };
  const res = await send(cfg, body, opts.signal);
  if (!res.body) {
    const data = await res.json();
    yield data?.choices?.[0]?.message?.content ?? '';
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (delta) yield delta as string;
        } catch {
          /* keep-alive or partial line */
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new AiError('aborted', 'Cancelled');
    throw e;
  } finally {
    reader.releaseLock();
  }
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
  const reply = await complete(cfg, [{ role: 'user', content: 'Reply with the single word: OK' }], {
    maxTokens: 10,
    temperature: 0,
  });
  return reply.trim();
}
