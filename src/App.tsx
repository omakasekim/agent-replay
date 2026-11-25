import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Clock,
  Coins,
  Columns2,
  Copy,
  Download,
  FastForward,
  FileCode2,
  Flame,
  Gauge,
  Pause,
  Play,
  Terminal,
  Upload,
  X,
} from 'lucide-react';
import { DEMO_AGENT_SESSION_JSON, DEMO_SESSION_PRESETS } from './core/demoSession.ts';
import {
  buildReplaySession,
  buildUnifiedDiffLines,
  generateRevertPatch,
  generateRollbackFromStepPatch,
} from './core/parser.ts';
import type { ReplaySession, StepKind } from './core/types.ts';
import { ContextWindowXray, McpTopologyRadar } from './components/ContextMcpViews.tsx';

type AgentMode = 'replay' | 'context' | 'mcp';

const KIND_BADGE: Record<StepKind, string> = {
  read: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  edit: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  write: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  command: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  search: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  reasoning: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
};

export function App() {
  const [agentMode, setAgentMode] = useState<AgentMode>('replay');
  const [presetId, setPresetId] = useState<string>('rate-limiter');
  const [session, setSession] = useState<ReplaySession>(() =>
    buildReplaySession(DEMO_AGENT_SESSION_JSON, { id: 'rate-limiter', isDemo: true }),
  );
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [patchMode, setPatchMode] = useState<'step' | 'rollback'>('step');
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified');
  const [heatmapScope, setHeatmapScope] = useState<'upto' | 'full'>('upto');
  const [copiedPatch, setCopiedPatch] = useState(false);
  const [selectedSnapFile, setSelectedSnapFile] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const isLocalServer =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  useEffect(() => {
    if (!isLocalServer) return;
    fetch('/api/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ReplaySession | null) => {
        if (data && Array.isArray(data.steps) && data.steps.length > 0) {
          setSession(data);
          setStepIdx(0);
        }
      })
      .catch(() => {});
  }, [isLocalServer]);

  useEffect(() => {
    if (!playing || session.steps.length === 0) return;
    const intervalMs = Math.round(1450 / speed);
    const t = setInterval(() => {
      setStepIdx((prev) => (prev + 1 < session.steps.length ? prev + 1 : 0));
    }, intervalMs);
    return () => clearInterval(t);
  }, [playing, speed, session.steps.length]);

  const currentStep = session.steps[stepIdx] ?? session.steps[0];
  const currentSnapshot = session.snapshotsByStep[stepIdx] ?? {};
  const snapshotFiles = Object.keys(currentSnapshot).sort();

  useEffect(() => {
    if (currentStep?.targetFile && currentSnapshot[currentStep.targetFile] !== undefined) {
      setSelectedSnapFile(currentStep.targetFile);
    } else if (snapshotFiles.length > 0 && (!selectedSnapFile || !currentSnapshot[selectedSnapFile])) {
      setSelectedSnapFile(snapshotFiles[0]);
    }
  }, [stepIdx, currentStep, snapshotFiles.length]);

  const loadPreset = (id: string) => {
    const found = DEMO_SESSION_PRESETS.find((p) => p.id === id);
    if (!found) return;
    setPresetId(found.id);
    setSession(buildReplaySession(found.raw, { id: found.id, isDemo: true }));
    setStepIdx(0);
    setPlaying(false);
  };

  // Cumulative token & cost curve data
  const burnCurve = useMemo(() => {
    let cumTokens = 0;
    let cumCost = 0;
    return session.steps.map((s) => {
      cumTokens += s.inputTokens + s.cacheReadTokens + s.outputTokens;
      cumCost += s.costUsd;
      return {
        index: s.index,
        cumTokens,
        cumCost,
        stepTokens: s.inputTokens + s.cacheReadTokens + s.outputTokens,
        outcome: s.outcome,
        kind: s.kind,
      };
    });
  }, [session.steps]);

  const cacheHitPct = useMemo(() => {
    const denom = session.totals.inputTokens + session.totals.cacheReadTokens;
    return denom > 0 ? Math.round((session.totals.cacheReadTokens / denom) * 100) : 0;
  }, [session.totals]);

  const wastedFailCost = useMemo(
    () => session.steps.filter((s) => s.outcome === 'fail').reduce((acc, s) => acc + s.costUsd, 0),
    [session.steps],
  );

  // Dynamic time-travel heatmap (touch counts up to current step vs full session)
  const dynamicHeatmap = useMemo(() => {
    if (heatmapScope === 'full') return session.heatmap;
    const map = new Map<string, { reads: number; edits: number; estimatedBytes: number; touchedAtSteps: number[] }>();
    for (const f of session.heatmap) {
      map.set(f.path, { reads: 0, edits: 0, estimatedBytes: f.estimatedBytes, touchedAtSteps: [] });
    }
    for (let i = 0; i <= stepIdx && i < session.steps.length; i++) {
      const s = session.steps[i];
      if (!s.targetFile) continue;
      const entry = map.get(s.targetFile) ?? { reads: 0, edits: 0, estimatedBytes: 300, touchedAtSteps: [] };
      if (s.kind === 'edit' || s.kind === 'write') entry.edits += 1;
      else entry.reads += 1;
      entry.touchedAtSteps.push(i);
      map.set(s.targetFile, entry);
    }
    return Array.from(map.entries())
      .map(([path, v]) => ({
        path,
        reads: v.reads,
        edits: v.edits,
        thrashScore: v.edits * 2 + v.reads,
        estimatedBytes: v.estimatedBytes,
        touchedAtSteps: v.touchedAtSteps,
      }))
      .sort((a, b) => b.thrashScore - a.thrashScore);
  }, [session, stepIdx, heatmapScope]);

  const maxTokensInStep = useMemo(
    () =>
      Math.max(
        1,
        ...session.steps.map((s) => s.inputTokens + s.cacheReadTokens + s.outputTokens),
      ),
    [session.steps],
  );

  const stepDiffLines = useMemo(() => {
    if (!currentStep || (currentStep.kind !== 'edit' && currentStep.kind !== 'write')) return [];
    return buildUnifiedDiffLines(
      currentStep.targetFile ?? 'file',
      currentStep.beforeContent ?? '',
      currentStep.afterContent ?? '',
    );
  }, [currentStep]);

  // Split side-by-side pairs
  const splitRows = useMemo(() => {
    const rows: Array<{
      oldLn: number | null;
      oldText: string;
      oldKind: 'del' | 'context' | 'empty';
      newLn: number | null;
      newText: string;
      newKind: 'add' | 'context' | 'empty';
    }> = [];
    for (const l of stepDiffLines) {
      if (l.type === 'context') {
        rows.push({ oldLn: l.oldLn, oldText: l.text, oldKind: 'context', newLn: l.newLn, newText: l.text, newKind: 'context' });
      } else if (l.type === 'del') {
        rows.push({ oldLn: l.oldLn, oldText: l.text, oldKind: 'del', newLn: null, newText: '', newKind: 'empty' });
      } else {
        const last = rows[rows.length - 1];
        if (last && last.oldKind === 'del' && last.newKind === 'empty') {
          last.newLn = l.newLn;
          last.newText = l.text;
          last.newKind = 'add';
        } else {
          rows.push({ oldLn: null, oldText: '', oldKind: 'empty', newLn: l.newLn, newText: l.text, newKind: 'add' });
        }
      }
    }
    return rows;
  }, [stepDiffLines]);

  const activePatch = useMemo(() => {
    if (!currentStep) return '';
    return patchMode === 'step'
      ? generateRevertPatch(session, stepIdx)
      : generateRollbackFromStepPatch(session, stepIdx);
  }, [session, stepIdx, patchMode, currentStep]);

  const loadTranscriptText = (text: string, label: string) => {
    const parsed = buildReplaySession(text, {
      id: label,
      title: `Loaded: ${label}`,
      isDemo: false,
    });
    if (parsed.steps.length > 0) {
      setPresetId('custom');
      setSession(parsed);
      setStepIdx(0);
      setPlaying(false);
    }
  };

  const jumpToNext = (predicate: (s: ReplaySession['steps'][number]) => boolean) => {
    const n = session.steps.length;
    for (let offset = 1; offset <= n; offset++) {
      const idx = (stepIdx + offset) % n;
      if (predicate(session.steps[idx])) {
        setPlaying(false);
        setStepIdx(idx);
        return;
      }
    }
  };

  const copyPatch = async () => {
    try {
      await navigator.clipboard.writeText(activePatch);
      setCopiedPatch(true);
      setTimeout(() => setCopiedPatch(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const downloadPatch = () => {
    const blob = new Blob([activePatch], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `revert-step-${stepIdx + 1}.patch`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  // Burn curve SVG path computation
  const burnSvg = useMemo(() => {
    const w = 320;
    const h = 44;
    if (burnCurve.length < 2) return { line: '', area: '', playX: 0, playY: h };
    const maxTok = Math.max(1, burnCurve[burnCurve.length - 1].cumTokens);
    const pts = burnCurve.map((p, i) => {
      const x = (i / (burnCurve.length - 1)) * w;
      const y = h - 4 - (p.cumTokens / maxTok) * (h - 10);
      return { x, y, fail: p.outcome === 'fail', index: p.index };
    });
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const area = `${line} L ${w} ${h} L 0 ${h} Z`;
    const activePt = pts[Math.min(stepIdx, pts.length - 1)] ?? pts[0];
    return { line, area, pts, playX: activePt.x, playY: activePt.y };
  }, [burnCurve, stepIdx]);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-[#0B0F17] text-slate-100"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) loadTranscriptText(await f.text(), f.name);
      }}
    >
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 bg-[#111827] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/40 bg-violet-500/15 text-violet-300">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-slate-50">agent-replay</h1>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-violet-300">
                  {session.model}
                </span>
                {session.isDemo && (
                  <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                    INTERACTIVE TRACE
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                {session.title} · {session.steps.length} steps ·{' '}
                <span className="font-mono text-amber-300">{session.totals.thrashFiles} thrash hotspot(s)</span>
              </p>
            </div>
          </div>

          <div className="flex rounded-lg border border-slate-700 bg-[#0B0F17] p-0.5 text-xs">
            {(
              [
                { id: 'replay', label: 'Time-Travel' },
                { id: 'context', label: 'Context Budget' },
                { id: 'mcp', label: 'MCP Radar' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setAgentMode(m.id)}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  agentMode === m.id ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {agentMode === 'replay' && (
          <select
            value={presetId}
            onChange={(e) => loadPreset(e.target.value)}
            className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
          >
            {DEMO_SESSION_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                Preset: {p.label}
              </option>
            ))}
            {presetId === 'custom' && <option value="custom">Custom Uploaded / Pasted Trace</option>}
          </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-1 font-mono text-xs">
            <span className="text-slate-400">
              Tokens <strong className="text-slate-100">{(session.totals.totalTokens / 1000).toFixed(1)}k</strong>
            </span>
            <span className="flex items-center gap-1 text-emerald-400">
              <Coins className="h-3.5 w-3.5" />${session.totals.totalCostUsd.toFixed(4)}
            </span>
            <span className="hidden items-center gap-1 text-sky-300 md:inline-flex" title="Prompt cache hit ratio">
              <Gauge className="h-3.5 w-3.5" /> {cacheHitPct}% cache
            </span>
            <span className="text-rose-400">{session.totals.failedCommands} fail(s)</span>
          </div>

          <button
            type="button"
            onClick={() => setPasteOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-200 hover:bg-violet-500/20"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            <span>Paste Log</span>
          </button>

          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 hover:border-violet-500">
            <Upload className="h-3.5 w-3.5 text-violet-400" />
            <span>JSONL</span>
            <input
              type="file"
              accept=".json,.jsonl"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) loadTranscriptText(await f.text(), f.name);
              }}
            />
          </label>
        </div>
      </header>

      {agentMode === 'context' ? (
        <ContextWindowXray />
      ) : agentMode === 'mcp' ? (
        <McpTopologyRadar />
      ) : (
      <>
      {/* Paste Transcript Drawer */}
      {pasteOpen && (
        <div className="border-b border-slate-800 bg-[#0F172A] px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-semibold text-violet-300">Paste Universal JSON or Claude Code JSONL session log (100% browser-local)</span>
            <button type="button" onClick={() => setPasteOpen(false)} className="text-slate-400 hover:text-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder='{"title":"Debug Session","steps":[{"kind":"edit","toolName":"Edit","targetFile":"app.ts","beforeContent":"a","afterContent":"b"}]}'
            className="h-24 w-full rounded-lg border border-slate-700 bg-[#0B0F17] p-2 font-mono text-xs text-slate-100 focus:border-violet-500 focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (pasteText.trim()) {
                  loadTranscriptText(pasteText, 'pasted-session.jsonl');
                  setPasteOpen(false);
                }
              }}
              className="rounded bg-violet-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-violet-400"
            >
              Parse &amp; Time-Travel
            </button>
          </div>
        </div>
      )}

      {/* Top Scrubbable Timeline + Cumulative Token Burn Area Chart */}
      <section className="border-b border-slate-800 bg-[#0F172A] px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              className="rounded border border-slate-700 bg-[#111827] p-1 text-slate-300 hover:border-slate-500"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="inline-flex items-center gap-1 rounded border border-violet-500/40 bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-200"
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span>{playing ? 'Pause' : 'Replay'}</span>
            </button>
            <button
              type="button"
              onClick={() => setStepIdx((i) => Math.min(session.steps.length - 1, i + 1))}
              className="rounded border border-slate-700 bg-[#111827] p-1 text-slate-300 hover:border-slate-500"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="ml-1 flex rounded border border-slate-700 bg-[#111827] p-0.5 font-mono text-[10px]">
              {([0.5, 1, 2] as const).map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setSpeed(sp)}
                  className={`rounded px-1.5 py-0.5 ${speed === sp ? 'bg-violet-500/25 text-violet-200' : 'text-slate-400'}`}
                >
                  {sp}x
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => jumpToNext((s) => s.outcome === 'fail')}
              className="ml-1 inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/20"
              title="Jump to next failed command/test"
            >
              <FastForward className="h-3 w-3" /> Next Fail
            </button>
            <button
              type="button"
              onClick={() => jumpToNext((s) => s.kind === 'edit' || s.kind === 'write')}
              className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/20"
              title="Jump to next file edit"
            >
              <FastForward className="h-3 w-3" /> Next Edit
            </button>
            <span className="ml-2 font-mono text-xs text-slate-300">
              Step {stepIdx + 1} / {session.steps.length}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(0, session.steps.length - 1)}
            value={stepIdx}
            onChange={(e) => {
              setPlaying(false);
              setStepIdx(Number(e.target.value));
            }}
            className="mx-2 h-1.5 min-w-[140px] flex-1 cursor-pointer accent-violet-400"
          />

          {/* Cumulative Token Burn Mini Area Chart */}
          <div className="hidden items-center gap-3 rounded-lg border border-slate-800 bg-[#0B0F17] px-2.5 py-1 md:flex">
            <div className="text-[10px] leading-tight">
              <div className="font-semibold text-slate-300">Cumulative Burn</div>
              <div className="font-mono text-violet-300">
                ${(burnCurve[stepIdx]?.cumCost ?? 0).toFixed(4)} · fail tax ${wastedFailCost.toFixed(4)}
              </div>
            </div>
            <svg width={180} height={36} viewBox="0 0 320 44" className="overflow-visible">
              <defs>
                <linearGradient id="burnGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <path d={burnSvg.area} fill="url(#burnGrad)" />
              <path d={burnSvg.line} fill="none" stroke="#a78bfa" strokeWidth="2.2" />
              {burnSvg.pts?.map((pt) =>
                pt.fail ? <circle key={pt.index} cx={pt.x} cy={pt.y} r="4.5" fill="#f43f5e" /> : null,
              )}
              <line x1={burnSvg.playX} y1={0} x2={burnSvg.playX} y2={44} stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="3 2" />
              <circle cx={burnSvg.playX} cy={burnSvg.playY} r="4" fill="#38bdf8" />
            </svg>
          </div>
        </div>

        {/* Interactive per-step stacked token bar strip */}
        <div className="grid grid-flow-col gap-1.5 overflow-x-auto pb-1">
          {session.steps.map((s) => {
            const total = s.inputTokens + s.cacheReadTokens + s.outputTokens;
            const hPct = Math.max(16, Math.round((total / maxTokensInStep) * 100));
            const outPct = Math.round((s.outputTokens / Math.max(1, total)) * 100);
            const inPct = Math.round((s.inputTokens / Math.max(1, total)) * 100);
            const active = s.index === stepIdx;
            const barColor =
              s.outcome === 'fail'
                ? 'bg-rose-500'
                : s.kind === 'edit' || s.kind === 'write'
                  ? 'bg-amber-400'
                  : s.kind === 'command'
                    ? 'bg-emerald-400'
                    : 'bg-sky-400';
            return (
              <button
                key={s.index}
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setStepIdx(s.index);
                }}
                title={`#${s.index + 1} ${s.summary} (${total} tok, $${s.costUsd.toFixed(4)})`}
                className={`group flex h-14 min-w-[36px] flex-col items-center justify-end rounded-lg border px-1 py-1 transition ${
                  active
                    ? 'border-violet-400 bg-violet-500/20 shadow-[0_0_16px_-4px_rgba(167,139,250,0.6)]'
                    : 'border-slate-800 bg-[#111827] hover:border-slate-600'
                }`}
              >
                <div className="flex h-8 w-full items-end justify-center">
                  <div
                    className="flex w-3.5 flex-col justify-end overflow-hidden rounded-t bg-slate-700"
                    style={{ height: `${hPct}%` }}
                  >
                    <div className="w-full bg-violet-400" style={{ height: `${outPct}%` }} />
                    <div className={`w-full ${barColor}`} style={{ height: `${Math.max(20, inPct)}%` }} />
                  </div>
                </div>
                <span className={`mt-0.5 font-mono text-[9px] ${s.outcome === 'fail' ? 'font-bold text-rose-400' : 'text-slate-400'}`}>
                  #{s.index + 1}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Split: Left Time-Travel Treemap Heatmap + Snapshot, Right Step Inspector + Revert Patch */}
      <div className="grid flex-1 overflow-hidden lg:grid-cols-[1.05fr_1.25fr]">
        <section className="flex flex-col overflow-hidden border-r border-slate-800 bg-[#0B0F17]">
          <div className="flex items-center justify-between border-b border-slate-800 bg-[#111827] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Codebase Touch Heatmap
              </h2>
            </div>
            <div className="flex rounded border border-slate-700 bg-[#0B0F17] p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setHeatmapScope('upto')}
                className={`rounded px-2 py-0.5 ${heatmapScope === 'upto' ? 'bg-amber-500/20 text-amber-200' : 'text-slate-400'}`}
              >
                Up to Step #{stepIdx + 1}
              </button>
              <button
                type="button"
                onClick={() => setHeatmapScope('full')}
                className={`rounded px-2 py-0.5 ${heatmapScope === 'full' ? 'bg-amber-500/20 text-amber-200' : 'text-slate-400'}`}
              >
                Full Session
              </button>
            </div>
          </div>

          <div className="grid gap-2.5 p-4 sm:grid-cols-2">
            {dynamicHeatmap.map((f) => {
              const hot = f.edits >= 3 || f.thrashScore >= 6;
              const warm = !hot && f.edits >= 1;
              const touched = f.reads + f.edits > 0;
              const tileStyle = hot
                ? 'border-rose-500/70 bg-gradient-to-br from-rose-500/20 to-rose-950/30 shadow-[0_0_24px_-8px_rgba(244,63,94,0.5)]'
                : warm
                  ? 'border-amber-500/55 bg-gradient-to-br from-amber-500/15 to-amber-950/20'
                  : touched
                    ? 'border-sky-500/40 bg-sky-950/20'
                    : 'border-slate-800/80 bg-[#111827]/60 opacity-55';
              const activeFile = currentStep?.targetFile === f.path;
              const weightSpan = f.estimatedBytes > 550 ? 'sm:col-span-2' : '';
              const heatPct = Math.min(100, f.thrashScore * 14);
              return (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => {
                    const nextStep = f.touchedAtSteps.find((idx) => idx >= stepIdx) ?? f.touchedAtSteps[0];
                    if (nextStep !== undefined) setStepIdx(nextStep);
                    if (currentSnapshot[f.path] !== undefined) setSelectedSnapFile(f.path);
                  }}
                  className={`rounded-xl border p-3 text-left transition ${tileStyle} ${weightSpan} ${
                    activeFile ? 'ring-2 ring-violet-400' : 'hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs font-bold text-slate-100">{f.path}</span>
                    {hot ? (
                      <span className="shrink-0 rounded bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200">
                        THRASH ({f.edits} edits)
                      </span>
                    ) : warm ? (
                      <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200">
                        {f.edits} edit(s)
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-900/90">
                    <div
                      className={`h-full transition-all ${hot ? 'bg-rose-400' : warm ? 'bg-amber-400' : 'bg-sky-400'}`}
                      style={{ width: `${heatPct}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-slate-400">
                    <span>{f.reads} reads · {f.edits} edits</span>
                    <span>{f.estimatedBytes} B</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-1 flex-col overflow-hidden border-t border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-800 bg-[#111827] px-4 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <FileCode2 className="h-3.5 w-3.5 text-sky-400" />
                <span>Reconstructed Snapshot @ Step #{stepIdx + 1}</span>
              </div>
              <select
                value={selectedSnapFile ?? ''}
                onChange={(e) => setSelectedSnapFile(e.target.value)}
                className="rounded border border-slate-700 bg-[#0B0F17] px-2 py-0.5 font-mono text-[11px] text-slate-200"
              >
                {snapshotFiles.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <pre className="flex-1 overflow-auto p-4 font-mono text-[11.5px] leading-5 text-slate-300">
              {selectedSnapFile ? currentSnapshot[selectedSnapFile] ?? '(not modified or read yet at this step)' : 'Scrub forward to inspect reconstructed file state.'}
            </pre>
          </div>
        </section>

        {/* Step Inspector & 1-Click Revert Patch */}
        <section className="flex flex-col overflow-hidden bg-[#111827]">
          {currentStep && (
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="rounded-xl border border-slate-800 bg-[#0B0F17] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase ${KIND_BADGE[currentStep.kind]}`}>
                      {currentStep.toolName}
                    </span>
                    {currentStep.outcome === 'fail' && (
                      <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
                        <AlertCircle className="h-3 w-3" /> FAILED
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-slate-400">
                    +{currentStep.inputTokens} in / {currentStep.cacheReadTokens} cache / {currentStep.outputTokens} out ·{' '}
                    <span className="text-emerald-400">${currentStep.costUsd.toFixed(4)}</span>
                  </div>
                </div>
                <h2 className="mt-2 text-base font-bold text-slate-50">{currentStep.summary}</h2>
                {currentStep.targetFile && (
                  <p className="mt-1 font-mono text-xs text-sky-300">{currentStep.targetFile}</p>
                )}
                {currentStep.command && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-800 bg-[#111827] px-3 py-1.5 font-mono text-xs text-violet-300">
                    <Terminal className="h-3.5 w-3.5 shrink-0" />
                    <span>{currentStep.command}</span>
                  </div>
                )}
                {currentStep.outputPreview && (
                  <pre className={`mt-2 overflow-x-auto rounded-lg border p-3 font-mono text-[11.5px] ${
                    currentStep.outcome === 'fail'
                      ? 'border-rose-500/40 bg-rose-950/25 text-rose-200'
                      : 'border-slate-800 bg-[#111827] text-slate-300'
                  }`}>
                    {currentStep.outputPreview}
                  </pre>
                )}
              </div>

              {stepDiffLines.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0B0F17]">
                  <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-300">
                    <span>Step #{stepIdx + 1} Edit Diff</span>
                    <button
                      type="button"
                      onClick={() => setDiffMode((m) => (m === 'unified' ? 'split' : 'unified'))}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0B0F17] px-2 py-0.5 text-[10px] text-sky-300 hover:border-sky-500"
                    >
                      <Columns2 className="h-3 w-3" />
                      <span>{diffMode === 'unified' ? 'Switch to Split' : 'Switch to Unified'}</span>
                    </button>
                  </div>
                  {diffMode === 'unified' ? (
                    <div className="max-h-72 overflow-auto font-mono text-[11.5px] leading-5">
                      {stepDiffLines.map((l, idx) => (
                        <div
                          key={idx}
                          className={`grid grid-cols-[40px_40px_18px_1fr] px-2 ${
                            l.type === 'add'
                              ? 'bg-emerald-500/10 text-emerald-200'
                              : l.type === 'del'
                                ? 'bg-rose-500/10 text-rose-200'
                                : 'text-slate-400'
                          }`}
                        >
                          <span className="select-none pr-2 text-right text-[10px] text-slate-600">{l.oldLn ?? ''}</span>
                          <span className="select-none pr-2 text-right text-[10px] text-slate-600">{l.newLn ?? ''}</span>
                          <span className="select-none text-center font-bold">
                            {l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}
                          </span>
                          <pre className="whitespace-pre">{l.text || ' '}</pre>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-auto font-mono text-[11px] leading-5">
                      {splitRows.map((row, idx) => (
                        <div key={idx} className="grid grid-cols-2 divide-x divide-slate-800">
                          <div className={`flex px-2 ${row.oldKind === 'del' ? 'bg-rose-500/10 text-rose-200' : 'text-slate-400'}`}>
                            <span className="w-7 shrink-0 select-none text-right pr-2 text-[10px] text-slate-600">{row.oldLn ?? ''}</span>
                            <pre className="truncate whitespace-pre">{row.oldText || ' '}</pre>
                          </div>
                          <div className={`flex px-2 ${row.newKind === 'add' ? 'bg-emerald-500/10 text-emerald-200' : 'text-slate-400'}`}>
                            <span className="w-7 shrink-0 select-none text-right pr-2 text-[10px] text-slate-600">{row.newLn ?? ''}</span>
                            <pre className="truncate whitespace-pre">{row.newText || ' '}</pre>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 1-Click Revert / Rollback Patch Generator */}
              <div className="rounded-xl border border-slate-800 bg-[#0B0F17] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      Generate Revert Patch (`git apply`)
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Undo just this edit or roll back every file modified after Step #{stepIdx + 1}.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPatchMode('step')}
                      className={`rounded px-2 py-1 text-[11px] ${
                        patchMode === 'step' ? 'bg-violet-500/20 font-semibold text-violet-200' : 'text-slate-400'
                      }`}
                    >
                      Undo Step
                    </button>
                    <button
                      type="button"
                      onClick={() => setPatchMode('rollback')}
                      className={`rounded px-2 py-1 text-[11px] ${
                        patchMode === 'rollback' ? 'bg-violet-500/20 font-semibold text-violet-200' : 'text-slate-400'
                      }`}
                    >
                      Rollback All Post-Step
                    </button>
                    <button
                      type="button"
                      onClick={copyPatch}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#111827] px-2 py-1 text-[11px] text-slate-200 hover:border-sky-500"
                    >
                      {copiedPatch ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={downloadPatch}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#111827] px-2 py-1 text-[11px] text-slate-200 hover:border-emerald-500"
                    >
                      <Download className="h-3 w-3 text-emerald-400" />
                      .patch
                    </button>
                  </div>
                </div>
                <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-slate-800 bg-[#111827] p-3 font-mono text-[11px] text-slate-300">
                  {activePatch}
                </pre>
              </div>
            </div>
          )}
        </section>
      </div>
      </>
      )}
    </div>
  );
}

export default App;
