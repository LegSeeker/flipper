import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Sparkles } from 'lucide-react';
import { useAiContext } from '@/app/context';
import { AiError } from '@/ai/client';
import { errorMessage } from '@/lib/utils';

export function AiNotConfigured({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/8 p-3 text-sm">
      <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
      <div>
        <p className="font-medium">Connect an AI provider</p>
        {!compact && (
          <p className="mt-0.5 text-muted">
            Add a DeepSeek (or other OpenAI-compatible) API key to enable research, pricing, listings and
            repair plans.
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

/** Stream text from an AsyncGenerator into state. */
export function useAiStream() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const start = useCallback(
    async (make: (signal: AbortSignal) => AsyncGenerator<string>): Promise<string> => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setText('');
      setError('');
      setLoading(true);
      let acc = '';
      try {
        for await (const chunk of make(c.signal)) {
          acc += chunk;
          setText(acc);
        }
      } catch (e) {
        if (!(e instanceof AiError && e.kind === 'aborted')) setError(errorMessage(e));
      } finally {
        if (ctrl.current === c) setLoading(false);
      }
      return acc;
    },
    [],
  );

  const stop = useCallback(() => {
    ctrl.current?.abort();
    setLoading(false);
  }, []);

  return { text, setText, loading, error, start, stop };
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
