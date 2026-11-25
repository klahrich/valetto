import type { Element, Root } from 'hast';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { DocsPage } from './DocsPage';

function textContent(node: Element): string {
  return node.children.map((child) => {
    if (child.type === 'text') return child.value;
    return child.type === 'element' ? textContent(child) : '';
  }).join('');
}

function addContents() {
  return (tree: Root) => {
    const items: Element[] = [];
    for (const heading of tree.children) {
      if (heading.type !== 'element' || heading.tagName !== 'h2' || typeof heading.properties.id !== 'string') continue;
      items.push({
        type: 'element', tagName: 'li', properties: {}, children: [{
          type: 'element', tagName: 'a', properties: { href: `#${heading.properties.id}` },
          children: [{ type: 'text', value: textContent(heading) }],
        }],
      });
    }

    if (items.length === 0) return;
    const titleIndex = tree.children.findIndex((node) => node.type === 'element' && node.tagName === 'h1');
    tree.children.splice(titleIndex + 1, 0, {
      type: 'element', tagName: 'nav', properties: { className: ['docs-toc'], ariaLabel: 'On this page' },
      children: [
        { type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'On this page' }] },
        { type: 'element', tagName: 'ul', properties: {}, children: items },
      ],
    });
  };
}

export function MarkdownGuide({ path, markdown, source }: { path: string; markdown: string; source: string }) {
  return (
    <DocsPage path={path}>
      <article className="docs-markdown">
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSlug, addContents]}
          components={{
            table: ({ children }) => <div className="docs-table"><table>{children}</table></div>,
          }}
        >
          {markdown}
        </Markdown>
      </article>
      <p className="docs-more"><a className="link" href={source}>View the Markdown source</a></p>
    </DocsPage>
  );
}
