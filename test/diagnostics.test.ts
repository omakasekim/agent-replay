import { describe, expect, it } from 'vitest';
import { DEMO_AGENT_SESSION_JSON } from '../src/core/demoSession.ts';
import { buildReplaySession } from '../src/core/parser.ts';
import { analyzeSessionEfficiency, formatSessionAuditMarkdown } from '../src/core/diagnostics.ts';

describe('agent-replay Efficiency & 6-Model Cost Comparator', () => {
  it('detects Edit->Fail->Edit thrash loops, calculates efficiency score, and compares 6 models', () => {
    const session = buildReplaySession(DEMO_AGENT_SESSION_JSON, { isDemo: true });
    const eff = analyzeSessionEfficiency(session);
    expect(eff.efficiencyScore).toBeGreaterThanOrEqual(15);
    expect(eff.efficiencyScore).toBeLessThanOrEqual(100);
    expect(eff.thrashLoops).toBeGreaterThanOrEqual(1);
    expect(eff.modelComparisons).toHaveLength(6);

    const md = formatSessionAuditMarkdown(session, eff);
    expect(md).toContain('## Model Cost Comparison');
    expect(md).toContain('Gemini 2.5 Flash');
  });
});
