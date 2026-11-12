import { cliScriptSha256, cliScriptVersion } from '@/lib/cli-script';
import { handle, json } from '@/lib/http';
import { absoluteUrl, publicOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public. The sha256 is of the served /valetto.mjs (and /replyslip.mjs) bytes. */
export function GET(req: Request) {
  return handle(async () => {
    return json(
      {
        version: cliScriptVersion(),
        sha256: cliScriptSha256(),
        url: absoluteUrl(publicOrigin(req), '/valetto.mjs'),
      },
      200,
      { 'cache-control': 'public, max-age=300' },
    );
  });
}
