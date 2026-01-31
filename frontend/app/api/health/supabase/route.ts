import { NextResponse } from 'next/server';
import { createClient } from '../../../../lib/supabase/server';

/** Mask URL for safe display (e.g. https://xxx...xxx.supabase.co) */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host.endsWith('.supabase.co')) {
      const ref = host.replace('.supabase.co', '');
      const masked = ref.length <= 4 ? '****' : ref.slice(0, 2) + '...' + ref.slice(-2);
      return `${u.protocol}//${masked}.supabase.co`;
    }
    return `${u.protocol}//***`;
  } catch {
    return '***';
  }
}

function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && (err as Error & { cause?: unknown }).cause != null
    ? String((err as Error & { cause?: unknown }).cause)
    : '';
  const combined = `${msg} ${cause}`.toLowerCase();
  return (
    combined.includes('enotfound') ||
    combined.includes('getaddrinfo') ||
    combined.includes('fetch failed') ||
    combined.includes('econnrefused') ||
    combined.includes('network')
  );
}

/**
 * GET /api/health/supabase
 * Returns whether Supabase is reachable and env is configured.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      {
        connected: false,
        error: 'Missing env: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY',
        configured: false,
        url: url ? maskUrl(url) : null,
      },
      { status: 200 }
    );
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch (createError) {
    return NextResponse.json(
      {
        connected: false,
        error: isNetworkError(createError)
          ? 'Cannot reach Supabase (check URL, DNS, or network).'
          : `Client init failed: ${createError instanceof Error ? createError.message : createError}`,
        configured: true,
        url: maskUrl(url),
      },
      { status: 200 }
    );
  }

  try {
    const { data, error } = await supabase.from('profiles').select('id').limit(1).maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          connected: false,
          error: `Query failed: ${error.message} (code: ${error.code})`,
          configured: true,
          url: maskUrl(url),
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      connected: true,
      configured: true,
      url: maskUrl(url),
      message: 'Supabase is connected.',
    });
  } catch (err) {
    return NextResponse.json(
      {
        connected: false,
        error: isNetworkError(err)
          ? 'Cannot reach Supabase (check URL, DNS, or network).'
          : `Request failed: ${err instanceof Error ? err.message : err}`,
        configured: true,
        url: maskUrl(url),
      },
      { status: 200 }
    );
  }
}
