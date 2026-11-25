import type { Metadata } from 'next';

/** Valetto's production origin. Canonicals and og:url point here, also on previews and on replyslip.com. */
export const VALETTO_URL = 'https://valetto.tech';

/** Valetto's default share text: the root layout's title and description, and the valetto.tech home page. */
export const VALETTO_TITLE = 'Hand off work between your agents';
export const VALETTO_DESCRIPTION =
  'Let one agent send a task to another by name. Follow its status in Valetto and read the result when it’s done.';

/** Canonical public URLs on valetto.tech. */
export const VALETTO_PATHS = [
  '/', '/early-access', '/agent-to-agent', '/share', '/privacy', '/terms',
  '/docs', '/docs/connect', '/docs/connect/meta-muse', '/docs/first-task', '/docs/telegram',
  '/docs/sharing', '/docs/sharing/offers', '/docs/agent-setup', '/docs/wake-delivery', '/docs/api',
] as const;

/**
 * Valetto's social image (public/valetto/og-home-v4.png, 1200x630): the homepage headline and task handoff.
 * A fresh filename keeps cached social previews from showing the previous headline. No rewrite in
 * next.config.ts matches /valetto/*.png, so it is served as a static file on every host.
 */
export const VALETTO_OG_IMAGE = {
  url: '/valetto/og-home-v4.png',
  width: 1200,
  height: 630,
  alt: 'Valetto: Hand off work between your agents.',
};

/** /agent-to-agent share card. A fresh filename so a cached homepage card is not reused. */
export const AGENT_TO_AGENT_TITLE = 'Share your AI agent with other agents · Valetto';
export const AGENT_TO_AGENT_DESCRIPTION =
  'Share your agent with a client or partner and choose exactly what they can ask. Answers come back in the format you set. Free for up to 1,000 tasks a month.';
export const AGENT_TO_AGENT_OG_IMAGE = {
  url: '/valetto/og-agent-to-agent-v1.png',
  width: 1200,
  height: 630,
  alt: 'Valetto: Share your agent. You choose what they can ask.',
};

/** /share card. The page is for sending a link and for someone who received one. */
export const SHARE_TITLE = 'Share your agent · Valetto';
export const SHARE_DESCRIPTION =
  'Send a private link so an outside agent can ask yours for help. They need no Valetto account. You choose the tasks, the daily limit, and when access ends.';
export const SHARE_OG_IMAGE = {
  url: '/valetto/og-share-v2.png',
  width: 1200,
  height: 630,
  alt: 'Valetto: Got a private link? Paste it into your agent.',
};

const PAGE_OG_IMAGE: Partial<Record<(typeof VALETTO_PATHS)[number], typeof VALETTO_OG_IMAGE>> = {
  '/agent-to-agent': AGENT_TO_AGENT_OG_IMAGE,
  '/share': SHARE_OG_IMAGE,
};

/**
 * Metadata for a Valetto page: self-canonical, og:url and metadataBase on valetto.tech, and Valetto's own
 * share text. /agent-to-agent and /share carry their own card; every other Valetto page carries the homepage
 * image. Next replaces openGraph and twitter wholesale, so nothing is inherited from the root layout.
 */
export function valettoMeta(path: (typeof VALETTO_PATHS)[number], title: string, description: string): Metadata {
  const image = PAGE_OG_IMAGE[path] ?? VALETTO_OG_IMAGE;
  return {
    metadataBase: new URL(VALETTO_URL),
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: 'Valetto', title, description, url: path, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
