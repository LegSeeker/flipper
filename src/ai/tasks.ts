/**
 * High-level AI tasks. Each builds a prompt from app data, asks for JSON where
 * the result feeds back into the app, and validates the reply with zod so bad
 * model output never reaches the database.
 */
import { z } from 'zod';
import type { Comp, Item, Project, Settings } from '@/db/schema';
import { parseNumber } from '@/lib/utils';
import { complete, extractJson, stream, type AiConfig, type AiMessage } from './client';

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

export function systemPrompt(ctx: AiContext): string {
  const s = ctx.settings;
  return [
    'You are an expert reselling assistant for a professional flipper who buys, repairs, parts out and resells items.',
    `The user is based in ${countryName(s.country)}${s.city ? ` (${s.city})` : ''}. All prices must be in ${s.currency}.`,
    'Be practical, specific and concise. Think about realistic second-hand market prices, fees, shipping and time.',
    'Your knowledge of prices comes from training data and may be out of date; when you have no market data supplied, say so and lower your confidence.',
    'Never invent facts about a specific item that were not given; state assumptions instead.',
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

async function askJson<T>(
  ctx: AiContext,
  user: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const messages: AiMessage[] = [
    {
      role: 'system',
      content: `${systemPrompt(ctx)}\nAlways answer with a single valid JSON object and nothing else.`,
    },
    { role: 'user', content: user },
  ];
  const text = await complete(ctx.cfg, messages, { json: true, signal });
  const parsed = schema.safeParse(extractJson(text));
  if (!parsed.success) throw new Error('The AI reply was missing required fields. Please try again.');
  return parsed.data;
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
): Promise<ListingResult> {
  const prompt = [
    `Write an optimised, honest sales listing for ${platform}.`,
    PLATFORM_RULES[platform],
    `Write in ${languageName(ctx.settings.locale)}.`,
    'Item:',
    describeItem(item, ctx.settings.currency),
    extra && `Extra instructions from the seller: ${extra}`,
    'Return JSON: {"title": string, "description": string (plain text with line breaks, no markdown), "bullets": string[], "keywords": string[] (search terms buyers use), "itemSpecifics": [{"name": string, "value": string}], "suggestedCategory": string, "photoTips": string[]}',
  ]
    .filter(Boolean)
    .join('\n\n');
  const res = await askJson(ctx, prompt, listingSchema, signal);
  if (platform === 'ebay' && res.title.length > 80) res.title = res.title.slice(0, 80).trim();
  return res;
}

// ---------------------------------------------------------------- Pricing

const priceSchema = z.object({
  suggestedPrice: num,
  quickSalePrice: optNum,
  low: optNum,
  high: optNum,
  confidence: level,
  demand: level,
  reasoning: str.catch(''),
  bestPlatforms: strList.catch([]),
  tips: strList.catch([]),
});
export type PriceResult = z.infer<typeof priceSchema>;

export async function estimatePrice(
  ctx: AiContext,
  item: Item,
  comps: readonly Comp[],
  signal?: AbortSignal,
): Promise<PriceResult> {
  const prompt = [
    `Estimate the current resale value (per unit) of this item on the second-hand market in ${countryName(ctx.settings.country)}.`,
    describeItem(item, ctx.settings.currency),
    describeComps(comps),
    'Weight SOLD comparables above active listings (active prices are asking prices). Ignore outliers and listings that are clearly a different model or condition.',
    `Return JSON: {"suggestedPrice": number (a good list price), "quickSalePrice": number (sells within a week), "low": number, "high": number, "confidence": "low"|"medium"|"high", "demand": "low"|"medium"|"high", "reasoning": string (2-4 sentences), "bestPlatforms": string[], "tips": string[] (how to get the best price)}. All amounts in ${ctx.settings.currency}.`,
  ].join('\n\n');
  return askJson(ctx, prompt, priceSchema, signal);
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
  return askJson(ctx, prompt, partOutSchema, signal);
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
  return askJson(ctx, prompt, repairSchema, signal);
}

// ---------------------------------------------------------------- Free-text tasks (streamed)

export function researchItem(ctx: AiContext, item: Item, signal?: AbortSignal): AsyncGenerator<string> {
  const prompt = [
    'Research this item for a reseller. Use short markdown sections:',
    '1. What it is (and how to identify the exact variant)',
    '2. What to check / common faults',
    '3. Demand and who buys it',
    '4. Best platforms and typical price range (say how confident you are)',
    '5. Accessories or parts that add value',
    describeItem(item, ctx.settings.currency),
  ].join('\n');
  return stream(
    ctx.cfg,
    [
      { role: 'system', content: systemPrompt(ctx) },
      { role: 'user', content: prompt },
    ],
    { signal },
  );
}

export function chat(
  ctx: AiContext,
  history: AiMessage[],
  inventoryContext: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const system = [
    systemPrompt(ctx),
    'You help with product research, sourcing ideas, pricing strategy, repair advice, shopping lists and writing listings. Use markdown.',
    inventoryContext && `Summary of the user's business data:\n${inventoryContext}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return stream(ctx.cfg, [{ role: 'system', content: system }, ...history], { signal });
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
