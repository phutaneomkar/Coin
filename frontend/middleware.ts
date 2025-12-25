import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const hasAccess = request.cookies.has('app_access');
  const path = request.nextUrl.pathname;

  // 1. If user has access cookie:
  if (hasAccess) {
    // Redirect /login -> /dashboard
    if (path === '/login') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    // Allow all other paths
    return NextResponse.next();
  }

  // 2. If user does NOT have access (and accessing protected route):
  // Protected routes are everything EXCEPT /login, / (landing), static assets, AND API routes
  const isPublicPath = path === '/login' || path === '/' || path.startsWith('/api/');

  if (!isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

