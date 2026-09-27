/**
 * Google Drive sync. Data lives in the hidden per-app "appDataFolder" of the
 * user's own Drive (scope drive.appdata: the app can't see any other files).
 *
 * Layout:  flipper-data.json   – merged snapshot (no image bytes)
 *          img-<id>.jpg        – one file per photo
 *
 * Auth uses Google Identity Services' token model, so it needs an OAuth
 * *Client ID* (no secret) that the user creates in Google Cloud Console.
 */
import { db } from '@/db/db';
import { updateLocalSettings } from '@/db/repo';
import { processImage } from '@/lib/images';
import { errorMessage } from '@/lib/utils';
import { applySnapshot, readLocalSnapshot } from './local';
import { emptySnapshot, mergeSnapshots, parseSnapshot, type Snapshot } from './snapshot';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DATA_FILE = 'flipper-data.json';
const TOKEN_KEY = 'flipper.gtoken';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } };
  }
}

let gisPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google sign-in. Are you offline?'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

interface StoredToken {
  token: string;
  expiresAt: number;
}

function readToken(): StoredToken | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null') as StoredToken | null;
    return t && t.expiresAt > Date.now() + 60_000 ? t : null;
  } catch {
    return null;
  }
}

export function hasValidToken(): boolean {
  return readToken() !== null;
}

/** Must be called from a user gesture when `interactive` (Google opens a popup). */
export async function getAccessToken(clientId: string, interactive: boolean): Promise<string> {
  const cached = readToken();
  if (cached) return cached.token;
  if (!interactive) throw new Error('Google session expired — press "Sync now" to reconnect.');
  if (!clientId.trim()) throw new Error('Add your Google OAuth Client ID first.');
  await loadGis();
  const oauth = window.google!.accounts.oauth2;
  return new Promise<string>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId.trim(),
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) {
          reject(new Error(r.error_description ?? r.error ?? 'Google sign-in failed'));
          return;
        }
        const stored: StoredToken = {
          token: r.access_token,
          expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
        };
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify(stored));
        resolve(r.access_token);
      },
      error_callback: (e) =>
        reject(new Error(e.message ?? (e.type === 'popup_closed' ? 'Sign-in window was closed' : e.type))),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export async function disconnectGoogle(): Promise<void> {
  const t = readToken();
  sessionStorage.removeItem(TOKEN_KEY);
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.token);
}

// ---------------------------------------------------------------- Drive REST helpers

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

async function drive(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    throw new Error('Google session expired — press "Sync now" to reconnect.');
  }
  if (!res.ok) {
    let msg = `Google Drive error: HTTP ${res.status}`;
    try {
      msg = (await res.json())?.error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res;
}

async function listFiles(token: string): Promise<Map<string, DriveFile>> {
  const out = new Map<string, DriveFile>();
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      fields: 'nextPageToken,files(id,name,modifiedTime,size)',
      pageSize: '1000',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await (await drive(token, `${API}/files?${params}`)).json();
    for (const f of data.files as DriveFile[]) out.set(f.name, f);
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

async function upload(token: string, name: string, blob: Blob, existingId?: string): Promise<void> {
  if (existingId) {
    await drive(token, `${UPLOAD}/files/${existingId}?uploadType=media`, { method: 'PATCH', body: blob });
    return;
  }
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify({ name, parents: ['appDataFolder'] })], { type: 'application/json' }),
  );
  form.append('file', blob);
  await drive(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', body: form });
}

async function download(token: string, id: string): Promise<Response> {
  return drive(token, `${API}/files/${id}?alt=media`);
}

async function remove(token: string, id: string): Promise<void> {
  await drive(token, `${API}/files/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- Sync engine

export interface SyncReport {
  written: number;
  deleted: number;
  imagesUp: number;
  imagesDown: number;
  recoded: number;
}

let running: Promise<SyncReport> | null = null;

export function syncWithDrive(
  clientId: string,
  interactive: boolean,
  onProgress?: (msg: string) => void,
): Promise<SyncReport> {
  running ??= runSync(clientId, interactive, onProgress ?? (() => {})).finally(() => {
    running = null;
  });
  return running;
}

const imageName = (id: string) => `img-${id}.jpg`;

async function runSync(
  clientId: string,
  interactive: boolean,
  progress: (msg: string) => void,
): Promise<SyncReport> {
  try {
    const token = await getAccessToken(clientId, interactive);
    progress('Checking Google Drive…');
    const files = await listFiles(token);

    let remote: Snapshot = emptySnapshot();
    const dataFile = files.get(DATA_FILE);
    if (dataFile) remote = parseSnapshot(await (await download(token, dataFile.id)).json());

    const local = await readLocalSnapshot();
    const { merged, recoded } = mergeSnapshots(local, remote);

    // Fetch photos we don't have yet.
    const localImageIds = new Set(local.tables.images.map((i) => i.id));
    const blobs = new Map<string, { blob: Blob; thumb: Blob }>();
    const missing = merged.tables.images.filter((m) => !localImageIds.has(m.id));
    let n = 0;
    for (const meta of missing) {
      const f = files.get(imageName(meta.id));
      if (!f) continue;
      progress(`Downloading photos ${++n}/${missing.length}…`);
      try {
        const blob = await (await download(token, f.id)).blob();
        const { thumb } = await processImage(new Blob([blob], { type: meta.mime }));
        blobs.set(meta.id, { blob: new Blob([blob], { type: meta.mime }), thumb });
      } catch {
        /* retried next sync */
      }
    }
    // Don't publish metadata for photos nobody can supply.
    merged.tables.images = merged.tables.images.filter((m) => localImageIds.has(m.id) || blobs.has(m.id));

    progress('Saving changes…');
    const res = await applySnapshot(local, merged, blobs);

    // Upload photos the cloud doesn't have.
    const toUpload = merged.tables.images.filter(
      (m) => localImageIds.has(m.id) && !files.has(imageName(m.id)),
    );
    let up = 0;
    for (const meta of toUpload) {
      progress(`Uploading photos ${up + 1}/${toUpload.length}…`);
      const rec = await db.images.get(meta.id);
      if (rec) {
        await upload(token, imageName(meta.id), rec.blob);
        up++;
      }
    }
    // Remove photos deleted anywhere.
    for (const t of merged.tombstones) {
      const f = t.table === 'images' ? files.get(imageName(t.id)) : undefined;
      if (f) await remove(token, f.id).catch(() => undefined);
    }

    progress('Uploading data…');
    await upload(
      token,
      DATA_FILE,
      new Blob([JSON.stringify(merged)], { type: 'application/json' }),
      dataFile?.id,
    );
    await updateLocalSettings({ lastSyncAt: Date.now(), lastSyncError: '' });
    return {
      written: res.written,
      deleted: res.deleted,
      imagesUp: up,
      imagesDown: blobs.size,
      recoded: recoded.length,
    };
  } catch (e) {
    await updateLocalSettings({ lastSyncError: errorMessage(e) });
    throw e;
  }
}
