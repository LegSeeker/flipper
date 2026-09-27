import { isRouteErrorResponse, useRouteError } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Shown instead of a blank screen if a page crashes. Data is safe in IndexedDB. */
export function ErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-loss/15 text-loss">
          <AlertTriangle className="size-6" />
        </div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted">
          Your data is safe — it's stored on this device. Try reloading; if it keeps happening, export a
          backup from Settings and report the message below.
        </p>
        <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 text-left text-xs text-subtle">
          {message}
        </pre>
        <div className="flex justify-center gap-2">
          <Button onClick={() => location.reload()} variant="primary">
            Reload
          </Button>
          <Button onClick={() => (location.hash = '#/settings')}>Open settings</Button>
        </div>
      </div>
    </div>
  );
}
