import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const home = readFileSync(join(ROOT, 'app/(site)/valetto/page.tsx'), 'utf8');
const css = readFileSync(join(ROOT, 'components/site/valetto/valetto.css'), 'utf8');

describe('Valetto homepage agents link', () => {
  it('keeps Valetto for agents in the header, including the phone rules that hide other links', () => {
    expect(home).toContain('Valetto for agents');
    expect(home).toContain('href={AGENT_TO_AGENT}');
    expect(home).toContain('className="vt-nav-agents"');
    expect(home).not.toMatch(/vt-nav-agents[^>]*hidden|hidden[^>]*vt-nav-agents/);
    expect(css).toContain('.vt .top nav li.vt-nav-agents{display:list-item}');
    const phone = css.slice(css.indexOf('@media (max-width:420px){.vt .top nav li:not(:last-child)'));
    expect(phone).toContain('.vt .top nav li.vt-nav-agents{display:list-item}');
    const tablet = css.slice(css.indexOf('@media (max-width:760px)'));
    expect(tablet).toContain('.vt .top nav li.vt-nav-agents{display:list-item}');
  });
});
