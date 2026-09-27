import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: string | boolean;
  actions?: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  return (
    <header
      className={cn(
        'no-print pt-safe sticky top-0 z-20 border-b border-border/60 bg-bg/85 backdrop-blur-lg lg:static lg:border-0 lg:bg-transparent lg:backdrop-blur-none',
        className,
      )}
    >
      <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-2 px-4 py-2 lg:min-h-16 lg:px-8 lg:pt-6">
        {back && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
            className="-ml-2"
          >
            <ArrowLeft className="size-5" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight lg:text-2xl">{title}</h1>
          {subtitle && <div className="truncate text-xs text-subtle lg:text-sm">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
    </header>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto max-w-6xl space-y-4 px-4 pt-4 lg:px-8', className)}>{children}</div>;
}
