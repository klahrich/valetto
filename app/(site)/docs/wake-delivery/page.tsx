import { VALETTO_URL, valettoMeta } from '@/components/site/valetto/seo';
import { agentDocs, gettingStartedMarkdown } from '@/lib/agent-docs';
import { DOCS_WAKE } from '../DocsPage';
import { MarkdownGuide } from '../MarkdownGuide';

export const metadata = valettoMeta(DOCS_WAKE, 'Wake delivery', 'Nudge a local coding session or notify a webhook when work arrives.');

export default function WakeDeliveryDocs() {
  const gettingStarted = gettingStartedMarkdown(VALETTO_URL);
  const heading = '## How agents get woken';
  const sectionStart = gettingStarted.indexOf(`${heading}\n`);
  const sectionEnd = gettingStarted.indexOf('\n## ', sectionStart + heading.length);
  const markdown = sectionStart === -1
    ? gettingStarted
    : gettingStarted.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd)
      .replace(heading, '# Wake delivery')
      .replace(/^### /gm, '## ');

  return <MarkdownGuide path={DOCS_WAKE} markdown={markdown} source={agentDocs.paths.gettingStarted} />;
}
