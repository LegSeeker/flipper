import { db } from '@/db/db';
import type { ImageMeta } from '@/db/schema';
import { base64ToBlob, blobToBase64 } from '@/lib/images';
import { readLocalSnapshot, applySnapshot } from './local';
import { emptySnapshot, mergeSnapshots, parseSnapshot, type Snapshot } from './snapshot';

interface BackupFile extends Snapshot {
  imageData?: Record<string, { blob: string; thumb: string; mime: string }>;
}

export async function createBackup(includeImages: boolean): Promise<Blob> {
  const snap: BackupFile = await readLocalSnapshot();
  if (includeImages) {
    snap.imageData = {};
    const images = await db.images.toArray();
    for (const img of images) {
      snap.imageData[img.id] = {
        blob: await blobToBase64(img.blob),
        thumb: await blobToBase64(img.thumb),
        mime: img.mime,
      };
    }
  } else {
    snap.tables.images = [];
  }
  return new Blob([JSON.stringify(snap)], { type: 'application/json' });
}

export interface ImportResult {
  written: number;
  deleted: number;
  images: number;
  recoded: number;
}

export async function importBackup(file: File, mode: 'merge' | 'replace'): Promise<ImportResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error('Could not read the file — is it a Flipper .json backup?');
  }
  const incoming = parseSnapshot(raw);
  const imageData = (raw as BackupFile).imageData ?? {};
  // Images without bytes can't be restored, so drop their metadata.
  incoming.tables.images = incoming.tables.images.filter((m: ImageMeta) => imageData[m.id]);
  const blobs = new Map<string, { blob: Blob; thumb: Blob }>();
  for (const meta of incoming.tables.images) {
    const d = imageData[meta.id];
    blobs.set(meta.id, { blob: base64ToBlob(d.blob, d.mime), thumb: base64ToBlob(d.thumb, d.mime) });
  }

  const local = await readLocalSnapshot();
  if (mode === 'replace') {
    // Everything local that isn't in the backup gets deleted.
    const res = await applySnapshot(local, { ...incoming, tombstones: [] }, blobs);
    return { ...res, images: blobs.size, recoded: 0 };
  }
  const { merged, recoded } = mergeSnapshots(local, incoming);
  const res = await applySnapshot(local, merged, blobs);
  return { ...res, images: blobs.size, recoded: recoded.length };
}

export { emptySnapshot };
