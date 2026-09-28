/**
 * High-level AI tasks. Each builds a prompt from app data, asks for JSON where
 * the result feeds back into the app, and validates the reply with zod so bad
 * model output never reaches the database.
 */
import { z } from 'zod';
import { CONDITIONS, type Comp, type Item, type Project, type Settings } from '@/db/schema';
import { parseNumber } from '@/lib/utils';
import {
  complete,
  extractJson,
  searchEnabled,
  stream,
  type AiConfig,
  type AiEvent,
  type AiImage,
  type AiMessage,
  type AiReply,
  type AiSource,
} from './client';

// ---------------------------------------------------------------- helpers

const num = z.preprocess((v) => (typeof v === 'string' ? parseNumber(v) : v), z.number().finite());
const optNum = num.nullable().optional().catch(null);
const str = z.preprocess((v) => (v === null || v === undefined ? '' : String(v)), z.string());
const strList = z.preprocess(
  (v) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []),
  z.array(z.string()),
);
const level = z
  .preprocess((v) => String(v ?? '').toLowerCase(), z.enum(['low', 'medium', 'high']))
  .catch('medium');
const bool = z.preprocess((v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : v), z.boolean());

export interface AiContext {
  cfg: AiConfig;
  settings: Pick<Settings, 'currency' | 'country' | 'city' | 'locale' | 'ebayMarketplaceId'>;
}

export function languageName(locale: string): string {
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'language' }).of(new Intl.Locale(locale).language) ?? 'English'
    );
  } catch {
    return 'English';
  }
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Shared instructions. `search` says whether the model can browse for this
 * request, so it knows whether its prices are live or its own estimates.
 */
export function systemPrompt(ctx: AiContext, search: boolean): string {
  const s = ctx.settings;
  return [
    'You are an expert reselling assistant for a professional flipper who buys, repairs, parts out and resells items.',
    `The user is based in ${countryName(s.country)}${s.city ? ` (${s.city})` : ''}. All prices must be in ${s.currency}. Today is ${new Date().toISOString().slice(0, 10)}.`,
    'Be practical, specific and concise. Think about realistic second-hand market prices, fees, shipping and time.',
    search
      ? `You can search the web. When prices matter, search for current listings of the exact item in ${countryName(s.country)}, prefer SOLD/completed listings over asking prices, and cite the pages you used.`
      : 'You cannot browse the web for this request. Your price knowledge comes from training data and may be out of date.',
    'Mark every price you give as either live (seen on a web page just now, or in market data the user supplied) or an estimate (your own knowledge). Facebook Marketplace cannot be searched, so Facebook prices are always estimates.',
    'Never invent facts about a specific item that were not given; state assumptions instead. If photos are attached, use them to identify the exact model and judge condition.',
  ].join('\n');
}

export function describeItem(item: Partial<Item>, currency: string): string {
  const lines = [
    `Name: ${item.name ?? ''}`,
    item.brand && `Brand: ${item.brand}`,
    item.model && `Model: ${item.model}`,
    item.category && `Category: ${item.category}`,
    item.condition && `Condition: ${item.condition.replace('_', ' ')}`,
    item.quantity && item.quantity > 1 && `Quantity: ${item.quantity}`,
    item.description && `Description: ${item.description}`,
    item.notes && `Seller notes: ${item.notes}`,
    item.purchasePrice ? `Bought for: ${item.purchasePrice} ${currency} (total)` : '',
    item.listPrice ? `Current list price: ${item.listPrice} ${currency}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function describeComps(comps: readonly Comp[]): string {
  if (!comps.length) return 'No market comparables were supplied.';
  return [
    'Market comparables (title | price | sold or active | condition | source):',
    ...comps
      .slice(0, 30)
      .map(
        (c) =>
          `- ${c.title} | ${c.price} ${c.currency} | ${c.sold ? 'SOLD' : 'active'} | ${c.condition || '?'} | ${c.source}`,
      ),
  ].join('\n');
}

const photoNote = (images?: AiImage[]) =>
  images?.length
    ? `${images.length} photo${images.length > 1 ? 's' : ''} of the actual item are attached.`
    : '';

interface JsonOpts {
  signal?: AbortSignal;
  images?: AiImage[];
  /** Allow web search (defaults to off for JSON tasks). */
  search?: boolean;
}

async function askJson<T>(
  ctx: AiContext,
  user: string,
  schema: z.ZodType<T>,
  opts: JsonOpts = {},
): Promise<{ data: T; reply: AiReply }> {
  const search = searchEnabled(ctx.cfg, opts.search ?? false);
  const messages: AiMessage[] = [
    {
      role: 'system',
      content: `${systemPrompt(ctx, search)}\nAlways answer with a single valid JSON object and nothing else.`,
    },
    { role: 'user', content: user, images: opts.images },
  ];
  const reply = await complete(ctx.cfg, messages, { json: true, signal: opts.signal, search });
  const parsed = schema.safeParse(extractJson(reply.text));
  if (!parsed.success) throw new Error('The AI reply was missing required fields. Please try again.');
  return { data: parsed.data, reply };
}

// ---------------------------------------------------------------- Listing

export const LISTING_PLATFORMS = ['ebay', 'facebook', 'vinted', 'generic'] as const;
export type ListingPlatform = (typeof LISTING_PLATFORMS)[number];

const listingSchema = z.object({
  title: str,
  description: str,
  bullets: strList.catch([]),
  keywords: strList.catch([]),
  itemSpecifics: z
    .array(z.object({ name: str, value: str }))
    .catch([])
    .default([]),
  suggestedCategory: str.catch(''),
  photoTips: strList.catch([]),
});
export type ListingResult = z.infer<typeof listingSchema>;

const PLATFORM_RULES: Record<ListingPlatform, string> = {
  ebay: 'eBay: title max 80 characters, front-load brand/model/key specs, no ALL CAPS or emojis, no "L@@K". Description: condition first, what is included, specs, testing done, postage note. Provide item specifics.',
  facebook:
    'Facebook Marketplace: friendly, scannable, short title (under 60 characters), price-anchoring allowed, mention collection area and that it is available now. A few relevant emojis are OK.',
  vinted:
    'Vinted: casual tone, short title with brand + item + size/colour when relevant, include condition and measurements where relevant.',
  generic: 'Generic marketplace: clear title under 80 characters and an honest structured description.',
};

export async function generateListing(
  ctx: AiContext,
  item: Item,
  platform: ListingPlatform,
  extra: string,
  signal?: AbortSignal,
  images?: AiImage[],
): Promise<ListingResult> {
  const prompt = [
    `Write an optimised, honest sales listing for ${platform}.`,
    PLATFORM_RULES[platform],
    `Write in ${languageName(ctx.settings.locale)}.`,
    'Item:',
    describeItem(item, ctx.settings.currency),
    photoNote(images) &&
      `${photoNote(images)} Describe only what the photos and details support, including visible wear.`,
    extra && `Extra instructions from the seller: ${extra}`,
    'Return JSON: {"title": string, "description": string (plain text with line breaks, no markdown), "bullets": string[], "keywords": string[] (search terms buyers use), "itemSpecifics": [{"name": string, "value": string}], "suggestedCategory": string, "photoTips": string[]}',
  ]
    .filter(Boolean)
    .join('\n\n');
  const { data } = await askJson(ctx, prompt, listingSchema, { signal, images });
  if (platform === 'ebay' && data.title.length > 80) data.title = data.title.slice(0, 80).trim();
  return data;
}

// ---------------------------------------------------------------- Pricing

const priceSchema = z.object({
  suggestedPrice: num,
  quickSalePrice: optNum,
  low: optNum,
  high: optNum,
  confidence: level,
  demand: level,
  basis: z.preprocess((v) => String(v ?? '').toLowerCase(), z.enum(['live', 'estimate'])).catch('estimate'),
  reasoning: str.catch(''),
  bestPlatforms: strList.catch([]),
  tips: strList.catch([]),
  comps: z
    .array(
      z.object({
        title: str,
        price: num,
        sold: bool.catch(false),
        url: str.catch(''),
        source: str.catch(''),
      }),
    )
    .catch([])
    .default([]),
});

export interface WebComp {
  title: string;
  price: number;
  sold: boolean;
  url: string;
  source: string;
}

export type PriceResult = Omit<z.infer<typeof priceSchema>, 'comps'> & {
  /** Listings the model found on the web (only kept when it actually searched). */
  webComps: WebComp[];
  sources: AiSource[];
  /** Web search was on for this estimate. */
  searched: boolean;
};

export async function estimatePrice(
  ctx: AiContext,
  item: Item,
  comps: readonly Comp[],
  signal?: AbortSignal,
  images?: AiImage[],
): Promise<PriceResult> {
  const search = searchEnabled(ctx.cfg);
  const cur = ctx.settings.currency;
  const prompt = [
    `Estimate the current resale value (per unit) of this item on the second-hand market in ${countryName(ctx.settings.country)}.`,
    describeItem(item, cur),
    photoNote(images),
    describeComps(comps),
    search
      ? `Search the web for current prices of this exact item: sold/completed listings first (for example eBay sold items), then active listings. Put up to 8 of the most relevant listings you actually found in "comps" with their real URLs and prices converted to ${cur}.`
      : '',
    'Weight SOLD prices above active listings (active prices are asking prices). Ignore outliers and listings that are clearly a different model or condition.',
    'Set "basis" to "live" only if your numbers rest on market data (web results you found or the comparables above); otherwise "estimate".',
    `Return JSON: {"suggestedPrice": number (a good list price), "quickSalePrice": number (sells within a week), "low": number, "high": number, "confidence": "low"|"medium"|"high", "demand": "low"|"medium"|"high", "basis": "live"|"estimate", "reasoning": string (2-4 sentences, say what data you used), "bestPlatforms": string[], "tips": string[] (how to get the best price), "comps": [{"title": string, "price": number, "sold": boolean, "url": string, "source": string}]}. All amounts in ${cur}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const { data, reply } = await askJson(ctx, prompt, priceSchema, { signal, images, search });
  const { comps: found, ...rest } = data;
  const searchedWeb = reply.searched && reply.sources.length > 0;
  // Listings are only trusted when the model really searched; otherwise they may be invented.
  const webComps = searchedWeb
    ? found.filter((c) => /^https?:\/\//.test(c.url) && c.price > 0).slice(0, 8)
    : [];
  const basis = comps.length > 0 || searchedWeb ? rest.basis : 'estimate';
  return { ...rest, basis, webComps, sources: reply.sources, searched: reply.searched };
}

// ---------------------------------------------------------------- Identify from photos

const identifySchema = z.object({
  name: str,
  brand: str.catch(''),
  model: str.catch(''),
  category: str.catch(''),
  condition: z
    .preprocess(
      (v) =>
        String(v ?? '')
          .toLowerCase()
          .replace(/[\s-]+/g, '_'),
      z.enum(CONDITIONS),
    )
    .nullable()
    .catch(null),
  description: str.catch(''),
  tags: strList.catch([]),
  estimatedValue: optNum,
  confidence: level,
  notes: str.catch(''),
});
export type IdentifyResult = z.infer<typeof identifySchema>;

export async function identifyItem(
  ctx: AiContext,
  images: AiImage[],
  categories: string[],
  hint: string,
  signal?: AbortSignal,
): Promise<IdentifyResult> {
  const prompt = [
    `Identify the item in ${images.length > 1 ? 'these photos' : 'this photo'} for a resale inventory.`,
    hint && `The seller says: ${hint}`,
    'Read any visible labels, model numbers and serial plates. Judge condition only from what is visible.',
    `Prefer one of these categories where one fits: ${categories.join(', ')}.`,
    `Return JSON: {"name": string (what buyers search for: brand + model + type), "brand": string, "model": string (model or part number, empty if not visible), "category": string, "condition": ${CONDITIONS.map((c) => `"${c}"`).join('|')}, "description": string (2-4 factual sentences: what it is, key specs, visible condition), "tags": string[], "estimatedValue": number (rough resale value in ${ctx.settings.currency}, an estimate), "confidence": "low"|"medium"|"high", "notes": string (what to check or photograph to confirm)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const { data } = await askJson(ctx, prompt, identifySchema, { signal, images });
  return data;
}

// ---------------------------------------------------------------- Part-out

const partOutSchema = z.object({
  parts: z
    .array(
      z.object({
        name: str,
        category: str.catch(''),
        quantity: num.catch(1),
        estimatedPrice: optNum,
        demand: level,
        difficulty: level,
        notes: str.catch(''),
      }),
    )
    .min(1),
  notes: str.catch(''),
});
export type PartOutResult = z.infer<typeof partOutSchema>;

export async function suggestPartOut(
  ctx: AiContext,
  source: { name: string; description: string; condition?: string; purchasePrice?: number },
  categories: string[],
  signal?: AbortSignal,
): Promise<PartOutResult> {
  const prompt = [
    'The seller is breaking this item for parts. List the parts worth selling individually, most valuable first.',
    `Source: ${source.name}`,
    source.description && `Details: ${source.description}`,
    source.condition && `Condition: ${source.condition}`,
    source.purchasePrice ? `Bought for: ${source.purchasePrice} ${ctx.settings.currency}` : '',
    'Only include parts that realistically sell second-hand; group tiny low-value parts into lots. Use specific part names buyers search for (include part numbers only if you are confident).',
    `Prefer these categories where one fits: ${categories.join(', ')}.`,
    `Return JSON: {"parts": [{"name": string, "category": string, "quantity": number, "estimatedPrice": number (per unit, ${ctx.settings.currency}), "demand": "low"|"medium"|"high", "difficulty": "low"|"medium"|"high" (removal effort), "notes": string}], "notes": string (overall advice: order to sell, what to check)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return (await askJson(ctx, prompt, partOutSchema, { signal })).data;
}

// ---------------------------------------------------------------- Repair planning

const repairSchema = z.object({
  diagnosis: str.catch(''),
  difficulty: level,
  estimatedHours: optNum,
  steps: strList.catch([]),
  parts: z
    .array(
      z.object({
        name: str,
        quantity: num.catch(1),
        estimatedCost: optNum,
        required: z.boolean().catch(true),
        notes: str.catch(''),
      }),
    )
    .catch([]),
  tools: strList.catch([]),
  risks: strList.catch([]),
});
export type RepairResult = z.infer<typeof repairSchema>;

export async function planRepair(
  ctx: AiContext,
  subject: string,
  fault: string,
  inventory: string[],
  signal?: AbortSignal,
): Promise<RepairResult> {
  const prompt = [
    'Help plan a repair so the item can be resold. Build a shopping list of parts.',
    `Item:\n${subject}`,
    `Fault / goal: ${fault || 'Not specified — suggest the most common faults to check.'}`,
    inventory.length
      ? `Parts already in the seller's stock (reuse where sensible): ${inventory.slice(0, 60).join('; ')}`
      : '',
    `Return JSON: {"diagnosis": string, "difficulty": "low"|"medium"|"high", "estimatedHours": number, "steps": string[], "parts": [{"name": string, "quantity": number, "estimatedCost": number (total for the quantity, ${ctx.settings.currency}), "required": boolean, "notes": string}], "tools": string[], "risks": string[]}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return (await askJson(ctx, prompt, repairSchema, { signal })).data;
}

// ---------------------------------------------------------------- Free-text tasks (streamed)

export function researchItem(
  ctx: AiContext,
  item: Item,
  signal?: AbortSignal,
  images?: AiImage[],
): AsyncGenerator<AiEvent> {
  const search = searchEnabled(ctx.cfg);
  const prompt = [
    'Research this item for a reseller. Use short markdown sections:',
    '1. What it is (and how to identify the exact variant)',
    '2. What to check / common faults',
    '3. Demand and who buys it',
    `4. Best platforms and typical price range — ${search ? 'search current sold and active listings and cite them' : 'say how confident you are'}; mark each price live or estimate`,
    '5. Accessories or parts that add value',
    describeItem(item, ctx.settings.currency),
    photoNote(images),
  ]
    .filter(Boolean)
    .join('\n');
  return stream(
    ctx.cfg,
    [
      { role: 'system', content: systemPrompt(ctx, search) },
      { role: 'user', content: prompt, images },
    ],
    { signal, search },
  );
}

export function chat(
  ctx: AiContext,
  history: AiMessage[],
  inventoryContext: string,
  opts: { signal?: AbortSignal; search: boolean },
): AsyncGenerator<AiEvent> {
  const search = searchEnabled(ctx.cfg, opts.search);
  const system = [
    systemPrompt(ctx, search),
    'You help with product research, sourcing ideas, pricing strategy, repair advice, shopping lists and writing listings. Use markdown.',
    search
      ? 'When the user asks what is worth buying or selling now, search for current prices and demand rather than relying on memory.'
      : 'If a question needs current prices, give your best estimate and say it is an estimate; suggest what to check on sold listings.',
    inventoryContext && `Summary of the user's business data:\n${inventoryContext}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return stream(ctx.cfg, [{ role: 'system', content: system }, ...history], {
    signal: opts.signal,
    search,
  });
}

export function projectBrief(project: Project, itemNames: string[], currency: string): string {
  return [
    `Project: ${project.name} (${project.type.replace('_', ' ')})`,
    project.description && `Description: ${project.description}`,
    project.purchasePrice ? `Bought for: ${project.purchasePrice} ${currency}` : '',
    itemNames.length ? `Items: ${itemNames.slice(0, 40).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
