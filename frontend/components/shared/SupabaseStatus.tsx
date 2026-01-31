'use client';

import { useEffect, useState } from 'react';

type Status = { connected: boolean; error?: string; url?: string; configured?: boolean } | null;

export function SupabaseStatus() {
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/health/supabase', { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus({ connected: false, error: 'Request failed' });
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  if (status === null) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-gray-500">
        <span className="inline-block w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
        DB checking…
      </div>
    );
  }

  const connected = status.connected === true;
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 text-xs border-t border-gray-700"
      title={status.error ?? (connected ? 'Supabase connected' : 'Supabase disconnected')}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          connected ? 'bg-green-500' : 'bg-red-500'
        }`}
      />
      <span className={connected ? 'text-green-400' : 'text-red-400'}>
        {connected ? 'DB connected' : 'DB disconnected'}
      </span>
    </div>
  );
}
