/** Types shared by the AI client and its provider adapters. */
import type { AiProvider } from '@/db/schema';

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  temperature: number;
  apiKey: string;
  viaProxy: boolean;
  proxyUrl: string;
  proxyToken: string;
  /** Let the model search the web when the provider supports it. */
  webSearch: boolean;
  /** Send photos to the model when it can see images. */
  sendPhotos: boolean;
  /** Rough user location, used to localise web searches. */
  country?: string;
  city?: string;
}

/** A base64-encoded image (no data: prefix). */
export interface AiImage {
  mime: string;
  data: string;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: AiImage[];
}

export interface AiSource {
  url: string;
  title: string;
}

/** What a streamed reply emits besides text. */
export type AiEvent =
  | { type: 'text'; text: string }
  /** Short progress note, e.g. "Searching the web…". */
  | { type: 'status'; text: string }
  /** Web pages the answer drew on. */
  | { type: 'sources'; sources: AiSource[] }
  /** Whether web search is switched on for this reply. */
  | { type: 'search'; enabled: boolean }
  /** Throw away the text so far (another model took over the answer). */
  | { type: 'reset' };

export interface AiReply {
  text: string;
  sources: AiSource[];
  /** Web search was switched on for this reply (the model may still have chosen not to search). */
  searched: boolean;
}

export interface RequestOpts {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Override the configured web-search setting for this request. */
  search?: boolean;
}

export type AiErrorKind =
  'no_key' | 'auth' | 'balance' | 'rate' | 'network' | 'server' | 'parse' | 'aborted' | 'config' | 'refused';

export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export const trimUrl = (s: string) => s.trim().replace(/\/+$/, '');

export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url);
}

export function networkError(cfg: Pick<AiConfig, 'viaProxy'>): AiError {
  return new AiError(
    'network',
    cfg.viaProxy
      ? 'Could not reach the proxy. Check the proxy URL and your connection.'
      : 'Could not reach the AI provider. Check your connection — if it keeps failing, the provider may block browser requests (CORS); enable "Route through proxy" in Settings → AI.',
  );
}

export function isAbort(e: unknown): boolean {
  return (e instanceof DOMException || e instanceof Error) && e.name === 'AbortError';
}

/** Merge sources, dropping duplicates and non-http links. */
export function uniqueSources(list: AiSource[], max = 20): AiSource[] {
  const seen = new Set<string>();
  const out: AiSource[] = [];
  for (const s of list) {
    if (!/^https?:\/\//.test(s.url) || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ url: s.url, title: s.title?.trim() || hostOf(s.url) });
    if (out.length >= max) break;
  }
  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
