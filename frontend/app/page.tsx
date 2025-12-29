'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Middleware handles auth check. 
    // If we are here, we should try to go to dashboard.
    // If unauthenticated, middleware sends us to /login.
    // If authenticated, we go to /dashboard.
    // However, since this page is PUBLIC in middleware, we might be here while unauthenticated.
    // So we just try to go to dashboard.
    router.replace('/dashboard');
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center bg-gray-900">
      <LoadingSpinner size="lg" />
    </div>
  );
}











