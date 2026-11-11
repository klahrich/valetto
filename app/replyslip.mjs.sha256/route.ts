import { cliScriptSha256Line } from '@/lib/cli-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pre-rename address of /valetto.mjs.sha256. Same hash, with the file name an older download used. */
export function GET() {
  return new Response(cliScriptSha256Line('replyslip.mjs'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
