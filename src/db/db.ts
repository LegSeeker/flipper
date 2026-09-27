import Dexie, { type EntityTable } from 'dexie';
import type {
  Comp,
  Conversation,
  Expense,
  ImageRecord,
  Item,
  LocalSettings,
  MetaEntry,
  Project,
  Requirement,
  Sale,
  Settings,
  Tombstone,
} from './schema';

export class FlipperDB extends Dexie {
  items!: EntityTable<Item, 'id'>;
  projects!: EntityTable<Project, 'id'>;
  sales!: EntityTable<Sale, 'id'>;
  expenses!: EntityTable<Expense, 'id'>;
  requirements!: EntityTable<Requirement, 'id'>;
  comps!: EntityTable<Comp, 'id'>;
  images!: EntityTable<ImageRecord, 'id'>;
  conversations!: EntityTable<Conversation, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  local!: EntityTable<LocalSettings, 'id'>;
  tombstones!: EntityTable<Tombstone, 'id'>;
  meta!: EntityTable<MetaEntry, 'key'>;

  constructor(name = 'flipper') {
    super(name);
    // Only indexed fields are listed (booleans can't be indexed in IndexedDB).
    // Add a new version() when changing indexes; never edit a shipped one.
    this.version(1).stores({
      items: 'id, code, status, projectId, parentItemId, category, updatedAt, createdAt',
      projects: 'id, code, status, type, updatedAt',
      sales: 'id, itemId, date, updatedAt',
      expenses: 'id, [ownerType+ownerId], ownerId, date, updatedAt',
      requirements: 'id, [ownerType+ownerId], ownerId, status, inventoryItemId, updatedAt',
      comps: 'id, itemId, updatedAt',
      images: 'id, [ownerType+ownerId], ownerId, updatedAt',
      conversations: 'id, updatedAt',
      settings: 'id',
      local: 'id',
      tombstones: 'id, table, deletedAt',
      meta: 'key',
    });
  }
}

export const db = new FlipperDB();

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
