import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as esbuild from 'esbuild';
import type { Browser, Page } from 'playwright-core';

const LONG_NAME = 'A'.repeat(64);
const AGENT_ID = 'ag-long';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((p): p is string => !!p);

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright-core');
  const args = ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'];
  for (const executablePath of CHROME_CANDIDATES) {
    try {
      return await chromium.launch({ executablePath, headless: true, args });
    } catch {
      // try the next candidate
    }
  }
  try {
    return await chromium.launch({ channel: 'chrome', headless: true, args });
  } catch {
    return await chromium.launch({ headless: true, args });
  }
}

async function bundleHarness(): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [path.resolve('tests/dashboard-agents-overflow-harness.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { '@': path.resolve('.') },
    logOverride: { 'ignored-directive': 'silent' },
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error('esbuild produced no output');
  return file.text;
}

function pageHtml(js: string): string {
  const globals = readFileSync(path.resolve('app/globals.css'), 'utf8');
  const dash = readFileSync(path.resolve('components/dashboard/dashboard.css'), 'utf8');
  const workspace = readFileSync(path.resolve('components/dashboard/workspace.css'), 'utf8');
  return `<!doctype html>
<html lang="en" data-palette="a">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent overflow fixture</title>
  <style>${globals}\n${dash}\n${workspace}\nhtml,body{margin:0}</style>
</head>
<body>
  <div id="root"></div>
  <script>${js}</script>
</body>
</html>`;
}

async function mockPanelApis(page: Page) {
  const ok = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/api/v1/agents/*/wake-urls', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405, contentType: 'application/json', body: '{"error":"method"}' });
      return;
    }
    await route.fulfill(
      ok({
        wake_urls: [
          {
            id: 'wake-1',
            agent_id: AGENT_ID,
            prefix: 'wake_' + 'p'.repeat(24),
            created_at: '2026-11-01T12:00:00.000Z',
            revoked_at: null,
            last_used_at: null,
            status: 'active',
          },
        ],
      }),
    );
  });
  await page.route('**/api/v1/agents/*/telegram-links', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405, contentType: 'application/json', body: '{"error":"method"}' });
      return;
    }
    await route.fulfill(
      ok({
        telegram_links: [
          {
            id: 'tg-1',
            agent_id: AGENT_ID,
            prefix: 'vtg_' + 't'.repeat(24),
            created_at: '2026-11-01T12:00:00.000Z',
            revoked_at: null,
            last_used_at: null,
            status: 'active',
            connected_chats: 1,
          },
        ],
      }),
    );
  });
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const offenders = [...document.querySelectorAll('*')]
      .filter((el) => {
        if (el.classList.contains('vh')) return false;
        return el.getBoundingClientRect().width > root.clientWidth + 1;
      })
      .map((el) => ({
        tag: el.tagName,
        className: String((el as HTMLElement).className ?? '').slice(0, 80),
        width: Math.round(el.getBoundingClientRect().width),
      }));
    return {
      innerWidth: window.innerWidth,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      overflow: root.scrollWidth > root.clientWidth,
      offenders,
    };
  });
}

describe('expanded agent overflow', () => {
  let browser: Browser;
  let server: Server;
  let origin: string;
  let html: string;

  beforeAll(async () => {
    html = pageHtml(await bundleHarness());
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    });
    origin = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('failed to bind');
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });
    browser = await launchBrowser();
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server?.close((err) => (err ? reject(err) : resolve())));
  });

  it('keeps scrollWidth equal to the viewport when a 64-character name is expanded with wake and Telegram panels loaded', async () => {
    const page = await browser.newPage();
    await mockPanelApis(page);

    const shotDir = process.env.OVERFLOW_SHOT_DIR ?? tmpdir();

    for (const width of [360, 390] as const) {
      await page.setViewportSize({ width, height: 1600 });
      await page.goto(origin, { waitUntil: 'networkidle' });
      const toggle = page.getByRole('button', { name: new RegExp(LONG_NAME) });
      await toggle.waitFor();
      expect(await toggle.getAttribute('aria-expanded')).toBe('true');
      await page.getByRole('heading', { name: 'Wake link', exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Telegram', exact: true }).waitFor();
      await expect.poll(async () => page.getByText(`when ${LONG_NAME} has a new message`).count()).toBe(1);
      await expect.poll(async () => page.getByText(`message ${LONG_NAME} on Telegram`).count()).toBe(1);

      const result = await measure(page);
      if (width === 360) {
        await page.screenshot({ path: path.join(shotDir, 'expanded-360.png'), fullPage: true });
      }
      expect(result, `overflow at ${width}px`).toEqual({
        innerWidth: width,
        clientWidth: width,
        scrollWidth: width,
        overflow: false,
        offenders: [],
      });
    }

    await page.close();
  }, 30_000);
});
