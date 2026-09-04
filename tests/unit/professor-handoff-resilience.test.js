import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Handoff = require('../../professor-handoff-resilience.js');

describe('ProfessorHandoffResilience', () => {
  it('keeps the ChatGPT URL payload bounded while preserving the full prompt separately', () => {
    const huge = 'unidad pianística '.repeat(2500);
    const core = {
      buildPrompt: () => `PROMPT COMPLETO\n${huge}`,
      compactContext: () => `CONTEXTO\n${huge}`,
    };
    const report = { units: Array.from({ length: 50 }, (_, i) => ({ key: String(i) })), events: [], priorities: [] };
    const built = Handoff.buildSafeChatGptUrl(report, { mode: 'now' }, core);

    expect(built.encodedLength).toBeLessThanOrEqual(Handoff.MAX_URL_ENCODED);
    expect(built.url.length).toBeLessThan(7600);
    expect(built.fullPrompt.length).toBeGreaterThan(built.promptForUrl.length);
    expect(built.truncated).toBe(true);
  });
});
