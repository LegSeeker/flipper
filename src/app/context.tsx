import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { createDefaultLocalSettings, createDefaultSettings, safeLocale } from '@/db/defaults';
import type { LocalSettings, Settings } from '@/db/schema';
import { getSettings } from '@/db/repo';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import type { AiConfig } from '@/ai/client';
import type { AiContext } from '@/ai/tasks';

interface AppState {
  settings: Settings;
  local: LocalSettings;
}

const Ctx = createContext<AppState | null>(null);

function applyTheme(theme: Settings['theme'], density: Settings['density']) {
  const root = document.documentElement;
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  root.classList.toggle('density-compact', density === 'compact');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0d12' : '#f6f7f9');
}

export function AppProvider({ children }: { children: ReactNode }) {
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const local = useLiveQuery(() => db.local.get('local'), []);

  useEffect(() => {
    // Create settings on first run.
    void getSettings();
  }, []);

  const value = useMemo<AppState | null>(() => {
    if (settings === undefined) return null;
    const merged = { ...createDefaultSettings(), ...settings };
    return {
      settings: { ...merged, locale: safeLocale(merged.locale) },
      local: { ...createDefaultLocalSettings(), ...local },
    };
  }, [settings, local]);

  useEffect(() => {
    if (!value) return;
    applyTheme(value.settings.theme, value.settings.density);
    if (value.settings.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system', value.settings.density);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [value]);

  if (!value) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div
          className="size-8 animate-spin rounded-full border-2 border-accent border-t-transparent"
          aria-label="Loading"
        />
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

export function useSettings(): Settings {
  return useApp().settings;
}

/** Formatting helpers bound to the user's locale and currency. */
export function useFormat() {
  const { locale, currency } = useSettings();
  return useMemo(
    () => ({
      money: (n: number | null | undefined, opts: { compact?: boolean; signed?: boolean } = {}) =>
        formatMoney(n, { locale, currency, ...opts }),
      pct: (n: number | null | undefined, digits = 0) => formatPercent(n, locale, digits),
      num: (n: number | null | undefined, digits = 0) => formatNumber(n, locale, digits),
      date: (d: string | number | null | undefined) => formatDate(d, locale),
      locale,
      currency,
    }),
    [locale, currency],
  );
}

export function aiConfigFrom(settings: Settings, local: LocalSettings): AiConfig {
  return {
    baseUrl: settings.ai.baseUrl,
    model: settings.ai.model,
    temperature: settings.ai.temperature,
    apiKey: local.aiApiKey,
    viaProxy: settings.ai.viaProxy,
    proxyUrl: settings.proxyUrl,
    proxyToken: local.proxyToken,
  };
}

export function useAiContext(): AiContext & { configured: boolean } {
  const { settings, local } = useApp();
  return useMemo(() => {
    const cfg = aiConfigFrom(settings, local);
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(cfg.baseUrl);
    return { cfg, settings, configured: Boolean(cfg.baseUrl && cfg.model && (cfg.apiKey || isLocal)) };
  }, [settings, local]);
}
