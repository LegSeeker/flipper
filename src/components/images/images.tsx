import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { Camera, ChevronLeft, ChevronRight, ImageIcon, ImagePlus, Star, Trash2, X } from 'lucide-react';
import { db } from '@/db/db';
import { addImages, deleteImage, reorderImages, setPrimaryImage } from '@/db/repo';
import type { ID, ImageRecord, OwnerType } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export function useObjectUrl(blob: Blob | undefined | null): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** Square thumbnail for an image ID (or a placeholder). */
export function Thumb({
  imageId,
  className,
  alt = '',
}: {
  imageId: ID | null | undefined;
  className?: string;
  alt?: string;
}) {
  const img = useLiveQuery(() => (imageId ? db.images.get(imageId) : undefined), [imageId]);
  const url = useObjectUrl(img?.thumb);
  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 text-subtle',
        className,
      )}
    >
      {url ? (
        <img src={url} alt={alt} className="size-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <ImageIcon className="size-1/3 min-h-4 min-w-4" />
      )}
    </div>
  );
}

/** Preview of a photo that hasn't been saved yet. */
export function PendingThumb({
  file,
  onRemove,
  className,
}: {
  file: Blob;
  onRemove: () => void;
  className?: string;
}) {
  const url = useObjectUrl(file);
  return (
    <div className={cn('relative size-20 shrink-0 overflow-hidden rounded-xl bg-surface-2', className)}>
      {url && <img src={url} alt="" className="size-full object-cover" />}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function FullImage({ img, className }: { img: ImageRecord; className?: string }) {
  const url = useObjectUrl(img.blob);
  return url ? <img src={url} alt="" className={className} /> : null;
}

export function ImageUploadButtons({
  ownerType,
  ownerId,
  compact,
}: {
  ownerType: OwnerType;
  ownerId: ID;
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const res = await addImages(ownerType, ownerId, [...list]);
      if (res.added) toast.success(`${res.added} photo${res.added > 1 ? 's' : ''} added`);
      for (const err of res.errors) toast.error(err);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
      if (camRef.current) camRef.current.value = '';
    }
  };

  return (
    <div className="flex gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button
        size="sm"
        onClick={() => fileRef.current?.click()}
        loading={busy}
        icon={<ImagePlus className="size-4" />}
      >
        {compact ? 'Add' : 'Add photos'}
      </Button>
      <Button
        size="sm"
        onClick={() => camRef.current?.click()}
        disabled={busy}
        icon={<Camera className="size-4" />}
        className="sm:hidden"
      >
        Camera
      </Button>
    </div>
  );
}

export function ImageGallery({
  ownerType,
  ownerId,
  primaryId,
}: {
  ownerType: OwnerType;
  ownerId: ID;
  primaryId: ID | null;
}) {
  const images = useLiveQuery(
    () => db.images.where('[ownerType+ownerId]').equals([ownerType, ownerId]).sortBy('order'),
    [ownerType, ownerId],
  );
  const [viewer, setViewer] = useState<number | null>(null);
  const confirm = useConfirm();

  if (!images) return null;

  const move = async (index: number, dir: -1 | 1) => {
    const ids = images.map((i) => i.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await reorderImages(ids);
    setViewer(j);
  };

  const remove = async (img: ImageRecord) => {
    if (await confirm({ title: 'Delete photo?', confirmLabel: 'Delete', danger: true })) {
      await deleteImage(img.id);
      setViewer(null);
    }
  };

  const current = viewer !== null ? images[viewer] : undefined;

  return (
    <div>
      {images.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setViewer(i)}
              className="group relative aspect-square overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Thumb imageId={img.id} className="size-full rounded-none" />
              {img.id === primaryId && (
                <span className="absolute top-1 left-1 rounded-md bg-black/60 p-1 text-warn">
                  <Star className="size-3 fill-current" />
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-subtle">No photos yet.</p>
      )}
      <div className="mt-3">
        <ImageUploadButtons ownerType={ownerType} ownerId={ownerId} />
      </div>

      {current && viewer !== null && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          role="dialog"
          aria-label="Photo viewer"
          onKeyDown={(e) => e.key === 'Escape' && setViewer(null)}
        >
          <div className="pt-safe flex items-center justify-between gap-2 p-3 text-white">
            <span className="text-sm opacity-70">
              {viewer + 1} / {images.length}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={() => setPrimaryImage(ownerType, ownerId, current.id)}
                icon={<Star className={cn('size-4', current.id === primaryId && 'fill-warn text-warn')} />}
              >
                <span className="hidden sm:inline">Cover</span>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-white hover:bg-white/10"
                aria-label="Move left"
                onClick={() => move(viewer, -1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-white hover:bg-white/10"
                aria-label="Move right"
                onClick={() => move(viewer, 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-loss hover:bg-white/10"
                aria-label="Delete photo"
                onClick={() => remove(current)}
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-white hover:bg-white/10"
                aria-label="Close"
                onClick={() => setViewer(null)}
                autoFocus
              >
                <X className="size-5" />
              </Button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
            <FullImage img={current} className="max-h-full max-w-full object-contain" />
            {viewer > 0 && (
              <button
                type="button"
                aria-label="Previous"
                onClick={() => setViewer(viewer - 1)}
                className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white"
              >
                <ChevronLeft className="size-6" />
              </button>
            )}
            {viewer < images.length - 1 && (
              <button
                type="button"
                aria-label="Next"
                onClick={() => setViewer(viewer + 1)}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white"
              >
                <ChevronRight className="size-6" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
