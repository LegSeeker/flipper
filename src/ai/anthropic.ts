/**
 * Anthropic Messages API adapter, used for Claude and for DeepSeek's
 * Anthropic-compatible endpoint (which is how DeepSeek offers web search).
 * Loaded on demand so the SDK only downloads when these providers are used.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  AiError,
  isAbort,
  networkError,
  trimUrl,
  uniqueSources,
  type AiConfig,
  type AiEvent,
  type AiMessage,
  type AiSource,
  type RequestOpts,
} from './types';

const ANTHROPIC_HOST = 'api.anthropic.com';
/** Server-side tool loops can pause; resume at most this many times. */
const MAX_CONTINUATIONS = 4;

type MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Web tools with dynamic filtering need Opus/Sonnet 4.6 or later. */
function hasDynamicWebTools(model: string): boolean {
  return /^claude-(opus-(5|4-[6-9])|sonnet-(5|4-6)|fable|mythos)/.test(model);
}

/** Claude Opus 5 and Fable can hand a declined request to a fallback model server-side. */
function usesFallbacks(model: string): boolean {
  return /^claude-(opus-5|fable)/.test(model);
}

export function anthropicBase(cfg: AiConfig): string {
  const base = trimUrl(cfg.baseUrl);
  // DeepSeek serves the Anthropic protocol (with web search) under /anthropic.
  return cfg.provider === 'deepseek' ? `${base}/anthropic` : base;
}

/** Drop SDK telemetry headers for third-party endpoints so their browser CORS checks pass. */
const leanFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  for (const k of [...headers.keys()]) if (k.startsWith('x-stainless')) headers.delete(k);
  return fetch(input, { ...init, headers });
};

function makeClient(cfg: AiConfig): { client: Anthropic; official: boolean } {
  const base = anthropicBase(cfg);
  let official: boolean;
  try {
    official = new URL(base).hostname === ANTHROPIC_HOST;
  } catch {
    throw new AiError('config', 'The AI base URL is not a valid URL (Settings → AI).');
  }
  if (cfg.viaProxy && !cfg.proxyUrl)
    throw new AiError('config', 'AI is set to use the proxy, but no proxy URL is configured.');
  const client = new Anthropic({
    // Anthropic takes x-api-key; DeepSeek documents a bearer token.
    ...(official ? { apiKey: cfg.apiKey } : { apiKey: null, authToken: cfg.apiKey }),
    baseURL: cfg.viaProxy ? `${trimUrl(cfg.proxyUrl)}/ai` : base,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    defaultHeaders: cfg.viaProxy
      ? { 'X-AI-Base': base, ...(cfg.proxyToken ? { 'X-Proxy-Token': cfg.proxyToken } : {}) }
      : undefined,
    ...(official ? {} : { fetch: leanFetch }),
  });
  return { client, official };
}

function toMessages(messages: AiMessage[]): { system: string; msgs: Anthropic.MessageParam[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const msgs: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const images = m.images ?? [];
    if (!m.content.trim() && !images.length) continue;
    msgs.push({
      role: m.role,
      content: images.length
        ? [
            ...images.map((img): Anthropic.ImageBlockParam => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mime as MediaType, data: img.data },
            })),
            ...(m.content.trim() ? [{ type: 'text' as const, text: m.content }] : []),
          ]
        : m.content,
    });
  }
  return { system, msgs };
}

function webTools(cfg: AiConfig, official: boolean): Anthropic.ToolUnion[] {
  const userLocation = cfg.country
    ? { user_location: { type: 'approximate' as const, country: cfg.country, city: cfg.city || null } }
    : {};
  if (official && hasDynamicWebTools(cfg.model))
    return [
      { type: 'web_search_20260209', name: 'web_search', max_uses: 5, ...userLocation },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 },
    ];
  return [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5, ...userLocation }];
}

/** Pages the answer cites first, then everything the searches returned. */
export function sourcesFrom(content: readonly unknown[]): AiSource[] {
  const cited: AiSource[] = [];
  const found: AiSource[] = [];
  for (const raw of content) {
    const block = raw as { type?: string; content?: unknown; citations?: unknown };
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content as { url?: string; title?: string }[])
        if (r.url) found.push({ url: r.url, title: r.title ?? '' });
    } else if (block.type === 'text' && Array.isArray(block.citations)) {
      for (const c of block.citations as { url?: string; title?: string | null }[])
        if (c.url) cited.push({ url: c.url, title: c.title ?? '' });
    }
  }
  return [...cited, ...found];
}

function errorDetail(e: InstanceType<typeof Anthropic.APIError>): string {
  const body = e.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? e.message;
}

function toAiError(e: unknown, cfg: AiConfig): unknown {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIUserAbortError || isAbort(e)) return new AiError('aborted', 'Cancelled');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new AiError('auth', `The API key was rejected (${errorDetail(e)}).`);
  if (e instanceof Anthropic.RateLimitError)
    return new AiError(
      'rate',
      `Rate limited by the AI provider — wait a moment and retry (${errorDetail(e)}).`,
    );
  if (e instanceof Anthropic.APIConnectionError) return networkError(cfg);
  if (e instanceof Anthropic.APIError) {
    const detail = errorDetail(e);
    if (e.status === 402 || /credit balance|insufficient balance/i.test(detail))
      return new AiError('balance', `Your AI account has insufficient balance (${detail}).`);
    return new AiError('server', `AI request failed: HTTP ${e.status ?? '?'} (${detail})`);
  }
  return e;
}

/** The parts of a message stream this adapter reads (shared by the regular and beta streams). */
interface StreamLike extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage(): Promise<{ content: unknown[]; stop_reason: string | null }>;
}

export async function* anthropicStream(
  cfg: AiConfig,
  messages: AiMessage[],
  opts: RequestOpts,
  search: boolean,
): AsyncGenerator<AiEvent> {
  const { client, official } = makeClient(cfg);
  const { system, msgs } = toMessages(messages);
  const history = [...msgs];
  const sources: AiSource[] = [];
  try {
    for (let hop = 0; hop <= MAX_CONTINUATIONS; hop++) {
      // No temperature: current Claude models reject it and manage sampling themselves.
      const params: Anthropic.MessageStreamParams = {
        model: cfg.model,
        max_tokens: opts.maxTokens ?? (official ? 64000 : 32000),
        messages: history,
        ...(system ? { system } : {}),
        ...(search ? { tools: webTools(cfg, official) } : {}),
      };
      const s = (official && usesFallbacks(cfg.model)
        ? client.beta.messages.stream(
            {
              ...(params as Anthropic.Beta.Messages.MessageCreateParamsStreaming),
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default',
            },
            { signal: opts.signal },
          )
        : client.messages.stream(params, { signal: opts.signal })) as unknown as StreamLike;

      for await (const ev of s) {
        if (ev.type === 'content_block_start') {
          const kind = (ev.content_block as { type: string }).type;
          if (kind === 'server_tool_use') yield { type: 'status', text: 'Searching the web…' };
          // A fallback model took over mid-answer: drop the declined model's partial text.
          else if (kind === 'fallback') yield { type: 'reset' };
        } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          yield { type: 'text', text: ev.delta.text };
        }
      }
      const msg = await s.finalMessage();
      sources.push(...sourcesFrom(msg.content));
      if (msg.stop_reason === 'pause_turn') {
        // Long server-side search loop: send the turn back unchanged and the API resumes it.
        history.push({ role: 'assistant', content: msg.content as Anthropic.ContentBlockParam[] });
        continue;
      }
      if (msg.stop_reason === 'refusal') {
        yield { type: 'reset' };
        throw new AiError('refused', 'The model declined this request. Try rephrasing it.');
      }
      break;
    }
  } catch (e) {
    throw toAiError(e, cfg);
  }
  if (sources.length) yield { type: 'sources', sources: uniqueSources(sources) };
}
