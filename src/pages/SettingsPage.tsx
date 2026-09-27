import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { useLocation } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle2, Cloud, Download, Eye, EyeOff, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { db, requestPersistentStorage } from '@/db/db';
import {
  AI_PROVIDER_PRESETS,
  COMMON_CURRENCIES,
  currencyForCountry,
  DEFAULT_PLATFORMS,
  defaultMarketplaces,
  EBAY_SITES,
  ebayForCountry,
} from '@/db/defaults';
import {
  deleteItems,
  deleteProject,
  eraseAllData,
  formatCode,
  updateLocalSettings,
  updateSettings,
} from '@/db/repo';
import { loadDemoData } from '@/db/demo';
import type { AiProvider, MarketplaceLink, PlatformFee, Settings } from '@/db/schema';
import { useApp, aiConfigFrom } from '@/app/context';
import { testConnection } from '@/ai/client';
import { checkProxy } from '@/integrations/proxy';
import { createBackup, importBackup } from '@/sync/backup';
import { disconnectGoogle, hasValidToken, syncWithDrive } from '@/sync/drive';
import { relativeTime, today } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { cn, downloadBlob, errorMessage, uid } from '@/lib/utils';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/card';
import { Checkbox, Field, Input, NumberInput, Select, Switch, TagInput } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { Badge } from '@/components/ui/badge';
import { Modal, useConfirm } from '@/components/ui/dialog';

const COUNTRIES = [
  'US',
  'GB',
  'IE',
  'CA',
  'AU',
  'NZ',
  'DE',
  'FR',
  'IT',
  'ES',
  'NL',
  'BE',
  'AT',
  'CH',
  'PL',
  'CZ',
  'SK',
  'HU',
  'RO',
  'BG',
  'SE',
  'NO',
  'DK',
  'FI',
  'EE',
  'LV',
  'LT',
  'PT',
  'GR',
  'HR',
  'SI',
  'LU',
  'MT',
  'CY',
  'UA',
  'TR',
  'JP',
  'IN',
  'ZA',
  'BR',
  'MX',
];
const LOCALES = [
  'en-US',
  'en-GB',
  'en-IE',
  'en-AU',
  'en-CA',
  'de-DE',
  'fr-FR',
  'it-IT',
  'es-ES',
  'nl-NL',
  'pl-PL',
  'lv-LV',
  'lt-LT',
  'et-EE',
  'sv-SE',
  'pt-PT',
  'ja-JP',
];

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Text input that keeps local state and commits on blur / after a pause. */
function CommitInput({
  value,
  onCommit,
  ...rest
}: { value: string; onCommit: (v: string) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
>) {
  const [v, setV] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setV(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Input
      value={v}
      onChange={(e) => {
        setV(e.target.value);
        clearTimeout(timer.current);
        const next = e.target.value;
        timer.current = setTimeout(() => next !== value && onCommit(next), 600);
      }}
      onBlur={() => {
        clearTimeout(timer.current);
        if (v !== value) onCommit(v);
      }}
      {...rest}
    />
  );
}

export default function SettingsPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash)
      setTimeout(
        () => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        50,
      );
  }, [hash]);

  return (
    <>
      <PageHeader title="Settings" />
      <Page className="max-w-3xl">
        <RegionSection />
        <AppearanceSection />
        <IdsSection />
        <PlatformsSection />
        <CategoriesSection />
        <AiSection />
        <MarketplacesSection />
        <SyncSection />
        <BackupSection />
        <DataSection />
        <p className="pb-6 text-center text-xs text-subtle">
          Flipper v{__APP_VERSION__} · local-first — your data lives in this browser unless you sync or export
          it.
        </p>
      </Page>
    </>
  );
}

function Anchor({ id }: { id: string }) {
  return <span id={id} className="block scroll-mt-20" />;
}

// ---------------------------------------------------------------- Region

function RegionSection() {
  const { settings } = useApp();
  const confirm = useConfirm();
  const set = (patch: Partial<Settings>) => updateSettings(patch);

  const changeCountry = async (country: string) => {
    const currency = currencyForCountry(country);
    const ebay = ebayForCountry(country);
    await set({ country });
    if (
      await confirm({
        title: `Use defaults for ${regionName(country)}?`,
        message: `Set currency to ${currency}, eBay site to ${EBAY_SITES.find((s) => s.id === ebay)?.label}, and tune marketplace research links for this country. Existing amounts are not converted.`,
        confirmLabel: 'Apply defaults',
      })
    ) {
      const custom = settings.marketplaces.filter((m) => !m.builtIn);
      await set({
        currency,
        ebayMarketplaceId: ebay,
        marketplaces: [...defaultMarketplaces(country, ebay), ...custom],
        weightUnit: country === 'US' ? 'lb' : 'kg',
      });
    }
  };

  return (
    <>
      <Anchor id="general" />
      <Section
        title="Region & currency"
        description="Currency is used for every amount. Changing it doesn't convert existing values."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Country">
            <Select value={settings.country} onChange={(e) => changeCountry(e.target.value)}>
              {[...new Set([settings.country, ...COUNTRIES])].map((c) => (
                <option key={c} value={c}>
                  {regionName(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City / area" hint="Used for local marketplace searches (e.g. Facebook, Craigslist)">
            <CommitInput value={settings.city} onCommit={(city) => set({ city })} placeholder="e.g. London" />
          </Field>
          <Field label="Currency">
            <Select value={settings.currency} onChange={(e) => set({ currency: e.target.value })}>
              {[...new Set([settings.currency, ...COMMON_CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Number & date format"
            hint={`Example: ${formatMoney(1234.5, { locale: settings.locale, currency: settings.currency })} · ${new Intl.DateTimeFormat(settings.locale).format(new Date())}`}
          >
            <Select value={settings.locale} onChange={(e) => set({ locale: e.target.value })}>
              {[...new Set([settings.locale, ...LOCALES])].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Weight unit">
            <Segmented
              value={settings.weightUnit}
              onChange={(weightUnit) => set({ weightUnit })}
              options={[
                { value: 'kg', label: 'kg' },
                { value: 'lb', label: 'lb' },
              ]}
            />
          </Field>
        </div>
      </Section>
    </>
  );
}

function AppearanceSection() {
  const { settings } = useApp();
  return (
    <Section title="Appearance">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Theme">
          <Segmented
            value={settings.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'System' },
            ]}
          />
        </Field>
        <Field label="Density">
          <Segmented
            value={settings.density}
            onChange={(density) => updateSettings({ density })}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </Field>
      </div>
    </Section>
  );
}

function IdsSection() {
  const { settings } = useApp();
  return (
    <Section
      title="Item & project IDs"
      description="IDs are assigned automatically and never reused. Changes apply to new records only."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          label="Item prefix"
          hint={`Next looks like ${formatCode(settings.itemPrefix, 42, settings.idPadding)}`}
        >
          <CommitInput
            value={settings.itemPrefix}
            onCommit={(v) => updateSettings({ itemPrefix: v.replace(/[^\w-]/g, '').slice(0, 8) })}
          />
        </Field>
        <Field label="Project prefix" hint={formatCode(settings.projectPrefix, 7, settings.idPadding)}>
          <CommitInput
            value={settings.projectPrefix}
            onCommit={(v) => updateSettings({ projectPrefix: v.replace(/[^\w-]/g, '').slice(0, 8) })}
          />
        </Field>
        <Field label="Digits">
          <NumberInput
            value={settings.idPadding}
            allowEmpty={false}
            onChange={(v) => updateSettings({ idPadding: Math.min(8, Math.max(1, Math.round(v ?? 5))) })}
          />
        </Field>
      </div>
    </Section>
  );
}

function PlatformsSection() {
  const { settings } = useApp();
  const [rows, setRows] = useState<PlatformFee[]>(settings.platforms);
  useEffect(() => setRows(settings.platforms), [settings.platforms]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(settings.platforms);
  const update = (i: number, patch: Partial<PlatformFee>) =>
    setRows((r) => r.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <Section
      title="Selling platforms & fees"
      description="Used to estimate fees when recording sales and projecting profit. Check your platforms' current fee pages — they change often."
    >
      <div className="space-y-2">
        {rows.map((p, i) => (
          <div key={p.id} className="grid grid-cols-[1fr_5.5rem_5.5rem_auto] items-center gap-2">
            <Input
              value={p.name}
              onChange={(e) => update(i, { name: e.target.value })}
              aria-label="Platform name"
            />
            <NumberInput
              value={p.feePercent}
              allowEmpty={false}
              onChange={(v) => update(i, { feePercent: v ?? 0 })}
              suffix="%"
              aria-label="Fee percent"
            />
            <NumberInput
              value={p.fixedFee}
              allowEmpty={false}
              onChange={(v) => update(i, { fixedFee: v ?? 0 })}
              aria-label="Fixed fee"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove platform"
              onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
              disabled={rows.length <= 1}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_5.5rem_5.5rem_auto] gap-2 text-[11px] text-subtle">
          <span>Name</span>
          <span>% of sale</span>
          <span>Fixed / order</span>
          <span className="w-8" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() =>
              setRows((r) => [
                ...r,
                { id: uid().slice(0, 8), name: 'New platform', feePercent: 0, fixedFee: 0 },
              ])
            }
          >
            Add platform
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw className="size-4" />}
            onClick={() => setRows(DEFAULT_PLATFORMS.map((p) => ({ ...p })))}
          >
            Reset
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty}
            onClick={() => updateSettings({ platforms: rows }).then(() => toast.success('Platforms saved'))}
          >
            Save
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
          <Field label="Default platform (for profit projections)">
            <Select
              value={settings.defaultPlatformId}
              onChange={(e) => updateSettings({ defaultPlatformId: e.target.value })}
            >
              {settings.platforms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Flag listings as stale after (days)">
            <NumberInput
              value={settings.staleDays}
              allowEmpty={false}
              onChange={(v) => updateSettings({ staleDays: Math.max(1, Math.round(v ?? 45)) })}
            />
          </Field>
        </div>
      </div>
    </Section>
  );
}

function CategoriesSection() {
  const { settings } = useApp();
  return (
    <Section title="Categories" description="Suggestions when adding items. You can still type any category.">
      <TagInput
        value={settings.categories}
        onChange={(categories) => updateSettings({ categories })}
        placeholder="Add category"
      />
    </Section>
  );
}

// ---------------------------------------------------------------- AI

function AiSection() {
  const { settings, local } = useApp();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const setAi = (patch: Partial<Settings['ai']>) => updateSettings({ ai: { ...settings.ai, ...patch } });
  const preset = AI_PROVIDER_PRESETS[settings.ai.provider];

  const test = async () => {
    setTesting(true);
    try {
      const reply = await testConnection(aiConfigFrom(settings, local));
      toast.success(`Connected — model replied “${reply.slice(0, 30)}”`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Anchor id="ai" />
      <Section
        title="AI assistant"
        description="Bring your own API key. DeepSeek is the default; any OpenAI-compatible API works (OpenAI, OpenRouter, Ollama, LM Studio…)."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Provider">
            <Select
              value={settings.ai.provider}
              onChange={(e) => {
                const provider = e.target.value as AiProvider;
                const p = AI_PROVIDER_PRESETS[provider];
                setAi({ provider, baseUrl: p.baseUrl, model: p.model });
              }}
            >
              {(Object.keys(AI_PROVIDER_PRESETS) as AiProvider[]).map((k) => (
                <option key={k} value={k}>
                  {AI_PROVIDER_PRESETS[k].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Model"
            hint={
              settings.ai.provider === 'deepseek'
                ? 'deepseek-chat (fast, cheap) or deepseek-reasoner (slower, deeper)'
                : undefined
            }
          >
            <CommitInput
              value={settings.ai.model}
              onCommit={(model) => setAi({ model: model.trim() })}
              list="ai-models"
            />
            <datalist id="ai-models">
              <option value="deepseek-chat" />
              <option value="deepseek-reasoner" />
            </datalist>
          </Field>
          <Field label="API base URL" className="sm:col-span-2">
            <CommitInput
              value={settings.ai.baseUrl}
              onCommit={(baseUrl) => setAi({ baseUrl: baseUrl.trim() })}
            />
          </Field>
          <Field
            label="API key"
            htmlFor="ai-api-key"
            className="sm:col-span-2"
            hint={
              <>
                Stored only on this device — never synced or included in backups.{' '}
                {preset.keyUrl && (
                  <a href={preset.keyUrl} target="_blank" rel="noreferrer noopener" className="text-accent">
                    Get a {preset.label} key
                  </a>
                )}
              </>
            }
          >
            <div className="flex gap-2">
              <CommitInput
                id="ai-api-key"
                type={showKey ? 'text' : 'password'}
                value={local.aiApiKey}
                onCommit={(aiApiKey) => updateLocalSettings({ aiApiKey: aiApiKey.trim() })}
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                size="icon"
                aria-label={showKey ? 'Hide key' : 'Show key'}
                onClick={() => setShowKey((s) => !s)}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </Field>
          <Field label={`Creativity (temperature ${settings.ai.temperature.toFixed(1)})`}>
            <input
              type="range"
              min={0}
              max={1.2}
              step={0.1}
              value={settings.ai.temperature}
              onChange={(e) => setAi({ temperature: Number(e.target.value) })}
              className="accent-[var(--accent)]"
            />
          </Field>
          <div className="flex items-end">
            <Switch
              checked={settings.ai.viaProxy}
              onChange={(viaProxy) => setAi({ viaProxy })}
              label="Route through proxy"
              description="Use if the provider blocks browser requests (CORS)"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={test} loading={testing} disabled={!settings.ai.baseUrl}>
            Test connection
          </Button>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- Marketplaces

function MarketplacesSection() {
  const { settings, local } = useApp();
  const [editing, setEditing] = useState<MarketplaceLink | null>(null);
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof checkProxy>> | null>(null);
  const confirm = useConfirm();
  const setLinks = (marketplaces: MarketplaceLink[]) => updateSettings({ marketplaces });

  const test = async () => {
    setChecking(true);
    try {
      setHealth(await checkProxy({ proxyUrl: settings.proxyUrl, proxyToken: local.proxyToken }));
    } catch (e) {
      setHealth(null);
      toast.error(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Anchor id="marketplaces" />
      <Section
        title="Marketplaces & research"
        description="Research links open marketplace searches for an item in one tap. Facebook Marketplace has no public API, so it's link-based; eBay and custom feeds can pull data through the optional proxy."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="eBay site">
            <Select
              value={settings.ebayMarketplaceId}
              onChange={(e) => {
                const ebay = e.target.value;
                const builtIns = defaultMarketplaces(settings.country, ebay);
                updateSettings({
                  ebayMarketplaceId: ebay,
                  marketplaces: settings.marketplaces.map((m) =>
                    m.id === 'ebay' ? { ...builtIns[0], enabled: m.enabled } : m,
                  ),
                });
              }}
            >
              {EBAY_SITES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Facebook Marketplace location"
            hint="The bit after /marketplace/ in your FB URL, e.g. “london” or a number"
          >
            <CommitInput
              value={settings.facebookLocation}
              onCommit={(facebookLocation) => updateSettings({ facebookLocation: facebookLocation.trim() })}
              placeholder={settings.city || 'e.g. london'}
            />
          </Field>
        </div>

        <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
          {settings.marketplaces.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={m.enabled}
                aria-label={`Enable ${m.name}`}
                onChange={(e) =>
                  setLinks(
                    settings.marketplaces.map((x) =>
                      x.id === m.id ? { ...x, enabled: e.target.checked } : x,
                    ),
                  )
                }
              />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(m)}>
                <div className="truncate text-sm">{m.name}</div>
                <div className="truncate text-xs text-subtle">{m.searchUrl}</div>
              </button>
              {m.feedUrl && <Badge tone="info">feed</Badge>}
              {!m.builtIn && <Badge>custom</Badge>}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() =>
              setEditing({
                id: uid().slice(0, 8),
                name: '',
                searchUrl: '',
                soldUrl: '',
                feedUrl: '',
                enabled: true,
                builtIn: false,
              })
            }
          >
            Add custom marketplace
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw className="size-4" />}
            onClick={async () => {
              if (
                await confirm({
                  title: 'Reset built-in links?',
                  message: 'Custom marketplaces are kept.',
                  confirmLabel: 'Reset',
                })
              )
                setLinks([
                  ...defaultMarketplaces(settings.country, settings.ebayMarketplaceId),
                  ...settings.marketplaces.filter((m) => !m.builtIn),
                ]);
            }}
          >
            Reset built-ins
          </Button>
        </div>

        <div className="mt-5 space-y-3 rounded-xl bg-surface-2 p-3">
          <div className="text-sm font-medium">Integration proxy (optional)</div>
          <p className="text-xs text-subtle">
            A tiny Cloudflare Worker you deploy for free from the <code>proxy/</code> folder. It keeps your
            eBay API keys off the device and fetches custom feeds that browsers can't read directly. See
            README → “Integration proxy”.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Proxy URL">
              <CommitInput
                value={settings.proxyUrl}
                onCommit={(proxyUrl) => updateSettings({ proxyUrl: proxyUrl.trim() })}
                placeholder="https://flipper-proxy.you.workers.dev"
              />
            </Field>
            <Field
              label="Proxy access token"
              hint="Matches PROXY_TOKEN on the worker. Stored on this device only."
            >
              <CommitInput
                type="password"
                value={local.proxyToken}
                onCommit={(proxyToken) => updateLocalSettings({ proxyToken: proxyToken.trim() })}
                autoComplete="off"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={test} loading={checking} disabled={!settings.proxyUrl}>
              Test proxy
            </Button>
            {health && (
              <>
                <Badge tone="profit">Connected</Badge>
                <Badge tone={health.ebay ? 'profit' : 'neutral'}>
                  eBay {health.ebay ? 'ready' : 'not set up'}
                </Badge>
                <Badge tone={health.fetch ? 'profit' : 'neutral'}>
                  Feeds {health.fetch ? 'ready' : 'no hosts allowed'}
                </Badge>
              </>
            )}
          </div>
        </div>
      </Section>
      <MarketplaceDialog
        link={editing}
        onClose={() => setEditing(null)}
        onSave={(link) => {
          const exists = settings.marketplaces.some((m) => m.id === link.id);
          setLinks(
            exists
              ? settings.marketplaces.map((m) => (m.id === link.id ? link : m))
              : [...settings.marketplaces, link],
          );
          setEditing(null);
        }}
        onDelete={(id) => {
          setLinks(settings.marketplaces.filter((m) => m.id !== id));
          setEditing(null);
        }}
      />
    </>
  );
}

function MarketplaceDialog({
  link,
  onClose,
  onSave,
  onDelete,
}: {
  link: MarketplaceLink | null;
  onClose: () => void;
  onSave: (l: MarketplaceLink) => void;
  onDelete: (id: string) => void;
}) {
  const [d, setD] = useState<MarketplaceLink | null>(link);
  useEffect(() => setD(link), [link]);
  if (!d) return null;
  const set = (patch: Partial<MarketplaceLink>) => setD({ ...d, ...patch });
  const valid = d.name.trim() && d.searchUrl.includes('{query}');
  return (
    <Modal
      open={Boolean(link)}
      onClose={onClose}
      title={d.name || 'Marketplace'}
      footer={
        <>
          {!d.builtIn && link && (
            <Button variant="danger" className="mr-auto" onClick={() => onDelete(d.id)}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={() => onSave({ ...d, name: d.name.trim() })}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Name">
          <Input value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field
          label="Search URL"
          hint="Use {query} for the search terms and optionally {city}. Tip: search on the site, copy the URL, replace your search words with {query}."
        >
          <Input
            value={d.searchUrl}
            onChange={(e) => set({ searchUrl: e.target.value })}
            placeholder="https://example.com/search?q={query}"
          />
        </Field>
        <Field label="Sold / completed URL (optional)">
          <Input value={d.soldUrl} onChange={(e) => set({ soldUrl: e.target.value })} />
        </Field>
        <Field
          label="Feed URL (optional, needs proxy)"
          hint="RSS, Atom or JSON search feed with {query}. Its host must be in ALLOWED_FETCH_HOSTS on the proxy."
        >
          <Input value={d.feedUrl} onChange={(e) => set({ feedUrl: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Sync

function SyncSection() {
  const { local } = useApp();
  const [busy, setBusy] = useState('');
  const [help, setHelp] = useState(false);
  const connected = hasValidToken();

  const sync = async () => {
    setBusy('Starting…');
    try {
      const r = await syncWithDrive(local.googleClientId, true, setBusy);
      toast.success(
        `Synced — ${r.written} updated, ${r.deleted} removed, ${r.imagesUp}↑ ${r.imagesDown}↓ photos${r.recoded ? `, ${r.recoded} IDs renumbered` : ''}`,
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <Anchor id="sync" />
      <Section
        title="Google Drive sync"
        description="Sync between your phone and computer through a private app folder in your own Google Drive. Flipper can only see its own files there."
      >
        <div className="space-y-3">
          <Field
            label="Google OAuth Client ID"
            hint={
              <button type="button" className="text-accent" onClick={() => setHelp(true)}>
                How do I get one? (5 minutes, free)
              </button>
            }
          >
            <CommitInput
              value={local.googleClientId}
              onCommit={(googleClientId) => updateLocalSettings({ googleClientId: googleClientId.trim() })}
              placeholder="1234-abc.apps.googleusercontent.com"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={<Cloud className="size-4" />}
              onClick={sync}
              loading={Boolean(busy)}
              disabled={!local.googleClientId}
            >
              {connected ? 'Sync now' : 'Connect & sync'}
            </Button>
            {connected && (
              <Button
                variant="ghost"
                onClick={() => disconnectGoogle().then(() => toast.success('Disconnected'))}
              >
                Disconnect
              </Button>
            )}
            {busy && <span className="text-xs text-subtle">{busy}</span>}
          </div>
          <Switch
            checked={local.autoSync}
            onChange={(autoSync) => updateLocalSettings({ autoSync })}
            label="Auto-sync while connected"
            description="Every few minutes and when you leave the app. Google asks you to reconnect about once an hour."
          />
          <p className="text-xs text-subtle">
            {local.lastSyncAt ? (
              <>
                <CheckCircle2 className="mr-1 inline size-3.5 text-profit" />
                Last synced {relativeTime(local.lastSyncAt, 'en')}
              </>
            ) : (
              'Never synced on this device.'
            )}
            {local.lastSyncError && (
              <span className="block text-loss">Last error: {local.lastSyncError}</span>
            )}
          </p>
        </div>
      </Section>
      <Modal open={help} onClose={() => setHelp(false)} title="Set up Google Drive sync" size="lg">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>
            Open{' '}
            <a
              className="text-accent"
              href="https://console.cloud.google.com/projectcreate"
              target="_blank"
              rel="noreferrer noopener"
            >
              Google Cloud Console
            </a>{' '}
            and create a project (any name, e.g. “Flipper”).
          </li>
          <li>
            Enable the <b>Google Drive API</b> (APIs &amp; Services → Library).
          </li>
          <li>
            Configure the <b>OAuth consent screen</b>: External, add your own Google account as a test user,
            add the scope <code>…/auth/drive.appdata</code>.
          </li>
          <li>
            Create credentials → <b>OAuth client ID</b> → type <b>Web application</b>. Under “Authorised
            JavaScript origins” add this app's address: <code>{location.origin}</code>
          </li>
          <li>
            Copy the Client ID into the field here, then press “Connect &amp; sync”. Do the same on your other
            devices with the same Client ID and Google account.
          </li>
        </ol>
        <p className="mt-3 text-xs text-subtle">
          Only a Client ID is needed (no secret). Conflicts are resolved per record — the most recent edit
          wins.
        </p>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- Backup

function BackupSection() {
  const [withImages, setWithImages] = useState(true);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportNow = async () => {
    setBusy(true);
    try {
      downloadBlob(await createBackup(withImages), `flipper-backup-${today()}.json`);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async (mode: 'merge' | 'replace') => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await importBackup(file, mode);
      toast.success(
        `Imported — ${r.written} records, ${r.images} photo${r.images === 1 ? '' : 's'}${r.recoded ? `, ${r.recoded} IDs renumbered` : ''}`,
      );
      setFile(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Anchor id="backup" />
      <Section
        title="Backup & restore"
        description="Download everything as a single file. Keep a copy somewhere safe — browser storage can be cleared."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<Download className="size-4" />} onClick={exportNow} loading={busy}>
            Export backup
          </Button>
          <Checkbox checked={withImages} onChange={setWithImages} label="Include photos" />
          <div className="flex-1" />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
            Import…
          </Button>
        </div>
        <p className="mt-2 text-xs text-subtle">
          CSV exports for spreadsheets and tax records are under Stats &amp; reports and Items.
        </p>
      </Section>
      <Modal
        open={Boolean(file)}
        onClose={() => setFile(null)}
        title="Import backup"
        footer={
          <>
            <Button onClick={() => setFile(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => runImport('replace')} loading={busy}>
              Replace everything
            </Button>
            <Button variant="primary" onClick={() => runImport('merge')} loading={busy}>
              Merge
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          <b className="text-fg">{file?.name}</b>
          <br />
          <b>Merge</b> keeps the newest version of each record. <b>Replace</b> makes this device match the
          backup exactly (anything not in it is deleted).
        </p>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- Data

function DataSection() {
  const [usage, setUsage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    void (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      setUsage({ used: est?.usage ?? 0, quota: est?.quota ?? 0, persisted });
    })();
  }, []);

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 1024 * 1024 * 100 ? 0 : 1)} MB`;

  const removeDemo = async () => {
    if (
      !(await confirm({
        title: 'Remove demo data?',
        message: 'Deletes all items and projects tagged “demo”.',
        danger: true,
        confirmLabel: 'Remove',
      }))
    )
      return;
    const items = await db.items.filter((i) => i.tags.includes('demo')).primaryKeys();
    const projects = await db.projects.filter((p) => p.tags.includes('demo')).primaryKeys();
    await deleteItems(items);
    for (const p of projects) await deleteProject(p, { deleteItems: true });
    toast.success('Demo data removed');
  };

  return (
    <>
      <Anchor id="data" />
      <Section title="Data & storage">
        <div className="space-y-3 text-sm">
          {usage && (
            <p className="text-muted">
              Using {mb(usage.used)}
              {usage.quota ? ` of ~${mb(usage.quota)} available` : ''} ·{' '}
              {usage.persisted ? (
                <span className="text-profit">protected from automatic clean-up</span>
              ) : (
                <button
                  type="button"
                  className="text-accent"
                  onClick={() =>
                    requestPersistentStorage().then((ok) =>
                      ok
                        ? toast.success('Storage protected')
                        : toast.error('The browser declined — installing the app usually helps'),
                    )
                  }
                >
                  protect from automatic clean-up
                </button>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={async () => {
                setBusy(true);
                await loadDemoData().finally(() => setBusy(false));
                toast.success('Demo data loaded');
              }}
              loading={busy}
            >
              Load demo data
            </Button>
            <Button size="sm" onClick={removeDemo}>
              Remove demo data
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-4" />}
              onClick={() => setEraseOpen(true)}
            >
              Erase all data
            </Button>
          </div>
        </div>
      </Section>
      <Modal
        open={eraseOpen}
        onClose={() => setEraseOpen(false)}
        title="Erase all data on this device?"
        size="sm"
        footer={
          <>
            <Button onClick={() => setEraseOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={typed !== 'ERASE'}
              onClick={async () => {
                await eraseAllData();
                location.reload();
              }}
            >
              Erase everything
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          <p>
            Items, projects, photos, settings and API keys on this device are deleted. Your Google Drive copy
            (if any) is not touched. Export a backup first if unsure.
          </p>
          <Field label='Type "ERASE" to confirm'>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className={cn(typed === 'ERASE' && 'border-loss')}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
