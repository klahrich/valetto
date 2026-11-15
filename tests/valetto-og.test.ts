import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';
import { PLAN_LIMITS } from '@/lib/plans';
import {
  AGENT_TO_AGENT_DESCRIPTION,
  AGENT_TO_AGENT_OG_IMAGE,
  AGENT_TO_AGENT_TITLE,
  SHARE_DESCRIPTION,
  SHARE_OG_IMAGE,
  SHARE_TITLE,
  VALETTO_DESCRIPTION,
  VALETTO_OG_IMAGE,
  VALETTO_PATHS,
  VALETTO_TITLE,
  valettoMeta,
} from '@/components/site/valetto/seo';

const ROOT = join(__dirname, '..');

describe('Valetto social image', () => {
  it('share text matches the agent-to-agent hero', () => {
    const page = readFileSync(join(ROOT, 'app/(site)/valetto/page.tsx'), 'utf8');
    const sub = (page.match(/<p className="vt-sub">([\s\S]*?)<\/p>/)?.[1] ?? '').replace(/\s+/g, ' ');
    expect(VALETTO_TITLE).toBe('Let other companies’ agents work with yours');
    expect(VALETTO_TITLE.length).toBeLessThanOrEqual(60);
    expect(VALETTO_TITLE.startsWith('Valetto')).toBe(false);
    expect(VALETTO_DESCRIPTION.length).toBeLessThanOrEqual(155);
    expect(VALETTO_DESCRIPTION).toContain('approve which companies can ask');
    expect(VALETTO_OG_IMAGE.alt).toBe('Valetto: Let other companies’ agents work with yours. On your terms, in the format you set.');
    expect(page).toContain('text="Let other companies’ agents work with yours."');
    expect(page).toContain('text="On your terms, in the format you set."');
    expect(sub).toContain('Valetto checks every answer before it leaves.');
    // The shop answering bot is gone from the homepage.
    expect(page).not.toMatch(/PhoneChat|Answer every customer|early access|7 hours/i);
  });

  it('is a 1200x630 PNG in public at the path the metadata uses', () => {
    const png = readFileSync(join(ROOT, 'public', VALETTO_OG_IMAGE.url));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it('pages without their own card share the homepage image on og and twitter', () => {
    for (const path of VALETTO_PATHS) {
      const image = path === '/agent-to-agent' ? AGENT_TO_AGENT_OG_IMAGE : path === '/share' ? SHARE_OG_IMAGE : VALETTO_OG_IMAGE;
      const meta = valettoMeta(path, 'T', 'D');
      expect(meta.openGraph?.images, path).toEqual([image]);
      expect(meta.twitter, path).toMatchObject({ card: 'summary_large_image', images: [image] });
    }
  });

  it('gives /agent-to-agent and /share their own card, title, and description', () => {
    expect(PLAN_LIMITS.free.tasksPerMonth).toBe(1000);
    expect(AGENT_TO_AGENT_TITLE).toBe('Share your AI agent with other agents · Valetto');
    expect(AGENT_TO_AGENT_DESCRIPTION).toBe(
      'Share your agent with a client or partner and choose exactly what they can ask. Answers come back in the format you set. Free for up to 1,000 tasks a month.',
    );
    expect(AGENT_TO_AGENT_DESCRIPTION).toContain(PLAN_LIMITS.free.tasksPerMonth.toLocaleString('en-US'));
    expect(`${AGENT_TO_AGENT_TITLE} ${AGENT_TO_AGENT_DESCRIPTION} ${AGENT_TO_AGENT_OG_IMAGE.alt}`).not.toMatch(/JSON Schema/i);
    expect(SHARE_OG_IMAGE.url).toBe('/valetto/og-share-v2.png');
    expect(SHARE_OG_IMAGE.alt).toBe('Valetto: Got a private link? Paste it into your agent.');
    expect(readFileSync(join(ROOT, 'components/site/valetto/seo.ts'), 'utf8')).not.toContain(['any', 'agent'].join(' '));
    expect(SHARE_TITLE).toBe('Share your agent · Valetto');
    expect(SHARE_DESCRIPTION).toBe(
      'Send a private link so an outside agent can ask yours for help. They need no Valetto account. You choose the tasks, the daily limit, and when access ends.',
    );
    expect(`${SHARE_TITLE} ${SHARE_DESCRIPTION} ${SHARE_OG_IMAGE.alt}`).not.toMatch(/JSON Schema/i);

    const agent = valettoMeta('/agent-to-agent', AGENT_TO_AGENT_TITLE, AGENT_TO_AGENT_DESCRIPTION);
    const share = valettoMeta('/share', SHARE_TITLE, SHARE_DESCRIPTION);
    const home = valettoMeta('/', VALETTO_TITLE, VALETTO_DESCRIPTION);
    const connect = valettoMeta('/connect', 'Connect ChatGPT, Claude or Cursor to Valetto over MCP', 'Connect ChatGPT, Claude, Cursor or another AI app to Valetto in a few steps. Paste one link, sign in and press Allow. No key needed.');

    for (const [meta, image, title, description] of [
      [agent, AGENT_TO_AGENT_OG_IMAGE, AGENT_TO_AGENT_TITLE, AGENT_TO_AGENT_DESCRIPTION],
      [share, SHARE_OG_IMAGE, SHARE_TITLE, SHARE_DESCRIPTION],
    ] as const) {
      expect(meta.title).toEqual({ absolute: title });
      expect(meta.description).toBe(description);
      expect(meta.openGraph).toMatchObject({ title, description, images: [image] });
      expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title, description, images: [image] });
      expect(image).toMatchObject({ width: 1200, height: 630 });
      expect(image.url).not.toBe(VALETTO_OG_IMAGE.url);
      expect(image.alt).not.toBe(VALETTO_OG_IMAGE.alt);
      expect(title).not.toBe(VALETTO_TITLE);
      expect(description).not.toBe(VALETTO_DESCRIPTION);
      const png = readFileSync(join(ROOT, 'public', image.url));
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    }

    expect(home.openGraph?.images).toEqual([VALETTO_OG_IMAGE]);
    expect(home.twitter).toMatchObject({ images: [VALETTO_OG_IMAGE] });
    expect(connect.openGraph?.images).toEqual([VALETTO_OG_IMAGE]);
    expect(connect.twitter).toMatchObject({ card: 'summary_large_image', images: [VALETTO_OG_IMAGE] });
    expect(readFileSync(join(ROOT, 'app/(site)/valetto/page.tsx'), 'utf8')).toContain('valettoMeta(\'/\', VALETTO_TITLE, VALETTO_DESCRIPTION)');
    expect(readFileSync(join(ROOT, 'app/(site)/connect/page.tsx'), 'utf8')).toContain("valettoMeta(");
    expect(readFileSync(join(ROOT, 'app/(site)/connect/page.tsx'), 'utf8')).not.toContain('og-agent-to-agent');
    expect(readFileSync(join(ROOT, 'app/(site)/connect/page.tsx'), 'utf8')).not.toContain('og-share');
  });

  it('is served as a static file on valetto.tech, with no redirect or rewrite in front of it', async () => {
    const urls = [VALETTO_OG_IMAGE.url, AGENT_TO_AGENT_OG_IMAGE.url, SHARE_OG_IMAGE.url];
    const matches = (rule: { source: string; has?: { type: string; value?: string }[] }, host: string, url: string) =>
      (rule.has ?? []).every((h) => h.type === 'host' && new RegExp(`^${h.value}$`).test(host)) &&
      Boolean(getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(url));
    const redirects = (await nextConfig.redirects?.()) ?? [];
    const rewrites = await nextConfig.rewrites?.();
    const beforeFiles = rewrites && !Array.isArray(rewrites) ? rewrites.beforeFiles : (rewrites ?? []);
    for (const url of urls) {
      expect(redirects.filter((r) => matches(r, 'valetto.tech', url)), url).toEqual([]);
      for (const host of ['valetto.tech', 'www.valetto.tech']) expect(beforeFiles.filter((r) => matches(r, host, url)), `${host} ${url}`).toEqual([]);
      // www.valetto.tech sends it one hop to the same file on valetto.tech (og:image is already absolute there).
      expect(redirects.filter((r) => matches(r, 'www.valetto.tech', url)).map((r) => r.destination), url).toEqual(['https://valetto.tech/:path']);
    }
  });
});
