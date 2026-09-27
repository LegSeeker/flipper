import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  BarChart3,
  Boxes,
  FolderKanban,
  LayoutDashboard,
  Menu as MenuIcon,
  Plus,
  Receipt,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  Sparkles,
  Tag,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/dialog';
import { SearchDialog } from './SearchDialog';
import { SaleDialog } from '@/components/sales/SaleDialog';
import { ExpenseDialog } from '@/components/expenses/ExpenseDialog';
import { Logo } from './Logo';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/items', label: 'Items', icon: Boxes },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/shopping', label: 'Shopping list', icon: ShoppingCart },
  { to: '/reports', label: 'Stats & reports', icon: BarChart3 },
  { to: '/expenses', label: 'Expenses', icon: Wallet },
  { to: '/assistant', label: 'AI assistant', icon: Sparkles },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

const MOBILE_NAV = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/items', label: 'Items', icon: Boxes },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/reports', label: 'Stats', icon: BarChart3 },
  { to: '/more', label: 'More', icon: MenuIcon },
];

export function AppShell() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const quick = (fn: () => void) => () => {
    setQuickOpen(false);
    fn();
  };
  const hideFab =
    /\/(new|edit)$/.test(location.pathname) ||
    location.pathname === '/assistant' ||
    location.pathname === '/labels';

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <Logo className="size-8" />
          <span className="text-lg font-semibold tracking-tight">Flipper</span>
        </div>
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-sm text-subtle hover:text-fg"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="rounded bg-surface-3 px-1.5 text-[10px]">Ctrl K</kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                  isActive ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              <Icon className="size-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 p-3">
          <button
            type="button"
            onClick={() => setQuickOpen(true)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-medium text-accent-fg hover:brightness-110"
          >
            <Plus className="size-4" /> Quick add
          </button>
        </div>
      </aside>

      <main className="pb-24 lg:pb-10">
        <Outlet context={{ openSearch: () => setSearchOpen(true) }} />
      </main>

      {/* Mobile quick-add button */}
      {!hideFab && (
        <button
          type="button"
          aria-label="Quick add"
          onClick={() => setQuickOpen(true)}
          className="no-print fixed right-4 z-30 grid size-14 place-items-center rounded-2xl bg-accent text-accent-fg shadow-lg shadow-accent/30 active:scale-95 lg:hidden"
          style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }}
        >
          <Plus className="size-6" />
        </button>
      )}

      {/* Mobile bottom navigation */}
      <nav className="no-print pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/90 backdrop-blur-lg lg:hidden">
        <div className="mx-auto grid h-16 max-w-lg grid-cols-5">
          {MOBILE_NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-1 text-[11px] font-medium',
                  isActive ? 'text-accent' : 'text-subtle',
                )
              }
            >
              <Icon className="size-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />

      <Modal open={quickOpen} onClose={() => setQuickOpen(false)} title="Quick add" size="sm">
        <div className="grid grid-cols-2 gap-2">
          <QuickTile icon={<Boxes />} label="New item" onClick={quick(() => navigate('/items/new'))} />
          <QuickTile
            icon={<FolderKanban />}
            label="New project"
            onClick={quick(() => navigate('/projects/new'))}
          />
          <QuickTile icon={<Tag />} label="Record sale" onClick={quick(() => setSaleOpen(true))} />
          <QuickTile icon={<Receipt />} label="Add expense" onClick={quick(() => setExpenseOpen(true))} />
          <QuickTile icon={<Sparkles />} label="Ask AI" onClick={quick(() => navigate('/assistant'))} />
          <QuickTile icon={<Search />} label="Find item" onClick={quick(() => setSearchOpen(true))} />
        </div>
      </Modal>

      <SaleDialog open={saleOpen} onClose={() => setSaleOpen(false)} />
      <ExpenseDialog open={expenseOpen} onClose={() => setExpenseOpen(false)} />
    </div>
  );
}

function QuickTile({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface-2 p-4 text-sm font-medium hover:border-accent/50 hover:bg-surface-3 [&_svg]:size-6 [&_svg]:text-accent"
    >
      {icon}
      {label}
    </button>
  );
}
