# Architecture

## Why local-first

A reseller mostly works alone, often on a phone in a garage or at a car boot sale with poor signal. So Flipper is a **static PWA** with all data in the browser (IndexedDB):

- works offline, installs to the home screen, no server to run or pay for;
- private by default — data only leaves the device when the user chooses (AI, proxy, Drive sync);
- sync between devices goes through the user's own Google Drive (`drive.appdata` scope).

Things a browser can't do safely or at all (hold eBay secrets, read CORS-blocked feeds, reach AI APIs that block browsers) live in the optional user-deployed Cloudflare Worker in `proxy/`.

## Layout

```
src/
  db/          schema.ts (types), db.ts (Dexie tables), repo.ts (all writes), defaults.ts, demo.ts
  lib/         pure logic: calc.ts (profit/cost), stats.ts (reports), money, dates, csv, images, marketplaces, markdown
  ai/          client.ts (router + OpenAI protocol), anthropic.ts, gemini.ts, types.ts, sse.ts,
               tasks.ts (prompts + zod validation), refresh.ts, images.ts, context.ts
  integrations/ proxy.ts, ebay.ts, feeds.ts
  sync/        snapshot.ts (portable format + merge), local.ts (read/apply), backup.ts, drive.ts
  app/         context.tsx (settings provider, formatting), data.ts (live dataset + ledger hooks)
  components/  ui/ (design system), layout/, items/, images/, sales/, expenses/, requirements/, ai/, charts/
  pages/       one lazy-loaded chunk per route
proxy/         Cloudflare Worker
e2e/           Playwright tests
```

## Data model (src/db/schema.ts)

- **Item** — the unit of inventory. Has a sequential `code` (`FL-00001`), `status`, `archived`, optional `projectId` and `parentItemId` (parted from). Money totals are for the whole `quantity`; `listPrice`/`estimatedValue` are per unit.
- **Project** — groups items; holds the shared acquisition cost and the allocation method.
- **Sale** (per item, supports partial quantities), **Expense** (item / project / general overhead), **Requirement** (repair part or task for an item or project; can reference a stock item), **Comp** (market comparable), **ImageRecord** (resized JPEG + thumbnail blobs), **Conversation** (AI chat).
- **Settings** (synced) vs **LocalSettings** (API keys — one per provider, proxy token, Google client ID — never synced or exported). Settings are passed through `migrateSettings()` on every read, which fills new fields and moves off retired model names.
- **Tombstone** (deletions, for sync) and **Meta** (ID counters).

All writes go through `db/repo.ts`, which stamps timestamps, allocates codes, keeps `finishedAt`/`listedAt` consistent with status changes, cascades deletes and writes tombstones. Pages never write to Dexie directly.

Money is stored as plain numbers in the workspace currency and rounded to cents with `round2` at every aggregation step. (Integer cents was considered; at this scale float error is far below a cent and plain numbers keep AI output, CSV and backups simple.)

## Cost model (src/lib/calc.ts)

- Item **cost basis** = purchase price + acquisition costs + item expenses + actual cost of repair parts + share of project costs.
- Project **shared cost** = project purchase + project expenses + project parts. It's allocated across items **by value** (estimated value → list price → average sale price; equal split if nothing has a value), **equally per unit**, or **manually**. Allocations are rounded to cents and the remainder goes to the heaviest item so they always sum exactly. A parted-out source item is excluded (its cost lives on the project).
- **Realized profit** = net proceeds (sale + buyer shipping − fees − postage) − unit cost × units sold.
- **Projected profit** adds unsold units at list price/estimate minus estimated fees from the default platform.
- **Reports** (src/lib/stats.ts) use a cost-of-goods-sold basis: each sale is matched to its item's unit cost; general expenses and write-offs in the period are subtracted for net profit. Stock bought in the period is shown separately.

`buildLedger()` computes financials for every item and project in one pass and is memoised in `useLedger()`.

## Sync (src/sync)

A **snapshot** is the whole DB minus image bytes and device secrets. `mergeSnapshots()` is pure and unit-tested:

- per record, last-write-wins on `updatedAt`;
- tombstones delete records whose `updatedAt` ≤ `deletedAt` (a later edit resurrects);
- ID counters take the max; duplicate codes created offline on two devices are renumbered (newest record changes) and reported.

Drive layout: `flipper-data.json` (merged snapshot) + `img-<id>.jpg` per photo. The engine downloads the remote snapshot, merges, fetches missing photos, applies the diff locally, uploads missing photos, deletes photos tombstoned anywhere, then uploads the merged snapshot. Backups use the same snapshot format with photos embedded as base64.

## AI (src/ai)

- `client.ts` is the only entry point. It speaks three protocols and hides the differences behind one event stream (`text`, `status`, `sources`, `search`, `reset`):
  - **OpenAI chat completions** (DeepSeek, OpenAI, OpenRouter, Ollama…) — in `client.ts`, with JSON mode and SSE parsing (`sse.ts`);
  - **Anthropic Messages** (`anthropic.ts`, official `@anthropic-ai/sdk`, lazy-loaded) — Claude, and DeepSeek when web search is on (DeepSeek only offers search through its Anthropic-compatible endpoint);
  - **Gemini generateContent** (`gemini.ts`, REST + SSE).
- Provider presets (protocol, models, photo support, web search) live in `AI_PROVIDER_PRESETS` in `db/defaults.ts`; `canSearch()` / `canSeeImages()` derive capabilities. Photos are stripped for models that can't see them.
- **Web search**: Claude gets `web_search` (+ `web_fetch` on Opus/Sonnet 4.6+) with the user's country/city; `pause_turn` is resumed; Opus 5 requests opt into server-side refusal fallbacks. Gemini gets `google_search`. Sources come from search results and citations. If a search request fails before any text arrives (network/HTTP error), `stream()` retries without search and emits a status note.
- **Live vs estimate**: prompts tell the model whether it can browse and to mark each price live or estimate. `estimatePrice()` only trusts "live" and web-found listings when the reply really came with web sources (or the user supplied comparables); otherwise it's forced to `estimate`. The UI shows a `DataBasis` badge on every AI answer.
- `tasks.ts` builds prompts with the user's country/currency/language, asks for JSON where results flow back into the app, and **validates with zod** (lenient coercion of numbers/enums) so malformed output never reaches the DB.
- Photos for AI are downscaled to 1024 px JPEG (`lib/images.ts → imageForAi`, `ai/images.ts`). Chat photos are stored as `ImageRecord`s owned by the chat (`ownerType: 'chat'`), so they sync and back up like other photos and are deleted with the chat.
- Errors map to friendly kinds (auth, balance, rate, network/CORS, refused…).

## UI conventions

- Design tokens are CSS variables in `src/index.css` (dark default, light via `.dark` class removal); Tailwind utilities map to them (`bg-surface`, `text-muted`, `text-profit`…). Use `cn()` (clsx + tailwind-merge) so later classes override.
- Mobile: bottom tab bar + quick-add button; desktop: sidebar. Every page uses `PageHeader` + `Page`.
- List/filter state lives in the URL query string so back/forward and sharing keep it.
- `Field` auto-links its label to a single child control; give an explicit `id`/`htmlFor` when the control is wrapped.
- Charts follow the dataviz rules: one y-axis, thin rounded bars, hairline grid, legend for 2+ series, a table view for every chart. Series colours (`--series-1/2`) were validated for colour-blind separation and contrast against both surfaces.

## Testing

- `src/**/*.test.{ts,tsx}` (Vitest): calc, stats, snapshot merge, repo (with fake-indexeddb), AI client/tasks with mocked fetch (OpenAI, Anthropic and Gemini streams, web search, fallback), markdown rendering, parsing helpers.
- `e2e/` (Playwright, desktop + Pixel 7 viewports): first run & demo data, create item & record sale, settings persistence, AI flows against a mocked DeepSeek (including web search through its Anthropic endpoint and the typing indicator), backup → erase → restore with photos.
