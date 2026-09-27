import { Link } from 'react-router';
import {
  ChevronRight,
  Cloud,
  Download,
  Settings,
  ShoppingCart,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/card';

const LINKS: { to: string; label: string; sub: string; icon: LucideIcon }[] = [
  { to: '/assistant', label: 'AI assistant', sub: 'Research, pricing, sourcing ideas', icon: Sparkles },
  { to: '/shopping', label: 'Shopping list', sub: 'Parts to buy for repairs', icon: ShoppingCart },
  { to: '/expenses', label: 'Expenses', sub: 'Packaging, fuel, fees, subscriptions', icon: Wallet },
  { to: '/settings', label: 'Settings', sub: 'Currency, location, fees, AI, marketplaces', icon: Settings },
  { to: '/settings#sync', label: 'Sync', sub: 'Google Drive', icon: Cloud },
  { to: '/settings#backup', label: 'Backup & restore', sub: 'Export or import all data', icon: Download },
];

export default function MorePage() {
  return (
    <>
      <PageHeader title="More" />
      <Page>
        <Card className="divide-y divide-border overflow-hidden">
          {LINKS.map(({ to, label, sub, icon: Icon }) => (
            <Link key={to} to={to} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <span className="grid size-9 place-items-center rounded-xl bg-accent/12 text-accent">
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block truncate text-xs text-subtle">{sub}</span>
              </span>
              <ChevronRight className="size-4 text-subtle" />
            </Link>
          ))}
        </Card>
      </Page>
    </>
  );
}
