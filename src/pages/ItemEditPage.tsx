import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { ImagePlus, Sparkles } from 'lucide-react';
import { db } from '@/db/db';
import { emptyItem } from '@/db/defaults';
import { addImages, createItem, updateItem } from '@/db/repo';
import { CONDITIONS, ITEM_STATUSES, type Item } from '@/db/schema';
import { useAiContext, useFormat, useSettings } from '@/app/context';
import { photosEnabled } from '@/ai/client';
import { blobsForAi, MAX_AI_PHOTOS, ownerImagesForAi } from '@/ai/images';
import { identifyItem, type IdentifyResult } from '@/ai/tasks';
import { PendingThumb } from '@/components/images/images';
import { AiErrorText, useAiJob } from '@/components/ai/common';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/card';
import {
  Field,
  Input,
  MoneyField,
  NumberInput,
  Select,
  TagInput,
  Textarea,
  TextField,
} from '@/components/ui/field';
import { ITEM_STATUS_META } from '@/components/ui/badge';
import { today } from '@/lib/dates';
import { errorMessage, titleCase } from '@/lib/utils';

type Draft = ReturnType<typeof emptyItem>;

export default function ItemEditPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = !id;
  const navigate = useNavigate();
  const settings = useSettings();
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const ai = useAiContext();
  const f = useFormat();
  const identify = useAiJob<IdentifyResult>();
  const savedPhotos = useLiveQuery(
    () => (id ? db.images.where('[ownerType+ownerId]').equals(['item', id]).count() : 0),
    [id],
  );
  const canIdentify =
    ai.configured && photosEnabled(ai.cfg) && (isNew ? files.length > 0 : (savedPhotos ?? 0) > 0);

  useEffect(() => {
    void (async () => {
      if (id) {
        const item = await db.items.get(id);
        if (!item) {
          toast.error('Item not found');
          navigate('/items');
          return;
        }
        const { id: _i, code: c, createdAt: _c, updatedAt: _u, ...rest } = item;
        setCode(c);
        setDraft(rest);
      } else {
        setDraft({
          ...emptyItem(),
          purchaseDate: today(),
          projectId: params.get('project'),
          status: (params.get('status') as Item['status']) || 'in_stock',
          name: params.get('name') ?? '',
        });
      }
    })();
  }, [id, navigate, params]);

  if (!draft) return null;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const project = projects?.find((p) => p.id === draft.projectId);

  const save = async (another = false) => {
    if (!draft.name.trim()) {
      toast.error('Give the item a name');
      return;
    }
    setSaving(true);
    try {
      const data = {
        ...draft,
        name: draft.name.trim(),
        quantity: Math.max(1, Math.round(draft.quantity || 1)),
      };
      let itemId = id;
      if (isNew) {
        const created = await createItem(data);
        itemId = created.id;
        if (files.length) {
          const res = await addImages('item', created.id, files);
          res.errors.forEach((e) => toast.error(e));
        }
        toast.success(`Created ${created.code}`);
      } else {
        await updateItem(id!, data);
        toast.success('Saved');
      }
      if (another) {
        setDraft({
          ...emptyItem(),
          purchaseDate: draft.purchaseDate,
          projectId: draft.projectId,
          category: draft.category,
          purchaseSource: draft.purchaseSource,
        });
        setFiles([]);
        window.scrollTo({ top: 0 });
      } else navigate(`/items/${itemId}`, { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const perUnit = draft.quantity > 1 ? ' (per unit)' : '';

  /** Ask the AI what's in the photos and fill in the fields that are still empty. */
  const fillFromPhotos = () =>
    identify.run(async (signal) => {
      const images = isNew
        ? await blobsForAi(ai.cfg, files)
        : await ownerImagesForAi(ai.cfg, 'item', id!, MAX_AI_PHOTOS);
      const res = await identifyItem(ai, images, settings.categories, draft.name, signal);
      // Read the latest draft (the user may have typed while the AI was working).
      const d = draftRef.current;
      if (!d) return res;
      const next = { ...d };
      const filled: string[] = [];
      const fill = <K extends 'name' | 'brand' | 'model' | 'category' | 'description'>(k: K, v: string) => {
        if (v && !next[k].trim()) {
          next[k] = v;
          filled.push(k);
        }
      };
      fill('name', res.name);
      fill('brand', res.brand);
      fill('model', res.model);
      fill('category', res.category);
      fill('description', res.description);
      if (res.condition && d.condition === emptyItem().condition && res.condition !== d.condition) {
        next.condition = res.condition;
        filled.push('condition');
      }
      const tags = res.tags.map((t) => t.toLowerCase()).filter((t) => !d.tags.includes(t));
      if (tags.length) {
        next.tags = [...d.tags, ...tags.slice(0, 6)];
        filled.push('tags');
      }
      if (res.estimatedValue && next.estimatedValue === null) {
        next.estimatedValue = res.estimatedValue;
        filled.push('estimated value');
      }
      setDraft(next);
      toast.success(filled.length ? `Filled in ${filled.join(', ')}` : 'Nothing new to fill in');
      return res;
    });

  const identifyButton = canIdentify ? (
    <Button
      size="sm"
      onClick={fillFromPhotos}
      loading={identify.loading}
      icon={<Sparkles className="size-3.5" />}
    >
      Fill in from photos
    </Button>
  ) : null;

  const photosSection = isNew && (
    <Section
      title="Photos"
      description="Resized and stripped of location data before saving. The AI can fill in the details from them."
      action={identifyButton}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          setFiles((f) => [...f, ...(e.target.files ? [...e.target.files] : [])]);
          e.target.value = '';
        }}
      />
      <div className="flex flex-wrap gap-2">
        {files.map((file, i) => (
          <PendingThumb key={i} file={file} onRemove={() => setFiles((f) => f.filter((_, j) => j !== i))} />
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="grid size-20 place-items-center rounded-xl border border-dashed border-border text-subtle hover:border-accent hover:text-accent"
          aria-label="Add photos"
        >
          <ImagePlus className="size-6" />
        </button>
      </div>
    </Section>
  );

  const identifyResult = identify.result && (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm">
      <p className="font-medium">
        AI identification · confidence {identify.result.confidence}
        {identify.result.estimatedValue ? ` · worth roughly ${f.money(identify.result.estimatedValue)}` : ''}
      </p>
      {identify.result.notes && <p className="mt-1 text-muted">{identify.result.notes}</p>}
      <p className="mt-1 text-xs text-subtle">
        The value is an estimate from the photos. After saving, run an AI price check on the Market tab for
        live prices.
      </p>
    </div>
  );

  return (
    <>
      <PageHeader
        title={isNew ? 'New item' : `Edit ${code}`}
        back
        actions={
          <Button variant="primary" onClick={() => save()} loading={saving}>
            Save
          </Button>
        }
      />
      <Page className="max-w-3xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {photosSection}
          <AiErrorText message={identify.error} />
          {identifyResult}
          <Section title="Basics" action={isNew ? null : identifyButton}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                label="Name *"
                value={draft.name}
                onChange={(v) => set('name', v)}
                placeholder="e.g. Sony WH-1000XM4 headphones"
                className="sm:col-span-2"
                autoFocus={isNew}
              />
              <Field label="Category">
                <Input
                  list="category-list"
                  value={draft.category}
                  onChange={(e) => set('category', e.target.value)}
                  placeholder="Choose or type"
                />
                <datalist id="category-list">
                  {settings.categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label="Condition">
                <Select
                  value={draft.condition}
                  onChange={(e) => set('condition', e.target.value as Item['condition'])}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {titleCase(c)}
                    </option>
                  ))}
                </Select>
              </Field>
              <TextField label="Brand" value={draft.brand} onChange={(v) => set('brand', v)} />
              <TextField label="Model / part no." value={draft.model} onChange={(v) => set('model', v)} />
              <Field label="Quantity">
                <NumberInput
                  value={draft.quantity}
                  allowEmpty={false}
                  onChange={(v) => set('quantity', Math.max(1, Math.round(v ?? 1)))}
                />
              </Field>
              <TextField label="Barcode / serial" value={draft.barcode} onChange={(v) => set('barcode', v)} />
              <Field label="Tags" className="sm:col-span-2" hint="Press Enter or comma to add">
                <TagInput
                  value={draft.tags}
                  onChange={(v) => set('tags', v)}
                  placeholder="e.g. needs-battery, bundle"
                />
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <Textarea
                  rows={3}
                  value={draft.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Specs, faults, what's included…"
                />
              </Field>
            </div>
          </Section>

          <Section title="Status & location">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Status">
                <Select
                  value={draft.status}
                  onChange={(e) => set('status', e.target.value as Item['status'])}
                >
                  {ITEM_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {ITEM_STATUS_META[s].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <TextField
                label="Storage location"
                value={draft.storageLocation}
                onChange={(v) => set('storageLocation', v)}
                placeholder="e.g. Shelf B2, Box 14"
              />
              <Field label="Project" className="sm:col-span-2">
                <Select
                  value={draft.projectId ?? ''}
                  onChange={(e) => set('projectId', e.target.value || null)}
                >
                  <option value="">No project</option>
                  {(projects ?? [])
                    .filter((p) => !p.archived || p.id === draft.projectId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} · {p.name}
                      </option>
                    ))}
                </Select>
              </Field>
              {project?.allocation === 'manual' && (
                <MoneyField
                  label="Share of project cost"
                  value={draft.manualAllocation}
                  onChange={(v) => set('manualAllocation', v)}
                  hint="This project uses manual cost allocation."
                />
              )}
            </div>
          </Section>

          <Section
            title="Purchase"
            description={
              project
                ? `Project costs are shared across items automatically — only enter what this item cost on its own.`
                : undefined
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MoneyField
                label="Purchase price (total)"
                value={draft.purchasePrice}
                allowEmpty={false}
                onChange={(v) => set('purchasePrice', v ?? 0)}
              />
              <MoneyField
                label="Extra acquisition costs"
                value={draft.purchaseCosts}
                allowEmpty={false}
                onChange={(v) => set('purchaseCosts', v ?? 0)}
                hint="Fees, delivery, fuel"
              />
              <Field label="Purchase date">
                <Input
                  type="date"
                  value={draft.purchaseDate ?? ''}
                  onChange={(e) => set('purchaseDate', e.target.value || null)}
                />
              </Field>
              <TextField
                label="Bought from"
                value={draft.purchaseSource}
                onChange={(v) => set('purchaseSource', v)}
                placeholder="e.g. Car boot sale, FB Marketplace"
              />
            </div>
          </Section>

          <Section title="Selling">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MoneyField
                label={`List price${perUnit}`}
                value={draft.listPrice}
                onChange={(v) => set('listPrice', v)}
              />
              <MoneyField
                label={`Estimated value${perUnit}`}
                value={draft.estimatedValue}
                onChange={(v) => set('estimatedValue', v)}
                hint="Use AI pricing on the item page to fill this"
              />
              <Field label="Listed on">
                <Input
                  list="platform-list"
                  value={draft.listingPlatform}
                  onChange={(e) => set('listingPlatform', e.target.value)}
                />
                <datalist id="platform-list">
                  {settings.platforms.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
              </Field>
              <TextField
                label="Listing URL"
                type="url"
                value={draft.listingUrl}
                onChange={(v) => set('listingUrl', v)}
                placeholder="https://"
              />
              <Field label={`Weight (${settings.weightUnit})`}>
                <NumberInput value={draft.weight} onChange={(v) => set('weight', v)} />
              </Field>
              <TextField
                label="Dimensions"
                value={draft.dimensions}
                onChange={(v) => set('dimensions', v)}
                placeholder="e.g. 30×20×10 cm"
              />
            </div>
          </Section>

          <Section title="Notes">
            <Textarea
              rows={4}
              value={draft.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Private notes (not used in listings unless you ask the AI to)"
            />
          </Section>

          <div className="flex flex-wrap justify-end gap-2 pb-6">
            <Button onClick={() => navigate(-1)}>Cancel</Button>
            {isNew && (
              <Button onClick={() => save(true)} disabled={saving}>
                Save & add another
              </Button>
            )}
            <Button type="submit" variant="primary" loading={saving}>
              {isNew ? 'Create item' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Page>
    </>
  );
}
