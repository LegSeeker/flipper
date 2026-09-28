import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Globe, Sparkles } from 'lucide-react';
import { useAiContext } from '@/app/context';
import { AiError, hostOf, type AiEvent, type AiSource } from '@/ai/client';
import { Badge } from '@/components/ui/badge';
import { cn, errorMessage } from '@/lib/utils';

export function AiNotConfigured({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/8 p-3 text-sm">
      <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
      <div>
        <p className="font-medium">Connect an AI provider</p>
        {!compact && (
          <p className="mt-0.5 text-muted">
            Add a DeepSeek, Claude, Gemini (or other OpenAI-compatible) API key to enable research, pricing,
            listings and repair plans.
          </p>
        )}
        <Link to="/settings#ai" className="mt-1 inline-block font-medium text-accent">
          Open AI settings →
        </Link>
      </div>
    </div>
  );
}

export function AiGate({ children }: { children: ReactNode }) {
  const ai = useAiContext();
  return ai.configured ? <>{children}</> : <AiNotConfigured />;
}

/** Run an async AI job with loading/error state and cancellation. */
export function useAiJob<T>() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<T | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async (job: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setError('');
    try {
      const r = await job(c.signal);
      if (!c.signal.aborted) setResult(r);
      return r;
    } catch (e) {
      if (!(e instanceof AiError && e.kind === 'aborted')) setError(errorMessage(e));
      return null;
    } finally {
      if (ctrl.current === c) setLoading(false);
    }
  }, []);

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    setLoading(false);
  }, []);

  return { loading, error, result, setResult, run, cancel };
}

export interface StreamResult {
  text: string;
  sources: AiSource[];
  searched: boolean;
}

/** Stream an AI reply (text, search progress, sources) into state. */
export function useAiStream() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [sources, setSources] = useState<AiSource[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const start = useCallback(
    async (make: (signal: AbortSignal) => AsyncGenerator<AiEvent>): Promise<StreamResult> => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setText('');
      setStatus('');
      setSources([]);
      setSearched(false);
      setError('');
      setLoading(true);
      const out: StreamResult = { text: '', sources: [], searched: false };
      try {
        for await (const ev of make(c.signal)) {
          switch (ev.type) {
            case 'text':
              out.text += ev.text;
              setText(out.text);
              setStatus('');
              break;
            case 'reset':
              out.text = '';
              setText('');
              break;
            case 'status':
              setStatus(ev.text);
              break;
            case 'sources':
              out.sources = ev.sources;
              setSources(ev.sources);
              break;
            case 'search':
              out.searched = ev.enabled;
              setSearched(ev.enabled);
              break;
          }
        }
      } catch (e) {
        if (!(e instanceof AiError && e.kind === 'aborted')) setError(errorMessage(e));
      } finally {
        if (ctrl.current === c) {
          setLoading(false);
          setStatus('');
        }
      }
      return out;
    },
    [],
  );

  const stop = useCallback(() => {
    ctrl.current?.abort();
    setLoading(false);
    setStatus('');
  }, []);

  const reset = useCallback(() => {
    setText('');
    setSources([]);
    setSearched(false);
  }, []);

  return { text, setText, status, sources, searched, loading, error, start, stop, reset };
}

/** Three dots that pulse in turn while the AI is working, with an optional progress note. */
export function TypingDots({ label, className }: { label?: string; className?: string }) {
  return (
    <span
      role="status"
      aria-label={label || 'Thinking'}
      className={cn('inline-flex items-center gap-2 text-subtle', className)}
    >
      <span className="inline-flex items-center gap-1" aria-hidden>
        <span className="typing-dot size-2 rounded-full bg-current" />
        <span className="typing-dot size-2 rounded-full bg-current" />
        <span className="typing-dot size-2 rounded-full bg-current" />
      </span>
      {label && <span className="text-xs">{label}</span>}
    </span>
  );
}

/**
 * Says whether an answer used live data or is the model's own estimate. Pass
 * `basis` for price checks, where the user's own comparables also count as live.
 */
export function DataBasis({
  searched,
  sources,
  basis,
  className,
}: {
  searched: boolean;
  sources: readonly AiSource[];
  basis?: 'live' | 'estimate';
  className?: string;
}) {
  const n = sources.length;
  const web = `Live web data · ${n} source${n > 1 ? 's' : ''}`;
  const [live, label] =
    basis === 'estimate'
      ? [false, searched ? 'Searched, no reliable prices found — estimate' : 'No web access — estimate']
      : basis === 'live'
        ? [true, n ? web : 'Based on your comparables']
        : n
          ? [true, web]
          : [
              false,
              searched
                ? 'Web search on, not used — prices are estimates'
                : 'No web access — prices are estimates',
            ];
  return (
    <Badge tone={live ? 'profit' : 'warn'} className={cn('gap-1', className)}>
      <Globe className="size-3" />
      {label}
    </Badge>
  );
}

export function SourceList({ sources, className }: { sources: readonly AiSource[]; className?: string }) {
  const [all, setAll] = useState(false);
  if (!sources.length) return null;
  const shown = all ? sources : sources.slice(0, 5);
  return (
    <div className={cn('space-y-1 text-xs', className)}>
      <div className="font-medium text-muted">Sources</div>
      <ol className="space-y-0.5">
        {shown.map((s, i) => (
          <li key={s.url} className="flex min-w-0 gap-1.5">
            <span className="tabular text-subtle">{i + 1}.</span>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              className="min-w-0 truncate text-accent hover:underline"
              title={s.url}
            >
              {s.title && s.title !== hostOf(s.url) ? s.title : hostOf(s.url)}
            </a>
            {s.title && s.title !== hostOf(s.url) && (
              <span className="shrink-0 text-subtle">{hostOf(s.url)}</span>
            )}
          </li>
        ))}
      </ol>
      {sources.length > 5 && (
        <button type="button" className="text-subtle hover:text-fg" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${sources.length}`}
        </button>
      )}
    </div>
  );
}

export function AiErrorText({ message }: { message: string }) {
  if (!message) return null;
  return <p className="rounded-xl bg-loss/10 px-3 py-2 text-sm text-loss">{message}</p>;
}

export function AiDisclaimer() {
  return (
    <p className="text-xs text-subtle">
      AI output can be wrong or outdated — sanity-check prices against sold listings before relying on them.
    </p>
  );
}
