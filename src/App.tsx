import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { createHashRouter, RouterProvider } from 'react-router';
import { Toaster, toast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { AppProvider, useApp } from '@/app/context';
import { ConfirmProvider } from '@/components/ui/dialog';
import { AppShell } from '@/components/layout/AppShell';
import { Onboarding } from '@/components/layout/Onboarding';
import { ErrorPage } from '@/components/layout/ErrorPage';
import { db, requestPersistentStorage } from '@/db/db';
import { hasValidToken, syncWithDrive } from '@/sync/drive';

// Pages are split into separate chunks so the first load stays small on phones.
const page = (load: () => Promise<{ default: ComponentType }>) => {
  const C = lazy(load);
  return (
    <Suspense fallback={<div className="p-8" />}>
      <C />
    </Suspense>
  );
};

const router = createHashRouter([
  {
    element: <AppShell />,
    errorElement: <ErrorPage />,
    children: [
      { path: '/', element: page(() => import('@/pages/DashboardPage')) },
      { path: '/items', element: page(() => import('@/pages/ItemsPage')) },
      { path: '/items/new', element: page(() => import('@/pages/ItemEditPage')) },
      { path: '/items/:id', element: page(() => import('@/pages/ItemDetailPage')) },
      { path: '/items/:id/edit', element: page(() => import('@/pages/ItemEditPage')) },
      { path: '/projects', element: page(() => import('@/pages/ProjectsPage')) },
      { path: '/projects/new', element: page(() => import('@/pages/ProjectEditPage')) },
      { path: '/projects/:id', element: page(() => import('@/pages/ProjectDetailPage')) },
      { path: '/projects/:id/edit', element: page(() => import('@/pages/ProjectEditPage')) },
      { path: '/shopping', element: page(() => import('@/pages/ShoppingPage')) },
      { path: '/reports', element: page(() => import('@/pages/ReportsPage')) },
      { path: '/expenses', element: page(() => import('@/pages/ExpensesPage')) },
      { path: '/assistant', element: page(() => import('@/pages/AssistantPage')) },
      { path: '/settings', element: page(() => import('@/pages/SettingsPage')) },
      { path: '/labels', element: page(() => import('@/pages/LabelsPage')) },
      { path: '/more', element: page(() => import('@/pages/MorePage')) },
      { path: '*', element: page(() => import('@/pages/NotFoundPage')) },
    ],
  },
]);

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    if (!needRefresh) return;
    toast('A new version of Flipper is available', {
      duration: Infinity,
      action: { label: 'Update', onClick: () => void updateServiceWorker(true) },
    });
  }, [needRefresh, updateServiceWorker]);
  return null;
}

/** Background Google Drive sync while a Google session is active. */
function AutoSync() {
  const { local } = useApp();
  useEffect(() => {
    if (!local.autoSync || !local.googleClientId) return;
    const run = () => {
      if (hasValidToken() && navigator.onLine)
        void syncWithDrive(local.googleClientId, false).catch(() => undefined);
    };
    const timer = setInterval(run, 5 * 60_000);
    const onHide = () => document.visibilityState === 'hidden' && run();
    document.addEventListener('visibilitychange', onHide);
    run();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [local.autoSync, local.googleClientId]);
  return null;
}

function Themed() {
  const { settings } = useApp();
  const dark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    // Once the user has real data, ask the browser not to evict it.
    void db.items.count().then((n) => n > 0 && requestPersistentStorage());
  }, []);
  return (
    <>
      <RouterProvider router={router} />
      <Onboarding />
      <AutoSync />
      <UpdatePrompt />
      <Toaster
        theme={dark ? 'dark' : 'light'}
        position="top-center"
        richColors
        closeButton
        toastOptions={{ className: 'text-sm' }}
      />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <ConfirmProvider>
        <Themed />
      </ConfirmProvider>
    </AppProvider>
  );
}
