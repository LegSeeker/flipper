/** Load photos for AI requests (only when the model can see images and photos are switched on). */
import { db } from '@/db/db';
import type { ID, ImageOwnerType } from '@/db/schema';
import { imageForAi } from '@/lib/images';
import { photosEnabled, type AiConfig, type AiImage } from './client';

/** Max photos per request: enough to identify an item, few enough to stay cheap. */
export const MAX_AI_PHOTOS = 4;

export async function blobsForAi(cfg: AiConfig, blobs: Blob[], limit = MAX_AI_PHOTOS): Promise<AiImage[]> {
  if (!photosEnabled(cfg) || !blobs.length) return [];
  const out: AiImage[] = [];
  for (const b of blobs.slice(0, limit)) {
    try {
      out.push(await imageForAi(b));
    } catch {
      /* skip photos the browser can't decode */
    }
  }
  return out;
}

export async function ownerImagesForAi(
  cfg: AiConfig,
  ownerType: ImageOwnerType,
  ownerId: ID,
  limit = MAX_AI_PHOTOS,
): Promise<AiImage[]> {
  if (!photosEnabled(cfg)) return [];
  const images = await db.images.where('[ownerType+ownerId]').equals([ownerType, ownerId]).sortBy('order');
  return blobsForAi(
    cfg,
    images.map((i) => i.blob),
    limit,
  );
}

export async function imagesByIdForAi(cfg: AiConfig, ids: ID[]): Promise<AiImage[]> {
  if (!photosEnabled(cfg) || !ids.length) return [];
  const images = await db.images.bulkGet(ids);
  return blobsForAi(
    cfg,
    images.filter((i) => i !== undefined).map((i) => i.blob),
    ids.length,
  );
}
