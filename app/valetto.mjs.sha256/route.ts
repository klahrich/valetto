import { cliScriptSha256Line } from '@/lib/cli-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(cliScriptSha256Line('valetto.mjs'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
