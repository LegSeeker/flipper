import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Sparkles } from 'lucide-react';
import { updateItem } from '@/db/repo';
import type { Item } from '@/db/schema';
import { useAiContext } from '@/app/context';
import { generateListing, LISTING_PLATFORMS, type ListingPlatform, type ListingResult } from '@/ai/tasks';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { Badge } from '@/components/ui/badge';
import { AiErrorText, AiNotConfigured, useAiJob } from './common';
import { copyText, titleCase } from '@/lib/utils';

export function ListingPanel({ item }: { item: Item }) {
  const ai = useAiContext();
  const [title, setTitle] = useState(item.listingTitle);
  const [description, setDescription] = useState(item.listingDescription);
  const [platform, setPlatform] = useState<ListingPlatform>('ebay');
  const [extra, setExtra] = useState('');
  const job = useAiJob<ListingResult>();

  useEffect(() => {
    setTitle(item.listingTitle);
    setDescription(item.listingDescription);
  }, [item.listingTitle, item.listingDescription]);

  const dirty = title !== item.listingTitle || description !== item.listingDescription;

  const save = async () => {
    await updateItem(item.id, { listingTitle: title, listingDescription: description });
    toast.success('Listing text saved');
  };

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast.success(`${what} copied`);
    else toast.error('Could not copy — select the text manually');
  };

  const generate = async () => {
    const res = await job.run((signal) => generateListing(ai, item, platform, extra, signal));
    if (res) {
      setTitle(res.title);
      const specifics = res.itemSpecifics
        .filter((s) => s.name && s.value)
        .map((s) => `${s.name}: ${s.value}`);
      const bullets = res.bullets.map((b) => `• ${b}`);
      setDescription(
        [res.description, bullets.join('\n'), specifics.join('\n')].filter(Boolean).join('\n\n'),
      );
    }
  };

  const res = job.result;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Field
          htmlFor="listing-title"
          label={
            <span className="flex items-center justify-between">
              <span>Listing title</span>
              <span className={title.length > 80 ? 'text-loss' : 'text-subtle'}>{title.length}/80</span>
            </span>
          }
        >
          <div className="flex gap-2">
            <Input
              id="listing-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title buyers will search for"
            />
            <Button
              size="icon"
              aria-label="Copy title"
              onClick={() => copy(title, 'Title')}
              disabled={!title}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </Field>
        <Field label="Description">
          <Textarea
            rows={10}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Write or generate a description"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => copy(`${title}\n\n${description}`, 'Listing')}
            icon={<Copy className="size-4" />}
            disabled={!description && !title}
          >
            Copy all
          </Button>
          <Button variant="primary" onClick={save} disabled={!dirty}>
            Save listing text
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-surface-2/50 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-accent" /> Generate with AI
        </div>
        {!ai.configured ? (
          <AiNotConfigured compact />
        ) : (
          <>
            <Segmented
              size="sm"
              value={platform}
              onChange={setPlatform}
              options={LISTING_PLATFORMS.map((p) => ({
                value: p,
                label: p === 'ebay' ? 'eBay' : titleCase(p),
              }))}
            />
            <Input
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="Optional: tone, faults to mention, collection only, bundle offer…"
            />
            <Button onClick={generate} loading={job.loading} icon={<Sparkles className="size-4" />}>
              {res ? 'Regenerate' : 'Generate listing'}
            </Button>
            <AiErrorText message={job.error} />
            {res && (
              <div className="space-y-2 text-sm">
                {res.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {res.keywords.map((k) => (
                      <Badge key={k}>{k}</Badge>
                    ))}
                  </div>
                )}
                {res.suggestedCategory && (
                  <p className="text-muted">Suggested category: {res.suggestedCategory}</p>
                )}
                {res.photoTips.length > 0 && (
                  <p className="text-muted">Photo tips: {res.photoTips.join(' · ')}</p>
                )}
                <p className="text-xs text-subtle">
                  The generated text was placed in the fields above — review it, then save.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
