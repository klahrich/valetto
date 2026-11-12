import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = process.env.VALETTO_RELEASE_SIGNING_KEY;
if (!keyPath) {
  console.error('Set VALETTO_RELEASE_SIGNING_KEY to the ed25519 private key path.');
  process.exit(1);
}

const bundle = readFileSync(path.join(root, 'packages/cli/valetto.mjs'));
let pem;
try {
  pem = readFileSync(keyPath);
} catch {
  console.error('Could not read VALETTO_RELEASE_SIGNING_KEY.');
  process.exit(1);
}

let key;
try {
  key = createPrivateKey(pem);
} catch {
  console.error('VALETTO_RELEASE_SIGNING_KEY is not a valid private key.');
  process.exit(1);
}
if (key.asymmetricKeyType !== 'ed25519') {
  console.error('VALETTO_RELEASE_SIGNING_KEY must be an ed25519 key.');
  process.exit(1);
}

const signature = sign(null, bundle, key).toString('base64');
const out = path.join(root, 'public/valetto.mjs.sig');
writeFileSync(out, `${signature}\n`, { mode: 0o644 });
console.log(`wrote public/valetto.mjs.sig (${signature.length} chars)`);
