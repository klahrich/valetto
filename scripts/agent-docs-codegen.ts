import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The agent-facing docs are written as Markdown in docs/agent/ and compiled into
 * lib/agent-docs.generated.ts as plain string constants. lib/agent-docs.ts fills
 * their {{PLACEHOLDER}}s from code at request time.
 *
 * A committed TS module (rather than a raw `.md` import or an fs read at runtime)
 * works the same under Turbopack, webpack, Vitest and tsx, needs no loader config,
 * and leaves no file for Vercel's output tracing to miss.
 */
export const AGENT_DOC_SOURCES = {
  llms: 'llms.md',
  skill: 'skill.md',
  gettingStarted: 'getting-started.md',
  api: 'api.md',
} as const;

export const AGENT_DOC_DIR = 'docs/agent';
export const AGENT_DOC_GENERATED = 'lib/agent-docs.generated.ts';

/** Reads one source file. CRLF from a Windows checkout is folded to LF so the served bytes never depend on git settings. */
export function readAgentDocSource(root: string, file: string): string {
  return readFileSync(path.join(root, AGENT_DOC_DIR, file), 'utf8').replace(/\r\n/g, '\n');
}

/** The full text of lib/agent-docs.generated.ts for the Markdown currently in docs/agent/. */
export function renderGeneratedModule(root: string): string {
  const entries = Object.entries(AGENT_DOC_SOURCES).map(
    ([key, file]) => `  /** ${AGENT_DOC_DIR}/${file} */\n  ${key}: ${JSON.stringify(readAgentDocSource(root, file))},`,
  );
  return [
    `// Generated from ${AGENT_DOC_DIR}/*.md by scripts/generate-agent-docs.ts. Do not edit by hand.`,
    '// Edit the Markdown, then run `npm run docs:generate`. tests/agent-docs-templates.test.ts checks this file is current.',
    '',
    'export const AGENT_DOC_TEMPLATES = {',
    ...entries,
    '} as const;',
    '',
  ].join('\n');
}
