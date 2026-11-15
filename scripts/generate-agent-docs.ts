// Compiles docs/agent/*.md into lib/agent-docs.generated.ts. Run: npm run docs:generate
// `--check` exits 1 instead of writing when the generated file is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AGENT_DOC_GENERATED, renderGeneratedModule } from './agent-docs-codegen';

const root = process.cwd();
const target = path.join(root, AGENT_DOC_GENERATED);
const next = renderGeneratedModule(root);
let current = '';
try {
  current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
} catch {
  // First run: nothing to compare against.
}

if (process.argv.includes('--check')) {
  if (current !== next) {
    console.error(`${AGENT_DOC_GENERATED} is out of date. Run: npm run docs:generate`);
    process.exit(1);
  }
  console.log(`${AGENT_DOC_GENERATED} is up to date.`);
} else if (current === next) {
  console.log(`${AGENT_DOC_GENERATED} is up to date.`);
} else {
  writeFileSync(target, next);
  console.log(`wrote ${AGENT_DOC_GENERATED}`);
}
