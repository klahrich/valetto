import { cliScriptBytes } from '@/lib/cli-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pre-rename address of /valetto.mjs. Serves the same bytes so older setup commands keep working. */
export function GET() {
  return new Response(cliScriptBytes().toString('utf8'), {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
