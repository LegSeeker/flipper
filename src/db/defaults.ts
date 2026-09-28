import type {
  AiProvider,
  Item,
  LocalSettings,
  MarketplaceLink,
  PlatformFee,
  Project,
  Settings,
} from './schema';

export const DEFAULT_CATEGORIES = [
  'Electronics',
  'Computers',
  'Phones',
  'Gaming',
  'Audio',
  'Cameras',
  'Tools',
  'Vehicle parts',
  'Home & Garden',
  'Furniture',
  'Clothing',
  'Collectibles',
  'Sports',
  'Toys',
  'Other',
];

/** Starting points only — fees change often, so users are asked to check them. */
export const DEFAULT_PLATFORMS: PlatformFee[] = [
  { id: 'ebay', name: 'eBay', feePercent: 13.25, fixedFee: 0.3 },
  { id: 'fb_local', name: 'Facebook Marketplace (local)', feePercent: 0, fixedFee: 0 },
  { id: 'fb_shipped', name: 'Facebook Marketplace (shipped)', feePercent: 5, fixedFee: 0 },
  { id: 'vinted', name: 'Vinted', feePercent: 0, fixedFee: 0 },
  { id: 'local', name: 'Local / cash', feePercent: 0, fixedFee: 0 },
  { id: 'other', name: 'Other', feePercent: 0, fixedFee: 0 },
];

const EURO = [
  'AT',
  'BE',
  'BG',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
];

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: 'USD',
  GB: 'GBP',
  IM: 'GBP',
  JE: 'GBP',
  GG: 'GBP',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD',
  CH: 'CHF',
  PL: 'PLN',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  JP: 'JPY',
  IN: 'INR',
  ZA: 'ZAR',
  BR: 'BRL',
  MX: 'MXN',
  UA: 'UAH',
  TR: 'TRY',
  ...Object.fromEntries(EURO.map((c) => [c, 'EUR'])),
};

export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'CHF',
  'PLN',
  'SEK',
  'NOK',
  'DKK',
  'CZK',
  'HUF',
  'RON',
  'JPY',
  'INR',
  'ZAR',
  'BRL',
  'MXN',
  'UAH',
  'TRY',
];

interface EbaySite {
  id: string;
  domain: string;
  label: string;
}

export const EBAY_SITES: EbaySite[] = [
  { id: 'EBAY_US', domain: 'www.ebay.com', label: 'eBay US' },
  { id: 'EBAY_GB', domain: 'www.ebay.co.uk', label: 'eBay UK' },
  { id: 'EBAY_DE', domain: 'www.ebay.de', label: 'eBay Germany' },
  { id: 'EBAY_FR', domain: 'www.ebay.fr', label: 'eBay France' },
  { id: 'EBAY_IT', domain: 'www.ebay.it', label: 'eBay Italy' },
  { id: 'EBAY_ES', domain: 'www.ebay.es', label: 'eBay Spain' },
  { id: 'EBAY_IE', domain: 'www.ebay.ie', label: 'eBay Ireland' },
  { id: 'EBAY_NL', domain: 'www.ebay.nl', label: 'eBay Netherlands' },
  { id: 'EBAY_AT', domain: 'www.ebay.at', label: 'eBay Austria' },
  { id: 'EBAY_BE', domain: 'www.befr.ebay.be', label: 'eBay Belgium' },
  { id: 'EBAY_CH', domain: 'www.ebay.ch', label: 'eBay Switzerland' },
  { id: 'EBAY_PL', domain: 'www.ebay.pl', label: 'eBay Poland' },
  { id: 'EBAY_CA', domain: 'www.ebay.ca', label: 'eBay Canada' },
  { id: 'EBAY_AU', domain: 'www.ebay.com.au', label: 'eBay Australia' },
];

const EBAY_BY_COUNTRY: Record<string, string> = {
  US: 'EBAY_US',
  GB: 'EBAY_GB',
  IM: 'EBAY_GB',
  JE: 'EBAY_GB',
  GG: 'EBAY_GB',
  DE: 'EBAY_DE',
  FR: 'EBAY_FR',
  IT: 'EBAY_IT',
  ES: 'EBAY_ES',
  IE: 'EBAY_IE',
  NL: 'EBAY_NL',
  AT: 'EBAY_AT',
  BE: 'EBAY_BE',
  CH: 'EBAY_CH',
  PL: 'EBAY_PL',
  CA: 'EBAY_CA',
  AU: 'EBAY_AU',
};

export function ebaySiteFor(marketplaceId: string): EbaySite {
  return EBAY_SITES.find((s) => s.id === marketplaceId) ?? EBAY_SITES[0];
}

export function currencyForCountry(country: string): string {
  return CURRENCY_BY_COUNTRY[country.toUpperCase()] ?? 'USD';
}

export function ebayForCountry(country: string): string {
  const c = country.toUpperCase();
  if (EBAY_BY_COUNTRY[c]) return EBAY_BY_COUNTRY[c];
  return EURO.includes(c) ? 'EBAY_DE' : 'EBAY_US';
}

const VINTED_DOMAIN: Record<string, string> = {
  GB: 'www.vinted.co.uk',
  DE: 'www.vinted.de',
  FR: 'www.vinted.fr',
  IT: 'www.vinted.it',
  ES: 'www.vinted.es',
  NL: 'www.vinted.nl',
  BE: 'www.vinted.be',
  AT: 'www.vinted.at',
  PL: 'www.vinted.pl',
  LT: 'www.vinted.lt',
  LV: 'www.vinted.lv',
  EE: 'www.vinted.ee',
  CZ: 'www.vinted.cz',
  US: 'www.vinted.com',
  IE: 'www.vinted.ie',
  PT: 'www.vinted.pt',
  SE: 'www.vinted.se',
  FI: 'www.vinted.fi',
  DK: 'www.vinted.dk',
};

const AMAZON_DOMAIN: Record<string, string> = {
  US: 'www.amazon.com',
  GB: 'www.amazon.co.uk',
  DE: 'www.amazon.de',
  FR: 'www.amazon.fr',
  IT: 'www.amazon.it',
  ES: 'www.amazon.es',
  NL: 'www.amazon.nl',
  PL: 'www.amazon.pl',
  SE: 'www.amazon.se',
  CA: 'www.amazon.ca',
  AU: 'www.amazon.com.au',
  JP: 'www.amazon.co.jp',
  IN: 'www.amazon.in',
  MX: 'www.amazon.com.mx',
  BR: 'www.amazon.com.br',
};

/** The Crown Dependencies buy and sell on the UK sites. */
const UK_MARKET = ['IM', 'JE', 'GG'];

/** Built-in research links, tuned to the user's country. */
export function defaultMarketplaces(country: string, ebayMarketplaceId: string): MarketplaceLink[] {
  const c = UK_MARKET.includes(country.toUpperCase()) ? 'GB' : country.toUpperCase();
  const ebay = ebaySiteFor(ebayMarketplaceId).domain;
  const amazon = AMAZON_DOMAIN[c] ?? (EURO.includes(c) ? 'www.amazon.de' : 'www.amazon.com');
  const vinted = VINTED_DOMAIN[c];
  const link = (m: Omit<MarketplaceLink, 'builtIn' | 'feedUrl' | 'soldUrl'> & Partial<MarketplaceLink>) =>
    ({ feedUrl: '', soldUrl: '', builtIn: true, ...m }) as MarketplaceLink;
  return [
    link({
      id: 'ebay',
      name: 'eBay',
      searchUrl: `https://${ebay}/sch/i.html?_nkw={query}`,
      soldUrl: `https://${ebay}/sch/i.html?_nkw={query}&LH_Sold=1&LH_Complete=1`,
      enabled: true,
    }),
    link({
      id: 'facebook',
      name: 'Facebook Marketplace',
      searchUrl: 'https://www.facebook.com/marketplace/{city}/search?query={query}',
      enabled: true,
    }),
    link({
      id: 'google_shopping',
      name: 'Google Shopping',
      searchUrl: 'https://www.google.com/search?tbm=shop&q={query}',
      enabled: true,
    }),
    link({ id: 'amazon', name: 'Amazon', searchUrl: `https://${amazon}/s?k={query}`, enabled: true }),
    link({
      id: 'vinted',
      name: 'Vinted',
      searchUrl: `https://${vinted ?? 'www.vinted.com'}/catalog?search_text={query}`,
      enabled: Boolean(vinted),
    }),
    link({
      id: 'gumtree',
      name: 'Gumtree',
      searchUrl:
        c === 'AU'
          ? 'https://www.gumtree.com.au/s-{query}/k0'
          : 'https://www.gumtree.com/search?search_query={query}',
      enabled: c === 'GB' || c === 'AU',
    }),
    link({
      id: 'craigslist',
      name: 'Craigslist',
      searchUrl: 'https://{city}.craigslist.org/search/sss?query={query}',
      enabled: c === 'US' || c === 'CA',
    }),
    link({
      id: 'kleinanzeigen',
      name: 'Kleinanzeigen',
      searchUrl: 'https://www.kleinanzeigen.de/s-{query}/k0',
      enabled: c === 'DE',
    }),
    link({
      id: 'mercari',
      name: 'Mercari',
      searchUrl: 'https://www.mercari.com/search/?keyword={query}',
      enabled: c === 'US',
    }),
    link({
      id: 'depop',
      name: 'Depop',
      searchUrl: 'https://www.depop.com/search/?q={query}',
      enabled: false,
    }),
  ];
}

export interface AiModelOption {
  id: string;
  note: string;
  /** Accepts photos. */
  vision: boolean;
}

export interface AiProviderPreset {
  label: string;
  /** Wire protocol: OpenAI chat completions, Anthropic Messages or Gemini generateContent. */
  protocol: 'openai' | 'anthropic' | 'gemini';
  baseUrl: string;
  model: string;
  keyUrl: string;
  keyPlaceholder: string;
  models: AiModelOption[];
  /** Built-in web search is available. */
  webSearch: boolean;
  /** The creativity (temperature) setting is sent. Newer Claude and Gemini models manage it themselves. */
  temperature: boolean;
}

/** Providers in dropdown order. Model IDs checked September 2026. */
export const AI_PROVIDER_PRESETS: Record<AiProvider, AiProviderPreset> = {
  deepseek: {
    label: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-…',
    models: [
      { id: 'deepseek-flash', note: 'V4.1 Flash — fast, very cheap, sees photos', vision: true },
      { id: 'deepseek-v4-pro', note: 'V4 Pro — deeper reasoning, text only', vision: false },
    ],
    webSearch: true,
    temperature: true,
  },
  anthropic: {
    label: 'Claude (Anthropic)',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-opus-5',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    models: [
      { id: 'claude-opus-5', note: 'Opus 5 — most capable', vision: true },
      { id: 'claude-sonnet-5', note: 'Sonnet 5 — fast, lower cost', vision: true },
      { id: 'claude-haiku-4-5', note: 'Haiku 4.5 — fastest, lowest cost', vision: true },
    ],
    webSearch: true,
    temperature: false,
  },
  gemini: {
    label: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.8-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    models: [
      { id: 'gemini-3.8-flash', note: '3.8 Flash — fast, has a free tier', vision: true },
      { id: 'gemini-3.1-pro', note: '3.1 Pro — most capable', vision: true },
    ],
    webSearch: true,
    temperature: false,
  },
  openai: {
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
    models: [{ id: 'gpt-5-mini', note: 'Cheap, sees photos', vision: true }],
    webSearch: false,
    temperature: true,
  },
  openrouter: {
    label: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-v4-flash',
    keyUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-…',
    models: [],
    webSearch: false,
    temperature: true,
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    keyUrl: '',
    keyPlaceholder: 'Leave empty for local servers',
    models: [],
    webSearch: false,
    temperature: true,
  },
};

/** DeepSeek retired these names on 24 July 2026. */
const RETIRED_DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash'];

/**
 * Fill in settings fields added after the record was saved and move off retired
 * model names. Pure; applied on every read.
 */
export function migrateSettings(stored: Partial<Settings>): Settings {
  const defaults = createDefaultSettings();
  const merged: Settings = { ...defaults, ...stored, ai: { ...defaults.ai, ...stored.ai } };
  if (!(merged.ai.provider in AI_PROVIDER_PRESETS)) merged.ai.provider = 'custom';
  if (merged.ai.provider === 'deepseek' && RETIRED_DEEPSEEK_MODELS.includes(merged.ai.model))
    merged.ai.model = AI_PROVIDER_PRESETS.deepseek.model;
  return merged;
}

/** Normalise a locale tag so Intl never throws (e.g. "en-US@posix", "en_GB.UTF-8"). */
export function safeLocale(raw: string | undefined | null): string {
  const cleaned = (raw ?? '').split(/[@.]/)[0].replace(/_/g, '-');
  try {
    return Intl.getCanonicalLocales(cleaned)[0] ?? 'en-US';
  } catch {
    return 'en-US';
  }
}

export function detectLocale(): { locale: string; country: string } {
  const locale = safeLocale(typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  let country = '';
  try {
    country = new Intl.Locale(locale).maximize().region ?? '';
  } catch {
    /* ignore malformed locale */
  }
  return { locale, country: country || 'US' };
}

export function createDefaultSettings(): Settings {
  const { locale, country } = detectLocale();
  const ebayMarketplaceId = ebayForCountry(country);
  return {
    id: 'app',
    updatedAt: Date.now(),
    onboarded: false,
    currency: currencyForCountry(country),
    locale,
    country,
    city: '',
    weightUnit: country === 'US' ? 'lb' : 'kg',
    theme: 'dark',
    density: 'comfortable',
    itemPrefix: 'FL',
    projectPrefix: 'PR',
    idPadding: 5,
    staleDays: 45,
    categories: [...DEFAULT_CATEGORIES],
    platforms: DEFAULT_PLATFORMS.map((p) => ({ ...p })),
    defaultPlatformId: 'ebay',
    marketplaces: defaultMarketplaces(country, ebayMarketplaceId),
    ebayMarketplaceId,
    facebookLocation: '',
    ai: {
      provider: 'deepseek',
      baseUrl: AI_PROVIDER_PRESETS.deepseek.baseUrl,
      model: AI_PROVIDER_PRESETS.deepseek.model,
      temperature: 0.4,
      viaProxy: false,
      webSearch: true,
      sendPhotos: true,
    },
    proxyUrl: '',
  };
}

export function createDefaultLocalSettings(): LocalSettings {
  return {
    id: 'local',
    aiApiKey: '',
    aiKeys: {},
    proxyToken: '',
    googleClientId: '',
    autoSync: false,
    lastSyncAt: null,
    lastSyncError: '',
  };
}

type Draft<T> = Omit<T, 'id' | 'code' | 'createdAt' | 'updatedAt'>;

export function emptyItem(): Draft<Item> {
  return {
    name: '',
    description: '',
    category: '',
    brand: '',
    model: '',
    condition: 'good',
    tags: [],
    quantity: 1,
    status: 'in_stock',
    archived: false,
    finishedAt: null,
    projectId: null,
    parentItemId: null,
    storageLocation: '',
    barcode: '',
    purchasePrice: 0,
    purchaseCosts: 0,
    purchaseDate: null,
    purchaseSource: '',
    manualAllocation: null,
    listPrice: null,
    listedAt: null,
    listingPlatform: '',
    listingUrl: '',
    listingTitle: '',
    listingDescription: '',
    estimatedValue: null,
    marketLow: null,
    marketHigh: null,
    marketCheckedAt: null,
    marketNotes: '',
    weight: null,
    dimensions: '',
    primaryImageId: null,
    notes: '',
  };
}

export function emptyProject(): Draft<Project> {
  return {
    name: '',
    type: 'flip',
    status: 'active',
    archived: false,
    finishedAt: null,
    description: '',
    purchasePrice: 0,
    purchaseCosts: 0,
    purchaseDate: null,
    purchaseSource: '',
    allocation: 'value',
    budget: null,
    targetProfit: null,
    deadline: null,
    primaryImageId: null,
    tags: [],
    notes: '',
  };
}
