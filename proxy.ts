import { NextResponse, type NextRequest } from 'next/server';
import { isUsageOwnerRequest } from '@/lib/usage-gate';

/**
 * Owner-only usage page. The public address is /admin/usage, and no route lives there. For the owner, this proxy
 * rewrites it to the real page at OWNER_ROUTE. Everyone else passes through untouched to the ordinary 404, so the
 * response (body, RSC payload and headers) is the same as any unknown path. There is no rewrite header to give it
 * away. A direct request to OWNER_ROUTE is always sent to a path no route matches; the page also checks the owner
 * again (app/internal-usage/gate.ts).
 */
export const USAGE_PATH = '/admin/usage';
export const OWNER_ROUTE = '/internal-usage';
export const NOT_FOUND_REWRITE = '/__valetto-not-found';

/** Only on the owner's response. */
export const OWNER_HEADERS: Readonly<Record<string, string>> = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
};

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (pathname === OWNER_ROUTE || pathname.startsWith(`${OWNER_ROUTE}/`)) {
    const url = request.nextUrl.clone();
    url.pathname = NOT_FOUND_REWRITE;
    url.search = '';
    return NextResponse.rewrite(url);
  }
  if (pathname === USAGE_PATH && (await isUsageOwnerRequest(request))) {
    const url = request.nextUrl.clone();
    url.pathname = OWNER_ROUTE;
    const response = NextResponse.rewrite(url);
    for (const [name, value] of Object.entries(OWNER_HEADERS)) response.headers.set(name, value);
    return response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/usage', '/internal-usage', '/internal-usage/:path*'],
};
