export type ContextCategory =
  | 'system'
  | 'mcp-schemas'
  | 'pinned-files'
  | 'history'
  | 'tool-outputs'
  | 'reasoning';

export interface ContextSegment {
  id: string;
  label: string;
  category: ContextCategory;
  tokens: number;
  prunable: boolean;
  enabled: boolean;
  compressionPct: number; // 0 = raw, up to 80% summarized/trimmed
  note: string;
}

export interface ContextBudgetPreset {
  id: string;
  name: string;
  windowLimit: number;
  pricePerMillionUsd: number;
  segments: ContextSegment[];
}

export interface ContextBudgetSummary {
  windowLimit: number;
  rawTotal: number;
  effectiveTotal: number;
  savedTokens: number;
  utilizationPct: number;
  savedCostPer100TurnsUsd: number;
  byCategory: Record<ContextCategory, number>;
}

export function computeContextBudget(
  segments: ContextSegment[],
  windowLimit: number,
  pricePerMillionUsd = 3.0,
): ContextBudgetSummary {
  const byCategory: Record<ContextCategory, number> = {
    system: 0,
    'mcp-schemas': 0,
    'pinned-files': 0,
    history: 0,
    'tool-outputs': 0,
    reasoning: 0,
  };
  let rawTotal = 0;
  let effectiveTotal = 0;

  for (const s of segments) {
    rawTotal += s.tokens;
    const activeTokens = s.enabled ? Math.round(s.tokens * (1 - s.compressionPct / 100)) : 0;
    effectiveTotal += activeTokens;
    byCategory[s.category] += activeTokens;
  }

  const savedTokens = Math.max(0, rawTotal - effectiveTotal);
  const utilizationPct = Math.round((effectiveTotal / Math.max(1, windowLimit)) * 1000) / 10;
  const savedCostPer100TurnsUsd = Number(((savedTokens * 100 * pricePerMillionUsd) / 1_000_000).toFixed(2));

  return {
    windowLimit,
    rawTotal,
    effectiveTotal,
    savedTokens,
    utilizationPct,
    savedCostPer100TurnsUsd,
    byCategory,
  };
}

export const CONTEXT_BUDGET_PRESETS: ContextBudgetPreset[] = [
  {
    id: 'heavy-mcp',
    name: 'Heavy MCP Workspace (200k)',
    windowLimit: 200_000,
    pricePerMillionUsd: 3.0,
    segments: [
      { id: 'sys', label: 'System & Safety Instructions', category: 'system', tokens: 6_400, prunable: false, enabled: true, compressionPct: 0, note: 'Core policy + workspace rules' },
      { id: 'mcp-gh', label: 'MCP: github-mcp (34 tool schemas)', category: 'mcp-schemas', tokens: 24_800, prunable: true, enabled: true, compressionPct: 0, note: 'Disable unused PR/issue tools or lazy-load schemas' },
      { id: 'mcp-db', label: 'MCP: postgres + bigquery (26 tools)', category: 'mcp-schemas', tokens: 19_200, prunable: true, enabled: true, compressionPct: 0, note: 'Heavy JSON schemas injected every turn' },
      { id: 'files', label: 'Pinned Repo Files (12 files)', category: 'pinned-files', tokens: 34_500, prunable: true, enabled: true, compressionPct: 15, note: 'Trim untouched boilerplate imports' },
      { id: 'hist', label: 'Multi-Turn Conversation History (28 turns)', category: 'history', tokens: 48_900, prunable: true, enabled: true, compressionPct: 20, note: 'Summarize turns older than 8 steps' },
      { id: 'outs', label: 'Raw Tool Outputs & Build Logs', category: 'tool-outputs', tokens: 41_200, prunable: true, enabled: true, compressionPct: 35, note: 'Strip verbose stack traces & ANSI logs' },
      { id: 'think', label: 'Retained Reasoning Traces', category: 'reasoning', tokens: 12_400, prunable: true, enabled: true, compressionPct: 0, note: 'Optional carry-over thought blocks' },
    ],
  },
  {
    id: 'debug-loop',
    name: 'Long Test-Failure Thrash Loop (128k)',
    windowLimit: 128_000,
    pricePerMillionUsd: 2.5,
    segments: [
      { id: 'sys2', label: 'System Prompt', category: 'system', tokens: 4_800, prunable: false, enabled: true, compressionPct: 0, note: 'Baseline agent instructions' },
      { id: 'mcp2', label: 'MCP: chrome-devtools (18 tools)', category: 'mcp-schemas', tokens: 14_600, prunable: true, enabled: true, compressionPct: 0, note: 'Browser automation definitions' },
      { id: 'files2', label: 'Active Source Files', category: 'pinned-files', tokens: 19_800, prunable: true, enabled: true, compressionPct: 0, note: 'Rate limiter + tests' },
      { id: 'hist2', label: 'Retry Dialogue Turns', category: 'history', tokens: 32_000, prunable: true, enabled: true, compressionPct: 25, note: 'Repeated failure explanations' },
      { id: 'outs2', label: 'Repeated Vitest & Webpack Logs', category: 'tool-outputs', tokens: 46_500, prunable: true, enabled: true, compressionPct: 50, note: 'Biggest bloat source — truncate passing suites' },
    ],
  },
];

export type McpPermission = 'read-only' | 'write-fs' | 'network' | 'exec' | 'database';

export interface McpToolDef {
  name: string;
  schemaTokens: number;
  permission: McpPermission;
  avgLatencyMs: number;
  callsInSession: number;
  description: string;
  inputParams: string[];
}

export interface McpServerInfo {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  status: 'connected' | 'idle' | 'warning';
  tools: McpToolDef[];
}

export interface McpCallTrace {
  id: string;
  serverId: string;
  toolName: string;
  startMs: number;
  durationMs: number;
  status: 'ok' | 'error';
  requestTokens: number;
  responseTokens: number;
  preview: string;
}

export const DEMO_MCP_SERVERS: McpServerInfo[] = [
  {
    id: 'mcp-fs',
    name: 'workspace-fs',
    transport: 'stdio',
    status: 'connected',
    tools: [
      { name: 'read_file', schemaTokens: 410, permission: 'read-only', avgLatencyMs: 12, callsInSession: 14, description: 'Read bounded line ranges from workspace files', inputParams: ['path', 'startLine', 'endLine'] },
      { name: 'edit_file', schemaTokens: 520, permission: 'write-fs', avgLatencyMs: 18, callsInSession: 7, description: 'Apply targeted block replacement patch', inputParams: ['path', 'target', 'replacement'] },
      { name: 'grep_search', schemaTokens: 460, permission: 'read-only', avgLatencyMs: 38, callsInSession: 9, description: 'Ripgrep regex search across repository', inputParams: ['query', 'glob'] },
    ],
  },
  {
    id: 'mcp-git',
    name: 'github-ops',
    transport: 'streamable-http',
    status: 'warning',
    tools: [
      { name: 'list_pull_requests', schemaTokens: 1180, permission: 'network', avgLatencyMs: 240, callsInSession: 2, description: 'List open/merged PRs with diff stats', inputParams: ['owner', 'repo', 'state'] },
      { name: 'get_pr_diff', schemaTokens: 920, permission: 'network', avgLatencyMs: 310, callsInSession: 3, description: 'Fetch unified diff patch for pull request', inputParams: ['owner', 'repo', 'pullNumber'] },
      { name: 'create_review_comment', schemaTokens: 1420, permission: 'network', avgLatencyMs: 290, callsInSession: 0, description: 'Post inline review comment (unused schema bloat)', inputParams: ['owner', 'repo', 'pullNumber', 'body', 'path', 'line'] },
      { name: 'dispatch_workflow', schemaTokens: 1340, permission: 'exec', avgLatencyMs: 410, callsInSession: 1, description: 'Trigger GitHub Actions workflow_dispatch', inputParams: ['owner', 'repo', 'workflowId', 'ref'] },
    ],
  },
  {
    id: 'mcp-db',
    name: 'postgres-readonly',
    transport: 'stdio',
    status: 'connected',
    tools: [
      { name: 'explain_query', schemaTokens: 780, permission: 'database', avgLatencyMs: 64, callsInSession: 4, description: 'Run EXPLAIN (FORMAT JSON) safely in read-only tx', inputParams: ['sql', 'analyze'] },
      { name: 'list_schema_tables', schemaTokens: 610, permission: 'database', avgLatencyMs: 28, callsInSession: 2, description: 'Inspect tables, indexes, and column nullability', inputParams: ['schema'] },
    ],
  },
  {
    id: 'mcp-browser',
    name: 'chrome-devtools',
    transport: 'sse',
    status: 'idle',
    tools: [
      { name: 'navigate_page', schemaTokens: 890, permission: 'network', avgLatencyMs: 620, callsInSession: 2, description: 'Open URL in controlled Chrome DevTools tab', inputParams: ['url', 'waitUntil'] },
      { name: 'capture_screenshot', schemaTokens: 740, permission: 'read-only', avgLatencyMs: 380, callsInSession: 1, description: 'Capture viewport PNG for visual verification', inputParams: ['fullPage'] },
      { name: 'evaluate_script', schemaTokens: 1120, permission: 'exec', avgLatencyMs: 45, callsInSession: 5, description: 'Execute JS expression inside page context', inputParams: ['expression'] },
    ],
  },
];

export const DEMO_MCP_TRACES: McpCallTrace[] = [
  { id: 't1', serverId: 'mcp-fs', toolName: 'grep_search', startMs: 0, durationMs: 42, status: 'ok', requestTokens: 64, responseTokens: 320, preview: 'Matched 4 references to checkLimit in src/' },
  { id: 't2', serverId: 'mcp-fs', toolName: 'read_file', startMs: 90, durationMs: 14, status: 'ok', requestTokens: 52, responseTokens: 980, preview: 'src/middleware/rateLimit.ts (L1-L45)' },
  { id: 't3', serverId: 'mcp-db', toolName: 'explain_query', startMs: 180, durationMs: 74, status: 'ok', requestTokens: 118, responseTokens: 1450, preview: 'Seq Scan on audit_logs (cost=0..18420)' },
  { id: 't4', serverId: 'mcp-git', toolName: 'get_pr_diff', startMs: 310, durationMs: 335, status: 'ok', requestTokens: 88, responseTokens: 2840, preview: 'PR #142: 8 files changed (+65 -24)' },
  { id: 't5', serverId: 'mcp-browser', toolName: 'navigate_page', startMs: 690, durationMs: 640, status: 'error', requestTokens: 74, responseTokens: 210, preview: 'ERR_CONNECTION_REFUSED on localhost:3000' },
  { id: 't6', serverId: 'mcp-fs', toolName: 'edit_file', startMs: 1380, durationMs: 22, status: 'ok', requestTokens: 410, responseTokens: 92, preview: 'Patched ARGV[3] UUID argument in rateLimit.ts' },
  { id: 't7', serverId: 'mcp-browser', toolName: 'evaluate_script', startMs: 1460, durationMs: 48, status: 'ok', requestTokens: 120, responseTokens: 185, preview: 'Verified 0 console errors & 8 rendered nodes' },
];

export function computeMcpStats(servers: McpServerInfo[]) {
  const allTools = servers.flatMap((s) => s.tools.map((t) => ({ ...t, serverName: s.name, serverId: s.id })));
  const totalSchemaTokens = allTools.reduce((a, t) => a + t.schemaTokens, 0);
  const unusedSchemaTokens = allTools.filter((t) => t.callsInSession === 0).reduce((a, t) => a + t.schemaTokens, 0);
  return {
    serverCount: servers.length,
    toolCount: allTools.length,
    totalSchemaTokens,
    unusedSchemaTokens,
    allTools,
  };
}
