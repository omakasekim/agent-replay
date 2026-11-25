import { describe, expect, it } from 'vitest';
import {
  computeContextBudget,
  computeMcpStats,
  CONTEXT_BUDGET_PRESETS,
  DEMO_MCP_SERVERS,
} from '../src/core/contextAndMcp.ts';

describe('agent-replay Context Window X-Ray & MCP Topology Radar', () => {
  it('computes context window utilization and token savings from pruning and compression', () => {
    const preset = CONTEXT_BUDGET_PRESETS[0];
    const base = computeContextBudget(preset.segments, preset.windowLimit, preset.pricePerMillionUsd);
    expect(base.rawTotal).toBeGreaterThan(150_000);
    expect(base.savedTokens).toBeGreaterThan(0);

    const trimmed = preset.segments.map((s) => (s.category === 'mcp-schemas' ? { ...s, enabled: false } : s));
    const after = computeContextBudget(trimmed, preset.windowLimit, preset.pricePerMillionUsd);
    expect(after.effectiveTotal).toBeLessThan(base.effectiveTotal);
    expect(after.savedCostPer100TurnsUsd).toBeGreaterThan(base.savedCostPer100TurnsUsd);
  });

  it('aggregates MCP servers, tool schema tokens, and unused lazy-load candidates', () => {
    const stats = computeMcpStats(DEMO_MCP_SERVERS);
    expect(stats.serverCount).toBe(4);
    expect(stats.toolCount).toBeGreaterThanOrEqual(10);
    expect(stats.unusedSchemaTokens).toBeGreaterThan(0);
  });
});
