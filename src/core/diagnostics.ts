import type { ReplaySession } from './types.ts';

export interface ModelPricing {
  id: string;
  label: string;
  inputPerM: number;
  cacheReadPerM: number;
  outputPerM: number;
}

export const MODEL_PRICING_TABLE: ModelPricing[] = [
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', inputPerM: 3.0, cacheReadPerM: 0.3, outputPerM: 15.0 },
  { id: 'claude-opus-4-1', label: 'Claude Opus 4.1', inputPerM: 15.0, cacheReadPerM: 1.5, outputPerM: 75.0 },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', inputPerM: 1.25, cacheReadPerM: 0.125, outputPerM: 10.0 },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', inputPerM: 0.3, cacheReadPerM: 0.03, outputPerM: 2.5 },
  { id: 'gpt-4.1', label: 'GPT-4.1', inputPerM: 2.0, cacheReadPerM: 0.5, outputPerM: 8.0 },
  { id: 'o3-mini', label: 'o3-mini', inputPerM: 1.1, cacheReadPerM: 0.55, outputPerM: 4.4 },
];

export interface ModelCostComparison {
  id: string;
  label: string;
  totalUsd: number;
  deltaVsBasePct: number;
}

export interface SessionEfficiencyReport {
  efficiencyScore: number;
  cacheHitPct: number;
  thrashLoops: number;
  wastedTokens: number;
  wastedUsd: number;
  recommendations: string[];
  modelComparisons: ModelCostComparison[];
}

export function estimateCostForModel(session: ReplaySession, pricing: ModelPricing): number {
  const { inputTokens, cacheReadTokens, outputTokens } = session.totals;
  const usd =
    (inputTokens * pricing.inputPerM +
      cacheReadTokens * pricing.cacheReadPerM +
      outputTokens * pricing.outputPerM) /
    1_000_000;
  return Number(usd.toFixed(4));
}

export function analyzeSessionEfficiency(session: ReplaySession): SessionEfficiencyReport {
  const denom = session.totals.inputTokens + session.totals.cacheReadTokens;
  const cacheHitPct = denom > 0 ? Math.round((session.totals.cacheReadTokens / denom) * 100) : 0;

  let thrashLoops = 0;
  let wastedTokens = 0;
  let wastedUsd = 0;
  for (let i = 0; i < session.steps.length; i++) {
    const s = session.steps[i];
    if (s.outcome === 'fail') {
      wastedTokens += s.inputTokens + s.outputTokens;
      wastedUsd += s.costUsd;
      const prevEdit = [...session.steps.slice(Math.max(0, i - 3), i)].reverse().find((p) => p.kind === 'edit');
      const nextEdit = session.steps.slice(i + 1, Math.min(session.steps.length, i + 4)).find((p) => p.kind === 'edit');
      if (prevEdit && nextEdit && prevEdit.targetFile === nextEdit.targetFile) {
        thrashLoops += 1;
      }
    }
  }

  let score = 100;
  score -= session.totals.failedCommands * 11;
  score -= thrashLoops * 12;
  score -= session.totals.thrashFiles * 7;
  if (cacheHitPct < 40) score -= 10;
  const efficiencyScore = Math.max(15, Math.min(100, score));

  const recommendations: string[] = [];
  if (thrashLoops > 0) {
    recommendations.push(`Detected ${thrashLoops} Edit→Fail→Edit thrash loop(s). Run targeted typecheck/unit test before large multi-file edits.`);
  }
  if (session.totals.thrashFiles > 0) {
    const hottest = session.heatmap[0];
    if (hottest) {
      recommendations.push(`"${hottest.path}" was edited ${hottest.edits}× (${hottest.reads} reads) — batch related edits into a single structured patch.`);
    }
  }
  if (cacheHitPct < 55) {
    recommendations.push(`Prompt cache hit rate is ${cacheHitPct}%. Keep system prompt & MCP tool definitions static across turns.`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Clean single-pass execution with high prompt cache reuse and zero thrash loops.');
  }

  const baseUsd = Math.max(0.0001, session.totals.totalCostUsd);
  const modelComparisons: ModelCostComparison[] = MODEL_PRICING_TABLE.map((m) => {
    const totalUsd = estimateCostForModel(session, m);
    const deltaVsBasePct = Math.round(((totalUsd - baseUsd) / baseUsd) * 100);
    return { id: m.id, label: m.label, totalUsd, deltaVsBasePct };
  });

  return {
    efficiencyScore,
    cacheHitPct,
    thrashLoops,
    wastedTokens,
    wastedUsd: Number(wastedUsd.toFixed(4)),
    recommendations,
    modelComparisons,
  };
}

export function formatSessionAuditMarkdown(session: ReplaySession, eff: SessionEfficiencyReport): string {
  const lines = [
    `# agent-replay Session Audit — ${session.title}`,
    `- Model: \`${session.model}\` | Steps: **${session.steps.length}** | Efficiency Score: **${eff.efficiencyScore}/100**`,
    `- Total Tokens: **${session.totals.totalTokens.toLocaleString()}** | Cache Hit: **${eff.cacheHitPct}%** | Cost: **$${session.totals.totalCostUsd.toFixed(4)}**`,
    `- Failed Commands: **${session.totals.failedCommands}** | Thrash Loops: **${eff.thrashLoops}** | Wasted Tax: **$${eff.wastedUsd.toFixed(4)}**`,
    '',
    '## Model Cost Comparison',
    '| Model | Est. Cost | Delta |',
    '| :--- | ---: | ---: |',
    ...eff.modelComparisons.map((m) => `| ${m.label} | $${m.totalUsd.toFixed(4)} | ${m.deltaVsBasePct > 0 ? '+' : ''}${m.deltaVsBasePct}% |`),
    '',
    '## Harness Recommendations',
    ...eff.recommendations.map((r) => `- ${r}`),
  ];
  return lines.join('\n') + '\n';
}
