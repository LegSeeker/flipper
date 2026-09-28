/**
 * Google Gemini adapter (generateContent REST API). Web search uses Gemini's
 * built-in "Grounding with Google Search" tool.
 */
import { sseData } from './sse';
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

interface GeminiChunk {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
    };
  }[];
  promptFeedback?: { blockReason?: string };
}

const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);

export function geminiBody(messages: AiMessage[], opts: RequestOpts, search: boolean): object {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  // Gemini wants user and model turns to alternate, so merge consecutive turns from the same side.
  const contents: { role: string; parts: object[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts = [
      ...(m.images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } })),
      ...(m.content.trim() ? [{ text: m.content }] : []),
    ];
    if (!parts.length) continue;
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  }
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: {
      ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
      // JSON mode can't be combined with tools on every model; prompts ask for JSON anyway.
      ...(opts.json && !search ? { responseMimeType: 'application/json' } : {}),
    },
    ...(search ? { tools: [{ google_search: {} }] } : {}),
  };
}

async function toError(res: Response): Promise<AiError> {
  let detail = '';
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    detail = data?.error?.message ?? '';
  } catch {
    /* body not JSON */
  }
  const suffix = detail ? ` (${detail})` : '';
  if (res.status === 401 || res.status === 403 || /api key/i.test(detail))
    return new AiError('auth', `The API key was rejected${suffix}.`);
  if (res.status === 429)
    return new AiError('rate', `Rate limited by Gemini — free-tier limits are low; wait and retry${suffix}.`);
  return new AiError('server', `AI request failed: HTTP ${res.status}${suffix}`);
}

export async function* geminiStream(
  cfg: AiConfig,
  messages: AiMessage[],
  opts: RequestOpts,
  search: boolean,
): AsyncGenerator<AiEvent> {
  const base = trimUrl(cfg.baseUrl);
  const path = `/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-goog-api-key': cfg.apiKey,
  };
  let url = `${base}${path}`;
  if (cfg.viaProxy) {
    if (!cfg.proxyUrl)
      throw new AiError('config', 'AI is set to use the proxy, but no proxy URL is configured.');
    url = `${trimUrl(cfg.proxyUrl)}/ai${path}`;
    headers['X-AI-Base'] = base;
    if (cfg.proxyToken) headers['X-Proxy-Token'] = cfg.proxyToken;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(geminiBody(messages, opts, search)),
      signal: opts.signal,
    });
  } catch (e) {
    if (isAbort(e)) throw new AiError('aborted', 'Cancelled');
    throw networkError(cfg);
  }
  if (!res.ok) throw await toError(res);
  if (!res.body) throw new AiError('parse', 'The AI returned an empty response.');

  const sources: AiSource[] = [];
  const queries = new Set<string>();
  for await (const data of sseData(res.body)) {
    let chunk: GeminiChunk;
    try {
      chunk = JSON.parse(data) as GeminiChunk;
    } catch {
      continue;
    }
    if (chunk.promptFeedback?.blockReason) {
      throw new AiError('refused', `Gemini blocked this request (${chunk.promptFeedback.blockReason}).`);
    }
    const cand = chunk.candidates?.[0];
    for (const part of cand?.content?.parts ?? [])
      if (part.text && !part.thought) yield { type: 'text', text: part.text };
    const grounding = cand?.groundingMetadata;
    if (grounding) {
      const fresh = (grounding.webSearchQueries ?? []).filter((q) => !queries.has(q));
      if (fresh.length) {
        fresh.forEach((q) => queries.add(q));
        yield { type: 'status', text: `Searched: ${fresh.map((q) => `“${q}”`).join(', ')}` };
      }
      for (const c of grounding.groundingChunks ?? [])
        if (c.web?.uri) sources.push({ url: c.web.uri, title: c.web.title ?? '' });
    }
    if (cand?.finishReason && BLOCKED.has(cand.finishReason)) {
      yield { type: 'reset' };
      throw new AiError('refused', `Gemini stopped the answer (${cand.finishReason}). Try rephrasing.`);
    }
  }
  if (sources.length) yield { type: 'sources', sources: uniqueSources(sources) };
}
