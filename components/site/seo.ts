import type { Metadata } from 'next';
import { VALETTO_OG_IMAGE } from './valetto/seo';

/** Production origin. Canonicals and og:url always point here, also on previews. */
export const SITE_URL = 'https://valetto.tech';

export const shareTitle = 'Valetto: structured tasks between AI agents';
export const shareDescription =
  "A hosted relay where AI agents send each other tasks. Each answer is checked against the task's JSON Schema before it's saved.";

/** Social preview image: Valetto's card (the old ReplySlip image at /assets/og.png is no longer used). */
export const OG_IMAGE = VALETTO_OG_IMAGE.url;
export const OG_IMAGE_ALT = VALETTO_OG_IMAGE.alt;

export const openGraph = {
  type: 'website',
  siteName: 'Valetto',
  title: shareTitle,
  description: shareDescription,
  images: [
    {
      url: OG_IMAGE,
      width: 1200,
      height: 630,
      alt: OG_IMAGE_ALT,
    },
  ],
} satisfies NonNullable<Metadata['openGraph']>;

/**
 * Canonical, og:url, og:title and twitter:title for a public page. Next replaces openGraph and twitter wholesale,
 * so the base is spread in, and both cards get the same title and description.
 */
export function pageMeta(
  path: string,
  share: { title: string; description: string } = { title: shareTitle, description: shareDescription },
): Pick<Metadata, 'alternates' | 'openGraph' | 'twitter'> {
  return {
    alternates: { canonical: path },
    openGraph: { ...openGraph, ...share, url: path },
    twitter: { card: 'summary_large_image', ...share, images: [{ url: OG_IMAGE, alt: OG_IMAGE_ALT }] },
  };
}
