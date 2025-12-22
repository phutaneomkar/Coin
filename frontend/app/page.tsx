'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

export default function HomePage() {
  const router = useRouter();
  const supabase = createClient();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          router.replace('/dashboard');
        } else {
          router.replace('/login');
        }
      } catch (error) {
        router.replace('/login');
      } finally {
        setIsLoading(false);
      }
    };

    checkUser();
  }, [router, supabase]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return null;
}






