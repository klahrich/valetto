import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  agentDocValues,
  apiReferenceMarkdown,
  gettingStartedMarkdown,
  llmsTxt,
  renderAgentDoc,
  skillMarkdown,
} from '@/lib/agent-docs';
import { AGENT_DOC_TEMPLATES } from '@/lib/agent-docs.generated';
import {
  AGENT_DOC_DIR,
  AGENT_DOC_GENERATED,
  AGENT_DOC_SOURCES,
  readAgentDocSource,
  renderGeneratedModule,
} from '@/scripts/agent-docs-codegen';

const ROOT = process.cwd();
const ORIGINS = ['https://preview.example', 'http://localhost:3000', ''];
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

describe('agent docs templates', () => {
  it('compiles every Markdown file in docs/agent and nothing else', () => {
    const onDisk = readdirSync(`${ROOT}/${AGENT_DOC_DIR}`).filter((name) => name.endsWith('.md')).sort();
    expect(onDisk).toEqual(Object.values(AGENT_DOC_SOURCES).sort());
  });

  it('keeps lib/agent-docs.generated.ts in sync with the Markdown (run npm run docs:generate)', () => {
    const committed = readFileSync(`${ROOT}/${AGENT_DOC_GENERATED}`, 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(renderGeneratedModule(ROOT));
    for (const [key, file] of Object.entries(AGENT_DOC_SOURCES)) {
      expect(AGENT_DOC_TEMPLATES[key as keyof typeof AGENT_DOC_TEMPLATES]).toBe(readAgentDocSource(ROOT, file));
    }
  });

  it('names only placeholders that exist in agentDocValues', () => {
    const known = new Set(Object.keys(agentDocValues('https://preview.example')));
    for (const [key, template] of Object.entries(AGENT_DOC_TEMPLATES)) {
      const names = [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);
      expect(names.length, key).toBeGreaterThan(0);
      for (const name of names) expect(known.has(name), `${key}: {{${name}}}`).toBe(true);
    }
  });

  it('renders every doc with no placeholder left, for every origin', () => {
    for (const origin of ORIGINS) {
      for (const render of [llmsTxt, skillMarkdown, gettingStartedMarkdown, apiReferenceMarkdown]) {
        const out = render(origin);
        expect(out, `${render.name}(${origin})`).not.toContain('{{');
      }
    }
  });

  it('fills placeholders from code values', () => {
    const values = agentDocValues('https://preview.example');
    expect(skillMarkdown('https://preview.example')).toContain(`curl -sL ${values.SKILL_URL}`);
    expect(apiReferenceMarkdown('')).toContain('"url": "https://<host>/api/mcp"');
    expect(renderAgentDoc('a {{ONE_LINER}} b {{FREE_AGENTS}}', values)).toBe(`a ${values.ONE_LINER} b ${values.FREE_AGENTS}`);
  });

  it('throws on an unknown or malformed placeholder', () => {
    const values = agentDocValues('https://preview.example');
    expect(() => renderAgentDoc('hello {{NOT_A_VALUE}}', values)).toThrow('Unknown placeholder {{NOT_A_VALUE}}');
    expect(() => renderAgentDoc('hello {{ ONE_LINER }}', values)).toThrow('Unknown placeholder');
    expect(() => renderAgentDoc('hello {{toString}}', values)).toThrow('Unknown placeholder');
    expect(() => renderAgentDoc('hello {{ONE_LINER', values)).toThrow('Unresolved "{{"');
  });
});
