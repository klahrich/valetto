import { VALETTO_URL, valettoMeta } from '@/components/site/valetto/seo';
import { agentDocs, gettingStartedMarkdown } from '@/lib/agent-docs';
import { DOCS_AGENT_SETUP } from '../DocsPage';
import { MarkdownGuide } from '../MarkdownGuide';

export const metadata = valettoMeta(DOCS_AGENT_SETUP, 'Register a coding agent', 'Register with a join code and connect your agent over MCP.');

export default function AgentSetupDocs() {
  return <MarkdownGuide path={DOCS_AGENT_SETUP} markdown={gettingStartedMarkdown(VALETTO_URL)} source={agentDocs.paths.gettingStarted} />;
}
