import { useMemo, useState } from 'react';
import {
  Activity,
  Cpu,
  Download,
  Network,
  Scissors,
  Server,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import {
  computeContextBudget,
  computeMcpStats,
  CONTEXT_BUDGET_PRESETS,
  DEMO_MCP_SERVERS,
  DEMO_MCP_TRACES,
  type ContextCategory,
  type ContextSegment,
  type McpPermission,
} from '../core/contextAndMcp.ts';

const CAT_COLORS: Record<ContextCategory, { bar: string; text: string; label: string }> = {
  system: { bar: 'bg-sky-400', text: 'text-sky-300', label: 'System' },
  'mcp-schemas': { bar: 'bg-violet-400', text: 'text-violet-300', label: 'MCP Schemas' },
  'pinned-files': { bar: 'bg-emerald-400', text: 'text-emerald-300', label: 'Files' },
  history: { bar: 'bg-amber-400', text: 'text-amber-300', label: 'History' },
  'tool-outputs': { bar: 'bg-rose-400', text: 'text-rose-300', label: 'Tool Outputs' },
  reasoning: { bar: 'bg-cyan-400', text: 'text-cyan-300', label: 'Reasoning' },
};

const PERM_BADGE: Record<McpPermission, string> = {
  'read-only': 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  'write-fs': 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  network: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  database: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
  exec: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
};

export function ContextWindowXray() {
  const [presetIdx, setPresetIdx] = useState(0);
  const [windowLimit, setWindowLimit] = useState(CONTEXT_BUDGET_PRESETS[0].windowLimit);
  const [segments, setSegments] = useState<ContextSegment[]>(() =>
    CONTEXT_BUDGET_PRESETS[0].segments.map((s) => ({ ...s })),
  );

  const summary = useMemo(
    () => computeContextBudget(segments, windowLimit, CONTEXT_BUDGET_PRESETS[presetIdx]?.pricePerMillionUsd ?? 3),
    [segments, windowLimit, presetIdx],
  );

  const loadPreset = (idx: number) => {
    const p = CONTEXT_BUDGET_PRESETS[idx];
    setPresetIdx(idx);
    setWindowLimit(p.windowLimit);
    setSegments(p.segments.map((s) => ({ ...s })));
  };

  const autoTrimRecommended = () => {
    setSegments((prev) =>
      prev.map((s) => {
        if (!s.prunable) return s;
        if (s.category === 'tool-outputs') return { ...s, compressionPct: 75 };
        if (s.category === 'history') return { ...s, compressionPct: 60 };
        if (s.category === 'mcp-schemas') return { ...s, compressionPct: 50 };
        return s;
      }),
    );
  };

  const exportPlan = () => {
    const blob = new Blob([JSON.stringify({ summary, segments }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'context-budget-plan.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#090D16] text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-[#0F172A] px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <Sliders className="h-3.5 w-3.5 text-violet-400" />
          {CONTEXT_BUDGET_PRESETS.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => loadPreset(idx)}
              className={`rounded-md border px-2.5 py-1 ${
                presetIdx === idx
                  ? 'border-violet-500/60 bg-violet-500/15 font-semibold text-violet-200'
                  : 'border-slate-700 bg-[#111827] text-slate-300'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={autoTrimRecommended}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-200 hover:bg-emerald-500/25"
          >
            <Scissors className="h-3.5 w-3.5" /> Auto-Optimize Context
          </button>
          <button
            type="button"
            onClick={exportPlan}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#111827] px-2.5 py-1 text-slate-200 hover:border-sky-500"
          >
            <Download className="h-3.5 w-3.5 text-sky-400" /> Export JSON
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {/* Stacked Context Utilization Gauge */}
        <div className="rounded-xl border border-slate-800 bg-[#111827] p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active Context Window Share</div>
              <div className="mt-1 flex items-baseline gap-3 font-mono">
                <span className={`text-3xl font-extrabold ${summary.utilizationPct > 85 ? 'text-rose-400' : summary.utilizationPct > 65 ? 'text-amber-300' : 'text-emerald-400'}`}>
                  {(summary.effectiveTotal / 1000).toFixed(1)}k
                </span>
                <span className="text-sm text-slate-400">/ {(windowLimit / 1000).toFixed(0)}k tokens ({summary.utilizationPct}%)</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 font-mono text-xs">
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-emerald-300">
                Saved: <strong>{(summary.savedTokens / 1000).toFixed(1)}k tok</strong>
              </div>
              <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-sky-300">
                Est. 100-Turn Savings: <strong>${summary.savedCostPer100TurnsUsd.toFixed(2)}</strong>
              </div>
            </div>
          </div>

          <div className="mt-4 flex h-5 w-full overflow-hidden rounded-full border border-slate-800 bg-[#090D16]">
            {(Object.entries(summary.byCategory) as Array<[ContextCategory, number]>).map(([cat, tok]) => {
              const pct = (tok / Math.max(1, windowLimit)) * 100;
              if (pct <= 0) return null;
              return (
                <div
                  key={cat}
                  title={`${CAT_COLORS[cat].label}: ${tok.toLocaleString()} tokens`}
                  className={`${CAT_COLORS[cat].bar} transition-all`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            {(Object.entries(summary.byCategory) as Array<[ContextCategory, number]>).map(([cat, tok]) => (
              <span key={cat} className={`flex items-center gap-1.5 font-mono ${CAT_COLORS[cat].text}`}>
                <span className={`h-2.5 w-2.5 rounded-sm ${CAT_COLORS[cat].bar}`} />
                {CAT_COLORS[cat].label}: {(tok / 1000).toFixed(1)}k
              </span>
            ))}
          </div>
        </div>

        {/* Interactive Per-Segment Toggles & Compression Sliders */}
        <div className="grid gap-3 md:grid-cols-2">
          {segments.map((seg) => {
            const effective = seg.enabled ? Math.round(seg.tokens * (1 - seg.compressionPct / 100)) : 0;
            return (
              <div
                key={seg.id}
                className={`rounded-xl border p-4 transition ${
                  seg.enabled ? 'border-slate-800 bg-[#111827]' : 'border-slate-800/50 bg-[#090D16] opacity-55'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${CAT_COLORS[seg.category].bar}`} />
                      <h3 className="text-sm font-bold text-slate-100">{seg.label}</h3>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">{seg.note}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!seg.prunable}
                    onClick={() =>
                      setSegments((prev) =>
                        prev.map((x) => (x.id === seg.id ? { ...x, enabled: !x.enabled } : x)),
                      )
                    }
                    className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                      !seg.prunable
                        ? 'cursor-not-allowed border-slate-700 text-slate-500'
                        : seg.enabled
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                    }`}
                  >
                    {!seg.prunable ? 'LOCKED' : seg.enabled ? 'ACTIVE' : 'PRUNED'}
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between font-mono text-xs">
                  <span className="text-slate-400">
                    Raw {(seg.tokens / 1000).toFixed(1)}k → <strong className="text-slate-100">{(effective / 1000).toFixed(1)}k tok</strong>
                  </span>
                  {seg.prunable && seg.enabled && (
                    <span className="text-violet-300">Trim {seg.compressionPct}%</span>
                  )}
                </div>

                {seg.prunable && seg.enabled && (
                  <input
                    type="range"
                    min={0}
                    max={80}
                    step={5}
                    value={seg.compressionPct}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setSegments((prev) =>
                        prev.map((x) => (x.id === seg.id ? { ...x, compressionPct: val } : x)),
                      );
                    }}
                    className="mt-2 h-1.5 w-full cursor-pointer accent-violet-400"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function McpTopologyRadar() {
  const [selectedServerId, setSelectedServerId] = useState<string>(DEMO_MCP_SERVERS[0].id);
  const stats = useMemo(() => computeMcpStats(DEMO_MCP_SERVERS), []);
  const selectedServer = DEMO_MCP_SERVERS.find((s) => s.id === selectedServerId) ?? DEMO_MCP_SERVERS[0];
  const maxTraceEnd = Math.max(1, ...DEMO_MCP_TRACES.map((t) => t.startMs + t.durationMs));

  return (
    <div className="grid flex-1 overflow-hidden bg-[#090D16] text-slate-100 lg:grid-cols-[1.05fr_1.25fr]">
      {/* Left: Visual MCP Hub-and-Spoke Topology SVG + Server Cards */}
      <section className="flex flex-col space-y-4 overflow-y-auto border-r border-slate-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#111827] px-4 py-3 text-xs">
          <div className="flex items-center gap-2 font-bold text-slate-100">
            <Network className="h-4 w-4 text-violet-400" />
            <span>MCP Topology &amp; Schema Overhead</span>
          </div>
          <div className="flex gap-3 font-mono">
            <span className="text-sky-300">{stats.serverCount} servers</span>
            <span className="text-violet-300">{stats.toolCount} tools ({(stats.totalSchemaTokens / 1000).toFixed(1)}k tok)</span>
            <span className="text-amber-300">{stats.unusedSchemaTokens} unused tok</span>
          </div>
        </div>

        {/* Interactive Hub & Spoke SVG Diagram */}
        <div className="rounded-xl border border-slate-800 bg-[#111827] p-4">
          <svg viewBox="0 0 560 220" className="h-52 w-full">
            <defs>
              <filter id="mcp-glow">
                <feGaussianBlur stdDeviation="2.5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {DEMO_MCP_SERVERS.map((srv, idx) => {
              const x = 70 + idx * 140;
              const y = 165;
              const active = srv.id === selectedServerId;
              const srvTokens = srv.tools.reduce((a, t) => a + t.schemaTokens, 0);
              const color = srv.status === 'warning' ? '#f59e0b' : srv.status === 'idle' ? '#94a3b8' : '#34d399';
              const d = `M 280 48 C 280 105, ${x} 105, ${x} ${y - 26}`;
              return (
                <g key={srv.id} onClick={() => setSelectedServerId(srv.id)} className="cursor-pointer">
                  <path d={d} fill="none" stroke={active ? '#a78bfa' : '#334155'} strokeWidth={active ? 2.6 : 1.6} className={active ? 'edge-flow' : ''} />
                  {active && (
                    <circle r="3.5" fill="#c4b5fd" filter="url(#mcp-glow)">
                      <animateMotion dur="1.8s" repeatCount="indefinite" path={d} />
                    </circle>
                  )}
                  <rect
                    x={x - 58}
                    y={y - 26}
                    width="116"
                    height="56"
                    rx="10"
                    fill="#090D16"
                    stroke={active ? '#a78bfa' : color}
                    strokeWidth={active ? 2.2 : 1.3}
                  />
                  <text x={x} y={y - 6} textAnchor="middle" fill="#f8fafc" fontFamily="monospace" fontSize="10.5" fontWeight="700">
                    {srv.name}
                  </text>
                  <text x={x} y={y + 10} textAnchor="middle" fill="#94a3b8" fontFamily="monospace" fontSize="9">
                    {srv.tools.length} tools · {(srvTokens / 1000).toFixed(1)}k tok
                  </text>
                  <text x={x} y={y + 22} textAnchor="middle" fill={color} fontFamily="monospace" fontSize="8.5">
                    {srv.transport}
                  </text>
                </g>
              );
            })}
            <g>
              <rect x="200" y="12" width="160" height="38" rx="10" fill="#1e1b4b" stroke="#8b5cf6" strokeWidth="1.8" />
              <text x="280" y="35" textAnchor="middle" fill="#ede9fe" fontFamily="monospace" fontSize="11.5" fontWeight="700">
                Agent Runtime Host
              </text>
            </g>
          </svg>
        </div>

        {/* Live Tool-Call Waterfall Trace */}
        <div className="space-y-2.5 rounded-xl border border-slate-800 bg-[#111827] p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-200">
            <Activity className="h-3.5 w-3.5 text-sky-400" />
            <span>MCP Tool-Call Execution Trace ({maxTraceEnd}ms)</span>
          </div>
          <div className="space-y-2">
            {DEMO_MCP_TRACES.map((tr) => {
              const leftPct = (tr.startMs / maxTraceEnd) * 100;
              const widthPct = Math.max(4, (tr.durationMs / maxTraceEnd) * 100);
              return (
                <button
                  key={tr.id}
                  type="button"
                  onClick={() => setSelectedServerId(tr.serverId)}
                  className="block w-full rounded-lg border border-slate-800 bg-[#090D16] p-2.5 text-left hover:border-violet-500/50"
                >
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="font-semibold text-slate-100">{tr.toolName}</span>
                    <span className={tr.status === 'error' ? 'text-rose-400' : 'text-emerald-400'}>
                      {tr.durationMs}ms · {tr.requestTokens}→{tr.responseTokens} tok
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-800/90 relative overflow-hidden">
                    <div
                      className={`absolute top-0 h-full rounded-full ${tr.status === 'error' ? 'bg-rose-500' : 'bg-violet-400'}`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    />
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-slate-400">{tr.preview}</div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Right: Selected Server Tool Schemas & Token Overhead Breakdown */}
      <section className="flex flex-col space-y-4 overflow-y-auto bg-[#111827] p-5">
        <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#090D16] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-500/40 bg-violet-500/15 text-violet-300">
              <Server className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-mono text-sm font-bold text-slate-50">{selectedServer.name}</h2>
              <p className="text-xs text-slate-400">
                Transport: <code className="font-mono text-sky-300">{selectedServer.transport}</code> · {selectedServer.tools.length} registered tools
              </p>
            </div>
          </div>
          <span className="rounded bg-slate-800 px-2 py-1 font-mono text-xs text-violet-300">
            {selectedServer.tools.reduce((a, t) => a + t.schemaTokens, 0)} schema tok
          </span>
        </div>

        <div className="space-y-3">
          {selectedServer.tools.map((tool) => (
            <div key={tool.name} className="rounded-xl border border-slate-800 bg-[#090D16] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Cpu className="h-3.5 w-3.5 text-sky-400" />
                  <span className="font-mono text-sm font-bold text-slate-100">{tool.name}</span>
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${PERM_BADGE[tool.permission]}`}>
                    {tool.permission}
                  </span>
                </div>
                <span className="font-mono text-xs text-violet-300">
                  {tool.schemaTokens} tok · {tool.callsInSession} calls · ~{tool.avgLatencyMs}ms
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-300">{tool.description}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {tool.inputParams.map((p) => (
                  <span key={p} className="rounded bg-slate-800/90 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                    {p}
                  </span>
                ))}
                {tool.callsInSession === 0 && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                    <ShieldAlert className="h-3 w-3" /> Unused schema overhead — lazy-load candidate
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
