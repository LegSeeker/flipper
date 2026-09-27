/**
 * Data model. All money values are stored in the user's base currency as plain
 * numbers (major units, e.g. 12.5 = €12.50) and rounded to 2dp by lib/money.
 * Dates the user picks are ISO `yyyy-mm-dd` strings; system timestamps are epoch ms.
 */

export type ID = string;

export interface BaseRecord {
  id: ID;
  createdAt: number;
  updatedAt: number;
}

export type OwnerType = 'item' | 'project';

// ---------------------------------------------------------------- Items

export const ITEM_STATUSES = [
  'sourcing',
  'in_stock',
  'in_repair',
  'listed',
  'sold',
  'parted_out',
  'kept',
  'consumed',
  'written_off',
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Statuses where the item is still being worked on / for sale. */
export const ACTIVE_ITEM_STATUSES: readonly ItemStatus[] = ['sourcing', 'in_stock', 'in_repair', 'listed'];

export const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'poor', 'for_parts'] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface Item extends BaseRecord {
  /** Human-readable, sequential ID printed on labels, e.g. "FL-00042". */
  code: string;
  name: string;
  description: string;
  category: string;
  brand: string;
  model: string;
  condition: Condition;
  tags: string[];
  quantity: number;
  status: ItemStatus;
  archived: boolean;
  /** ISO date the item reached a finished status (sold, kept, written off...). */
  finishedAt: string | null;
  projectId: ID | null;
  /** Item this one was parted out of, if any. */
  parentItemId: ID | null;
  storageLocation: string;
  barcode: string;

  // Acquisition (totals for the whole quantity)
  purchasePrice: number;
  purchaseCosts: number;
  purchaseDate: string | null;
  purchaseSource: string;
  /** Share of project costs, only used when the project allocation method is "manual". */
  manualAllocation: number | null;

  // Listing
  listPrice: number | null;
  listedAt: string | null;
  listingPlatform: string;
  listingUrl: string;
  listingTitle: string;
  listingDescription: string;

  // Market data (per unit)
  estimatedValue: number | null;
  marketLow: number | null;
  marketHigh: number | null;
  marketCheckedAt: number | null;
  marketNotes: string;

  weight: number | null;
  dimensions: string;
  primaryImageId: ID | null;
  notes: string;
}

// ---------------------------------------------------------------- Projects

export const PROJECT_TYPES = ['flip', 'part_out', 'repair', 'restoration', 'bundle', 'other'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_STATUSES = ['planning', 'active', 'finished'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ALLOCATION_METHODS = ['value', 'equal', 'manual'] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

export interface Project extends BaseRecord {
  code: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  archived: boolean;
  finishedAt: string | null;
  description: string;
  /** What the project's source item/lot cost (e.g. the whole car for a part-out). */
  purchasePrice: number;
  purchaseCosts: number;
  purchaseDate: string | null;
  purchaseSource: string;
  /** How shared project costs are spread across the project's items. */
  allocation: AllocationMethod;
  budget: number | null;
  targetProfit: number | null;
  deadline: string | null;
  primaryImageId: ID | null;
  tags: string[];
  notes: string;
}

// ---------------------------------------------------------------- Money records

export interface Sale extends BaseRecord {
  itemId: ID;
  quantity: number;
  /** Total price the buyer paid for the goods (excl. shipping). */
  price: number;
  /** Shipping paid by the buyer. */
  shippingCharged: number;
  /** Postage + packaging paid by you. */
  shippingCost: number;
  /** Platform + payment fees. */
  fees: number;
  platform: string;
  date: string;
  buyer: string;
  notes: string;
}

export const EXPENSE_CATEGORIES = [
  'parts',
  'tools',
  'supplies',
  'shipping',
  'fees',
  'travel',
  'subscription',
  'storage',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense extends BaseRecord {
  /** `general` = business overhead not tied to an item or project. */
  ownerType: OwnerType | 'general';
  ownerId: ID | null;
  label: string;
  category: ExpenseCategory;
  amount: number;
  date: string;
  notes: string;
}

// ---------------------------------------------------------------- Repairs / shopping list

export const REQUIREMENT_STATUSES = ['needed', 'ordered', 'in_stock', 'installed'] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export interface Requirement extends BaseRecord {
  ownerType: OwnerType;
  ownerId: ID;
  name: string;
  quantity: number;
  status: RequirementStatus;
  estimatedCost: number | null;
  /** What you actually paid. Counts towards the owner's cost basis. */
  actualCost: number | null;
  /** Set when the part comes from your own inventory. */
  inventoryItemId: ID | null;
  supplier: string;
  url: string;
  priority: 'low' | 'normal' | 'high';
  notes: string;
}

// ---------------------------------------------------------------- Market comparables

export interface Comp extends BaseRecord {
  itemId: ID;
  title: string;
  price: number;
  currency: string;
  source: string;
  url: string;
  sold: boolean;
  condition: string;
  date: string | null;
}

// ---------------------------------------------------------------- Images

export interface ImageRecord {
  id: ID;
  ownerType: OwnerType;
  ownerId: ID;
  blob: Blob;
  thumb: Blob;
  mime: string;
  width: number;
  height: number;
  size: number;
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** Image metadata without binary data (used by sync/export). */
export type ImageMeta = Omit<ImageRecord, 'blob' | 'thumb'>;

// ---------------------------------------------------------------- AI chat

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at: number;
}

export interface Conversation extends BaseRecord {
  title: string;
  messages: ChatMessage[];
}

// ---------------------------------------------------------------- Settings

export interface PlatformFee {
  id: string;
  name: string;
  /** Percentage of the total sale (incl. buyer-paid shipping), e.g. 12.8 */
  feePercent: number;
  /** Fixed fee per order. */
  fixedFee: number;
}

export interface MarketplaceLink {
  id: string;
  name: string;
  /** Search URL with `{query}` placeholder (also `{city}`). */
  searchUrl: string;
  /** Optional URL for sold/completed results. */
  soldUrl: string;
  /** Optional RSS/Atom/JSON feed URL with `{query}` placeholder, fetched via the proxy. */
  feedUrl: string;
  enabled: boolean;
  builtIn: boolean;
}

export type AiProvider = 'deepseek' | 'openai' | 'openrouter' | 'custom';

export interface Settings {
  id: 'app';
  updatedAt: number;
  onboarded: boolean;
  currency: string;
  locale: string;
  country: string;
  city: string;
  weightUnit: 'kg' | 'lb';
  theme: 'dark' | 'light' | 'system';
  density: 'comfortable' | 'compact';
  itemPrefix: string;
  projectPrefix: string;
  idPadding: number;
  /** Listings older than this (days) are flagged as stale. */
  staleDays: number;
  categories: string[];
  platforms: PlatformFee[];
  defaultPlatformId: string;
  marketplaces: MarketplaceLink[];
  ebayMarketplaceId: string;
  facebookLocation: string;
  ai: {
    provider: AiProvider;
    baseUrl: string;
    model: string;
    temperature: number;
    viaProxy: boolean;
  };
  proxyUrl: string;
}

/** Device-only settings: never exported or synced. */
export interface LocalSettings {
  id: 'local';
  aiApiKey: string;
  proxyToken: string;
  googleClientId: string;
  autoSync: boolean;
  lastSyncAt: number | null;
  lastSyncError: string;
}

// ---------------------------------------------------------------- Bookkeeping

export type SyncedTable =
  'items' | 'projects' | 'sales' | 'expenses' | 'requirements' | 'comps' | 'conversations' | 'images';

export interface Tombstone {
  id: ID;
  table: SyncedTable;
  deletedAt: number;
}

export interface MetaEntry {
  key: string;
  value: number;
}
