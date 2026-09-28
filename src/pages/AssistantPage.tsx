import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import {
  ArrowUp,
  Camera,
  Copy,
  Globe,
  ImagePlus,
  Boxes,
  MessageSquarePlus,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import { db } from '@/db/db';
import { addImages, deleteConversation, saveConversation } from '@/db/repo';
import { ACTIVE_ITEM_STATUSES, type ChatMessage, type Conversation } from '@/db/schema';
import { AI_PROVIDER_PRESETS } from '@/db/defaults';
import { useApp, useAiContext } from '@/app/context';
import { useLedger } from '@/app/data';
import { chat } from '@/ai/tasks';
import { canSearch, photosEnabled, searchEnabled, type AiMessage } from '@/ai/client';
import { imagesByIdForAi, MAX_AI_PHOTOS } from '@/ai/images';
import { businessSummary } from '@/ai/context';
import { refreshMany, type BulkProgress } from '@/ai/refresh';
import { hasProxy } from '@/integrations/proxy';
import { Markdown } from '@/lib/markdown';
import { copyText, cn, errorMessage, truncate, uid } from '@/lib/utils';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, Progress } from '@/components/ui/card';
import { Checkbox, Select } from '@/components/ui/field';
import { Modal, useConfirm } from '@/components/ui/dialog';
import { PendingThumb, Thumb } from '@/components/images/images';
import {
  AiErrorText,
  AiNotConfigured,
  DataBasis,
  SourceList,
  TypingDots,
  useAiStream,
} from '@/components/ai/common';

/** Photos in the last few messages are re-sent so follow-up questions still "see" them. */
const PHOTO_HISTORY = 6;

const PROMPTS = [
  'What should I look out for to source this month, based on what sells best for me?',
  'What are used prices doing right now for the things I stock most?',
  'Which of my active items should I drop the price on, and by how much?',
  'Build a shopping list for a common laptop screen + battery refurb.',
  'What sells best when breaking a hatchback for parts?',
  'Write a short “bundle deal” message I can send to buyers.',
];

export default function AssistantPage() {
  const ai = useAiContext();
  const { settings, local } = useApp();
  const data = useLedger();
  const conversations = useLiveQuery(() => db.conversations.orderBy('updatedAt').reverse().toArray(), []);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [withContext, setWithContext] = useState(true);
  const [webOn, setWebOn] = useState(settings.ai.webSearch);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const stream = useAiStream();
  const confirm = useConfirm();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const searchAvailable = canSearch(ai.cfg);
  const photosOn = photosEnabled(ai.cfg);
  const providerLabel = AI_PROVIDER_PRESETS[settings.ai.provider]?.label ?? settings.ai.provider;

  const context = useMemo(
    () => (data && withContext ? businessSummary(data.ds, data.ledger, settings.currency) : ''),
    [data, withContext, settings.currency],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, stream.text, stream.status]);

  const open = (c: Conversation | null) => {
    stream.stop();
    setConvId(c?.id ?? null);
    setMessages(c?.messages ?? []);
    setAttachments([]);
  };

  const addFiles = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith('image/'));
    setAttachments((a) => {
      const next = [...a, ...files];
      if (next.length > MAX_AI_PHOTOS) toast.info(`Up to ${MAX_AI_PHOTOS} photos per message`);
      return next.slice(0, MAX_AI_PHOTOS);
    });
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
  };

  /** Conversation as sent to the model: recent turns, with photos from the last few messages. */
  const toHistory = async (list: ChatMessage[]): Promise<AiMessage[]> => {
    const recent = list.slice(-20);
    return Promise.all(
      recent.map(async (m, i) => {
        const photos = m.imageIds?.length ?? 0;
        const withPhotos = photos > 0 && i >= recent.length - PHOTO_HISTORY;
        const note = photos && !withPhotos ? ` [${photos} photo${photos > 1 ? 's' : ''} shared earlier]` : '';
        return {
          role: m.role,
          content: (m.content || (photos ? 'Here is a photo.' : '')) + note,
          images: withPhotos ? await imagesByIdForAi(ai.cfg, m.imageIds!) : undefined,
        };
      }),
    );
  };

  const send = async (text: string) => {
    const content = text.trim();
    if ((!content && !attachments.length) || stream.loading) return;
    const id = convId ?? uid();
    let imageIds: string[] = [];
    if (attachments.length) {
      const res = await addImages('chat', id, attachments);
      res.errors.forEach((e) => toast.error(e));
      imageIds = res.ids;
    }
    const next: ChatMessage[] = [
      ...messages,
      { role: 'user', content, at: Date.now(), ...(imageIds.length ? { imageIds } : {}) },
    ];
    setMessages(next);
    setInput('');
    setAttachments([]);
    // Save the question first so attached photos always belong to a saved chat.
    await saveConversation({
      id,
      title: convId ? undefined : truncate(content || 'Photo question', 60),
      messages: next,
    });
    setConvId(id);
    const history = await toHistory(next);
    const reply = await stream.start((signal) => chat(ai, history, context, { signal, search: webOn }));
    if (!reply.text) return;
    const final: ChatMessage[] = [
      ...next,
      {
        role: 'assistant',
        content: reply.text,
        at: Date.now(),
        searched: reply.searched,
        ...(reply.sources.length ? { sources: reply.sources } : {}),
      },
    ];
    setMessages(final);
    stream.reset();
    await saveConversation({ id, messages: final });
  };

  return (
    <>
      <PageHeader
        title="AI assistant"
        subtitle={ai.configured ? `${settings.ai.model} · ${providerLabel}` : 'Not configured'}
        actions={
          <>
            {ai.configured && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh market prices"
                title="Refresh market prices"
                onClick={() => setRefreshOpen(true)}
              >
                <RefreshCw className="size-5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label="New chat" onClick={() => open(null)}>
              <MessageSquarePlus className="size-5" />
            </Button>
          </>
        }
      />
      <Page className="flex flex-col">
        {!ai.configured ? (
          <AiNotConfigured />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
            <aside className="hidden space-y-1 lg:block">
              <div className="mb-2 text-xs font-medium text-subtle">Chats</div>
              {(conversations ?? []).map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'group flex items-center rounded-xl',
                    c.id === convId ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
                    onClick={() => open(c)}
                  >
                    {c.title}
                  </button>
                  <button
                    type="button"
                    aria-label="Delete chat"
                    className="px-2 text-subtle opacity-0 group-hover:opacity-100 hover:text-loss"
                    onClick={async () => {
                      if (await confirm({ title: 'Delete chat?', danger: true, confirmLabel: 'Delete' })) {
                        await deleteConversation(c.id);
                        if (c.id === convId) open(null);
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              {!conversations?.length && <p className="px-3 text-sm text-subtle">No chats yet</p>}
            </aside>

            <div className="flex min-h-[calc(100dvh-12rem)] flex-col">
              {conversations && conversations.length > 0 && (
                <Select
                  className="mb-3 lg:hidden"
                  value={convId ?? ''}
                  onChange={(e) => open(conversations.find((c) => c.id === e.target.value) ?? null)}
                  aria-label="Chat"
                >
                  <option value="">New chat</option>
                  {conversations.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              )}

              <div className="flex-1 space-y-4 pb-4">
                {!messages.length && !stream.loading && (
                  <div className="space-y-3 py-6">
                    <p className="text-sm text-muted">
                      Ask about product research, pricing, what to source, repairs, part-outs or listing copy.
                    </p>
                    <div className="flex flex-col gap-2">
                      {PROMPTS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => send(p)}
                          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-sm hover:border-accent/50"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <Bubble key={i} message={m} />
                ))}
                {stream.loading && (
                  <div className="flex justify-start">
                    <div className="max-w-[88%] rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm">
                      {stream.text && <Markdown text={stream.text} />}
                      {(!stream.text || stream.status) && (
                        <TypingDots
                          label={stream.status || (stream.searched ? 'Thinking — may search the web…' : '')}
                          className={cn('py-1', stream.text && 'mt-2')}
                        />
                      )}
                    </div>
                  </div>
                )}
                <AiErrorText message={stream.error} />
                <div ref={bottomRef} />
              </div>

              <div className="pb-safe sticky bottom-16 bg-bg pt-2 lg:bottom-0">
                <Card className="p-2">
                  {attachments.length > 0 && (
                    <div className="no-scrollbar flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
                      {attachments.map((f, i) => (
                        <PendingThumb
                          key={i}
                          file={f}
                          className="size-14"
                          onRemove={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                        />
                      ))}
                    </div>
                  )}
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void send(input);
                      }
                    }}
                    rows={2}
                    placeholder={
                      photosOn ? 'Message the assistant or add a photo…' : 'Message the assistant…'
                    }
                    className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-subtle"
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => addFiles(e.target.files)}
                  />
                  <input
                    ref={camRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(e) => addFiles(e.target.files)}
                  />
                  <div className="flex items-center justify-between gap-2 px-1">
                    <div className="flex min-w-0 items-center gap-1">
                      {photosOn && (
                        <>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Attach photos"
                            title="Attach photos"
                            onClick={() => fileRef.current?.click()}
                          >
                            <ImagePlus className="size-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Take a photo"
                            className="sm:hidden"
                            onClick={() => camRef.current?.click()}
                          >
                            <Camera className="size-4" />
                          </Button>
                        </>
                      )}
                      {searchAvailable && (
                        <Toggle
                          on={webOn}
                          onChange={setWebOn}
                          icon={<Globe className="size-3.5" />}
                          label="Web"
                          title="Let the assistant search the web for live prices"
                        />
                      )}
                      <Toggle
                        on={withContext}
                        onChange={setWithContext}
                        icon={<Boxes className="size-3.5" />}
                        label="My data"
                        title="Share a summary of your inventory and sales"
                      />
                    </div>
                    {stream.loading ? (
                      <Button size="icon-sm" onClick={stream.stop} aria-label="Stop">
                        <Square className="size-4" />
                      </Button>
                    ) : (
                      <Button
                        size="icon-sm"
                        variant="primary"
                        onClick={() => send(input)}
                        disabled={!input.trim() && !attachments.length}
                        aria-label="Send"
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                    )}
                  </div>
                </Card>
                <p className="mt-1 px-1 text-[11px] text-subtle">
                  Messages go to {new URL(settings.ai.baseUrl || 'https://x').hostname}.{' '}
                  {searchEnabled(ai.cfg, webOn)
                    ? 'Prices found on the web are marked live; everything else is an estimate.'
                    : searchAvailable
                      ? 'Web search is off — prices are estimates.'
                      : `${providerLabel} can't search the web here — prices are estimates.`}{' '}
                  Verify before acting.
                </p>
              </div>
            </div>
          </div>
        )}
      </Page>
      {data && (
        <RefreshDialog
          open={refreshOpen}
          onClose={() => setRefreshOpen(false)}
          candidates={data.ds.items.filter((i) => !i.archived && ACTIVE_ITEM_STATUSES.includes(i.status))}
          useEbayAvailable={hasProxy({ proxyUrl: settings.proxyUrl, proxyToken: local.proxyToken })}
        />
      )}
    </>
  );
}

function Toggle({
  on,
  onChange,
  icon,
  label,
  title,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  icon: ReactNode;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
        on ? 'border-accent/40 bg-accent/12 text-accent' : 'border-border text-subtle hover:text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.role === 'user';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'group relative max-w-[88%] rounded-2xl px-4 py-2.5 text-sm',
          mine ? 'bg-accent text-accent-fg' : 'border border-border bg-surface',
        )}
      >
        {mine ? (
          <>
            {!!message.imageIds?.length && (
              <div className="mb-2 flex flex-wrap justify-end gap-1.5">
                {message.imageIds.map((id) => (
                  <Thumb key={id} imageId={id} className="size-20" alt="Attached photo" />
                ))}
              </div>
            )}
            {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
          </>
        ) : (
          <>
            <Markdown text={message.content} />
            {message.searched !== undefined && (
              <div className="mt-3 space-y-2 border-t border-border pt-2">
                <DataBasis searched={message.searched} sources={message.sources ?? []} />
                <SourceList sources={message.sources ?? []} />
              </div>
            )}
          </>
        )}
        {!mine && (
          <button
            type="button"
            aria-label="Copy"
            onClick={async () => (await copyText(message.content)) && toast.success('Copied')}
            className="absolute -bottom-3 right-2 rounded-lg border border-border bg-surface p-1 text-subtle opacity-0 group-hover:opacity-100 hover:text-fg"
          >
            <Copy className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function RefreshDialog({
  open,
  onClose,
  candidates,
  useEbayAvailable,
}: {
  open: boolean;
  onClose: () => void;
  candidates: import('@/db/schema').Item[];
  useEbayAvailable: boolean;
}) {
  const { settings, local } = useApp();
  const ai = useAiContext();
  const [onlyStale, setOnlyStale] = useState(true);
  const [useEbay, setUseEbay] = useState(useEbayAvailable);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const list = candidates.filter((i) => !onlyStale || !i.marketCheckedAt || i.marketCheckedAt < weekAgo);
  const running = progress !== null && progress.done < progress.total && !ctrl.current?.signal.aborted;

  const start = async () => {
    ctrl.current = new AbortController();
    try {
      const res = await refreshMany(
        list,
        { settings, local, ctx: ai, useEbay, signal: ctrl.current.signal },
        setProgress,
      );
      toast.success(`Updated ${res.done - res.errors.length} of ${res.total} items`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        ctrl.current?.abort();
        setProgress(null);
        onClose();
      }}
      title="Refresh market prices"
      footer={
        running ? (
          <Button onClick={() => ctrl.current?.abort()}>Stop</Button>
        ) : (
          <Button variant="primary" onClick={start} disabled={!list.length}>
            Refresh {list.length} items
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          Asks the AI for a fresh estimate for each active item
          {useEbay ? ', using live eBay listings as comparables' : ''}
          {searchEnabled(ai.cfg)
            ? ', searching the web for current prices'
            : ' (no web search — estimates only)'}
          . One request per item — this uses API credit.
        </p>
        <Checkbox
          checked={onlyStale}
          onChange={setOnlyStale}
          label="Only items not checked in the last 7 days"
        />
        {useEbayAvailable && (
          <Checkbox checked={useEbay} onChange={setUseEbay} label="Fetch eBay listings first (via proxy)" />
        )}
        {progress && (
          <div className="space-y-2">
            <Progress value={progress.total ? progress.done / progress.total : 0} />
            <p className="text-xs text-subtle">
              {progress.done}/{progress.total} {progress.current && running ? `· ${progress.current}` : ''}
            </p>
            {progress.errors.map((e, i) => (
              <p key={i} className="text-xs text-loss">
                {e}
              </p>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
