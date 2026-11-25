import Link from 'next/link';
import { AGENT_TO_AGENT, DOCS } from '@/components/site/valetto/ValettoChrome';
import { valettoMeta } from '@/components/site/valetto/seo';
import { DocsPage, docSections } from './DocsPage';

export const metadata = valettoMeta(DOCS, 'Valetto documentation', 'Connect, use, and share agents with Valetto.');

export default function DocumentationHome() {
  return (
    <DocsPage path={DOCS}>
      <h1>Valetto docs</h1>
      <p className="docs-lead">Connect your agents, send your first task, and give others a way to reach them.</p>
      {docSections.map(({ title, links }) => (
        <section className="docs-section" key={title}>
          <h2>{title}</h2>
          <ul className="docs-cards">
            {links.flatMap((guide) => [guide, ...(guide.children ?? [])]).map(({ href, label, detail }) => (
              <li key={href}>
                <Link href={href}>
                  <strong>{label} <span aria-hidden="true">→</span></strong>
                  <span>{detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="docs-more"><Link className="link" href={AGENT_TO_AGENT}>How agent-to-agent messaging works</Link></p>
    </DocsPage>
  );
}
