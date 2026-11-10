import { AGENT_DOC_CONTENT_TYPE, gettingStartedMarkdown } from '@/lib/agent-docs';
import { publicOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return new Response(gettingStartedMarkdown(publicOrigin(req)), {
    headers: {
      'content-type': AGENT_DOC_CONTENT_TYPE,
      'cache-control': 'no-store',
    },
  });
}
