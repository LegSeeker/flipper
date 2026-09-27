import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { ArrowUp, Copy, MessageSquarePlus, RefreshCw, Square, Trash2 } from 'lucide-react';
import { db } from '@/db/db';
import { deleteConversation, saveConversation } from '@/db/repo';
import { ACTIVE_ITEM_STATUSES, type ChatMessage, type Conversation } from '@/db/schema';
import { useApp, useAiContext } from '@/app/context';
import { useLedger } from '@/app/data';
import { chat } from '@/ai/tasks';
import { businessSummary } from '@/ai/context';
import { refreshMany, type BulkProgress } from '@/ai/refresh';
import { hasProxy } from '@/integrations/proxy';
import { Markdown } from '@/lib/markdown';
import { copyText, cn, errorMessage, truncate } from '@/lib/utils';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, Progress } from '@/components/ui/card';
import { Checkbox, Select } from '@/components/ui/field';
import { Modal, useConfirm } from '@/components/ui/dialog';
import { AiErrorText, AiNotConfigured, useAiStream } from '@/components/ai/common';

const PROMPTS = [
  'What should I look out for to source this month, based on what sells best for me?',
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
  const [refreshOpen, setRefreshOpen] = useState(false);
  const stream = useAiStream();
  const confirm = useConfirm();
  const bottomRef = useRef<HTMLDivElement>(null);

  const context = useMemo(
    () => (data && withContext ? businessSummary(data.ds, data.ledger, settings.currency) : ''),
    [data, withContext, settings.currency],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, stream.text]);

  const open = (c: Conversation | null) => {
    stream.stop();
    setConvId(c?.id ?? null);
    setMessages(c?.messages ?? []);
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || stream.loading) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content, at: Date.now() }];
    setMessages(next);
    setInput('');
    const reply = await stream.start((signal) =>
      chat(
        ai,
        next.slice(-20).map((m) => ({ role: m.role, content: m.content })),
        context,
        signal,
      ),
    );
    const final = reply ? [...next, { role: 'assistant' as const, content: reply, at: Date.now() }] : next;
    setMessages(final);
    stream.setText('');
    const saved = await saveConversation({
      id: convId ?? undefined,
      title: convId ? undefined : truncate(content, 60),
      messages: final,
    });
    setConvId(saved.id);
  };

  return (
    <>
      <PageHeader
        title="AI assistant"
        subtitle={ai.configured ? `${settings.ai.model} · ${settings.ai.provider}` : 'Not configured'}
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
                  <Bubble
                    message={{ role: 'assistant', content: stream.text || '…', at: Date.now() }}
                    streaming
                  />
                )}
                <AiErrorText message={stream.error} />
                <div ref={bottomRef} />
              </div>

              <div className="pb-safe sticky bottom-16 bg-bg pt-2 lg:bottom-0">
                <Card className="p-2">
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
                    placeholder="Message the assistant…"
                    className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-subtle"
                  />
                  <div className="flex items-center justify-between gap-2 px-1">
                    <Checkbox
                      checked={withContext}
                      onChange={setWithContext}
                      label={<span className="text-xs text-muted">Share my inventory summary</span>}
                    />
                    {stream.loading ? (
                      <Button size="icon-sm" onClick={stream.stop} aria-label="Stop">
                        <Square className="size-4" />
                      </Button>
                    ) : (
                      <Button
                        size="icon-sm"
                        variant="primary"
                        onClick={() => send(input)}
                        disabled={!input.trim()}
                        aria-label="Send"
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                    )}
                  </div>
                </Card>
                <p className="mt-1 px-1 text-[11px] text-subtle">
                  Messages go to {new URL(settings.ai.baseUrl || 'https://x').hostname}. AI can be wrong —
                  verify prices before acting.
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

function Bubble({ message, streaming }: { message: ChatMessage; streaming?: boolean }) {
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
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <Markdown text={message.content} />
        )}
        {!mine && !streaming && (
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
          {useEbay ? ', using live eBay listings as comparables' : ''}. One request per item — this uses API
          credit.
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
