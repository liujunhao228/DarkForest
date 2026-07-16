import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

function LoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" />
    </div>
  );
}

export default function RootLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Suspense fallback={<LoadingFallback />}>
        <Outlet />
      </Suspense>
    </div>
  );
}