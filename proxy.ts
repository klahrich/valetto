import { NextResponse, type NextRequest } from 'next/server';
import { isUsageOwnerRequest } from '@/lib/usage-gate';

/**
 * Owner-only usage page. The public address is /admin/usage, and no route lives there. For the owner, this proxy
 * rewrites it to the real page at OWNER_ROUTE. Everyone else passes through untouched to the ordinary 404, so the
 * response (body, RSC payload and headers) is the same as any unknown path. There is no rewrite header to give it
 * away. A request for OWNER_ROUTE itself passes only for the owner; anyone else is sent to a path no route matches.
 * The page also checks the owner again (app/internal-usage/gate.ts).
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

function withOwnerHeaders(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(OWNER_HEADERS)) response.headers.set(name, value);
  return response;
}

function notFound(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = NOT_FOUND_REWRITE;
  url.search = '';
  return NextResponse.rewrite(url);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (pathname === OWNER_ROUTE || pathname.startsWith(`${OWNER_ROUTE}/`)) {
    // Reached directly, or again after the rewrite below if the host re-runs the proxy. No header can tell those
    // apart safely, so both get the same session check: the owner passes, everyone else gets the ordinary 404.
    if (pathname === OWNER_ROUTE && (await isUsageOwnerRequest(request))) return withOwnerHeaders(NextResponse.next());
    return notFound(request);
  }
  if (pathname === USAGE_PATH && (await isUsageOwnerRequest(request))) {
    const url = request.nextUrl.clone();
    url.pathname = OWNER_ROUTE;
    return withOwnerHeaders(NextResponse.rewrite(url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/usage', '/internal-usage', '/internal-usage/:path*'],
};
