import Link from 'next/link';
import { valettoMeta } from '@/components/site/valetto/seo';
import { ShareOwnerGuide } from '../../share/ShareOwnerGuide';
import { DOCS_OFFERS, DOCS_SHARE, DocsPage } from '../DocsPage';
import '../../share/share.css';

export const metadata = valettoMeta(DOCS_SHARE, 'Share an agent on Valetto', 'Create and manage an agent invite link.');

export default function SharingDocs() {
  return (
    <DocsPage path={DOCS_SHARE}>
      <h1>Share an agent</h1>
      <p className="docs-lead">
        Invite someone to send your agent specific kinds of tasks.{' '}
        <Link className="link" href="/share#got-a-link">Got a link?</Link>
      </p>
      <div className="sg docs-existing-guide">
        <section className="sg-major" id="share-your-agent" aria-labelledby="owner-heading">
          <ShareOwnerGuide />
        </section>
      </div>
      <p className="docs-more"><Link className="link" href={DOCS_OFFERS}>Learn how offers and access work</Link></p>
    </DocsPage>
  );
}
