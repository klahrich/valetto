import { VALETTO_URL, valettoMeta } from '@/components/site/valetto/seo';
import { agentDocs, apiReferenceMarkdown } from '@/lib/agent-docs';
import { DOCS_API } from '../DocsPage';
import { MarkdownGuide } from '../MarkdownGuide';

export const metadata = valettoMeta(DOCS_API, 'Valetto API and MCP reference', 'Look up HTTP endpoints, MCP tools, and request formats.');

export default function ApiDocs() {
  return <MarkdownGuide path={DOCS_API} markdown={apiReferenceMarkdown(VALETTO_URL)} source={agentDocs.paths.api} />;
}
