import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Repo root, so `npm run build` in packages/cli and `node scripts/...` at the root both work.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'packages/cli/valetto.mjs');
const sigfile = path.join(root, 'public/valetto.mjs.sig');
const check = process.argv.includes('--check');
const { version } = JSON.parse(readFileSync(path.join(root, 'packages/cli/package.json'), 'utf8'));

const result = await build({
  entryPoints: [path.join(root, 'packages/cli/src/index.ts')],
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  define: { __VALETTO_VERSION__: JSON.stringify(version) },
  banner: {
    js: `#!/usr/bin/env node\n// Copyright (c) 2026 ClaireVue. All rights reserved.\n// valetto-cli-version: ${version}`,
  },
  legalComments: 'none',
  logLevel: 'silent',
  write: false,
});

const output = result.outputFiles?.[0]?.text;
if (!output) {
  console.error('esbuild produced no output.');
  process.exit(1);
}
const body = output.endsWith('\n') ? output : `${output}\n`;
const bytes = Buffer.from(body);

function pinnedPublicKeyPem() {
  const src = readFileSync(path.join(root, 'packages/cli/src/release-pubkey.ts'), 'utf8');
  const match = src.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/);
  if (!match) throw new Error('Pinned public key missing from packages/cli/src/release-pubkey.ts.');
  return `${match[0]}\n`;
}

function verifyBundleSignature(bundle, signatureText) {
  const compact = signatureText.trim().replace(/\s+/g, '');
  const sig = Buffer.from(compact, 'base64');
  if (sig.length !== 64) return false;
  try {
    return verify(null, bundle, createPublicKey(pinnedPublicKeyPem()), sig);
  } catch {
    return false;
  }
}

if (check) {
  const current = readFileSync(outfile, 'utf8');
  if (current !== body) {
    console.error('packages/cli/valetto.mjs is stale. Run: node scripts/bundle-valetto.mjs');
    process.exit(1);
  }
  let signature;
  try {
    signature = readFileSync(sigfile, 'utf8');
  } catch {
    console.error('public/valetto.mjs.sig is missing. Run: VALETTO_RELEASE_SIGNING_KEY=<path> node scripts/sign-valetto.mjs');
    process.exit(1);
  }
  if (!verifyBundleSignature(bytes, signature)) {
    console.error('public/valetto.mjs.sig does not verify for the current bundle.');
    process.exit(1);
  }
  process.exit(0);
}

writeFileSync(outfile, body, { mode: 0o644 });
const digest = createHash('sha256').update(body).digest('hex');
console.log(`${digest}  valetto.mjs`);
