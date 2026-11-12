import { cliScriptSignatureLine } from '@/lib/cli-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pre-rename address of /valetto.mjs.sig. Same signature bytes. */
export function GET() {
  return new Response(cliScriptSignatureLine(), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
