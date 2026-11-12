import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GET as scriptRoute } from '@/app/valetto.mjs/route';
import { GET as shaRoute } from '@/app/valetto.mjs.sha256/route';
import { GET as legacyScriptRoute } from '@/app/replyslip.mjs/route';
import { GET as legacyShaRoute } from '@/app/replyslip.mjs.sha256/route';
import { cliScriptPath } from '@/lib/cli-script';

const execFileAsync = promisify(execFile);

describe('served valetto.mjs', () => {
  it('matches the bundle, the sha256 route, and a Node syntax check', async () => {
    await execFileAsync(process.execPath, ['scripts/bundle-valetto.mjs', '--check']);
    const bytes = readFileSync(cliScriptPath());
    const digest = createHash('sha256').update(bytes).digest('hex');

    const script = await scriptRoute();
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    const body = Buffer.from(await script.arrayBuffer());
    expect(Buffer.compare(body, bytes)).toBe(0);
    expect(body.toString('utf8')).toContain('// Copyright (c) 2026 ClaireVue. All rights reserved.');
    expect(body.toString('utf8')).toContain('watch');
    expect(body.toString('utf8')).toContain('register');
    expect(body.toString('utf8')).not.toContain('rsk_');
    expect(body.toString('utf8')).not.toContain('rsw_');

    const sha = await shaRoute();
    expect(sha.status).toBe(200);
    expect(sha.headers.get('content-type')).toContain('text/plain');
    expect(await sha.text()).toBe(`${digest}  valetto.mjs\n`);

    await execFileAsync(process.execPath, ['--check', cliScriptPath()]);
    let code = 0;
    let output = '';
    try {
      const ok = await execFileAsync(process.execPath, [cliScriptPath()], { encoding: 'utf8' });
      output = `${ok.stdout}${ok.stderr}`;
    } catch (err) {
      const failure = err as { code?: number; stdout?: string; stderr?: string };
      code = typeof failure.code === 'number' ? failure.code : 1;
      output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }
    expect(code).toBe(1);
    expect(output).toContain('Usage: valetto');
  });

  it('still serves the same bytes at the pre-rename /replyslip.mjs, with a checksum line for that file name', async () => {
    const bytes = readFileSync(cliScriptPath());
    const digest = createHash('sha256').update(bytes).digest('hex');
    const script = await legacyScriptRoute();
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(Buffer.compare(Buffer.from(await script.arrayBuffer()), bytes)).toBe(0);
    const sha = await legacyShaRoute();
    expect(await sha.text()).toBe(`${digest}  replyslip.mjs\n`);
  });

  it('keeps scripts/bundle-replyslip.mjs as an alias of the bundle check', async () => {
    await execFileAsync(process.execPath, ['scripts/bundle-replyslip.mjs', '--check']);
  });
});
