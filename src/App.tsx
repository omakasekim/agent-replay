import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Copy,
  Download,
  FileCode2,
  Flame,
  Pause,
  Play,
  Terminal,
  Upload,
} from 'lucide-react';
import { DEMO_AGENT_SESSION_JSON } from './core/demoSession.ts';
import {
  buildReplaySession,
  buildUnifiedDiffLines,
  generateRevertPatch,
  generateRollbackFromStepPatch,
} from './core/parser.ts';
import type { ReplaySession, StepKind } from './core/types.ts';

const KIND_BADGE: Record<StepKind, string> = {
  read: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  edit: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  write: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  command: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  search: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  reasoning: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
};

export function App() {
  const [session, setSession] = useState<ReplaySession>(() =>
    buildReplaySession(DEMO_AGENT_SESSION_JSON, { id: 'demo', isDemo: true }),
  );
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [patchMode, setPatchMode] = useState<'step' | 'rollback'>('step');
  const [copiedPatch, setCopiedPatch] = useState(false);
  const [selectedSnapFile, setSelectedSnapFile] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ReplaySession | null) => {
        if (data && Array.isArray(data.steps) && data.steps.length > 0) {
          setSession(data);
          setStepIdx(0);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!playing || session.steps.length === 0) return;
    const t = setInterval(() => {
      setStepIdx((prev) => (prev + 1 < session.steps.length ? prev + 1 : 0));
    }, 1500);
    return () => clearInterval(t);
  }, [playing, session.steps.length]);

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

  const activePatch = useMemo(() => {
    if (!currentStep) return '';
    return patchMode === 'step'
      ? generateRevertPatch(session, stepIdx)
      : generateRollbackFromStepPatch(session, stepIdx);
  }, [session, stepIdx, patchMode, currentStep]);

  const handleUploadLog = async (file: File) => {
    const text = await file.text();
    const parsed = buildReplaySession(text, {
      id: file.name,
      title: `Uploaded: ${file.name}`,
      isDemo: false,
    });
    if (parsed.steps.length > 0) {
      setSession(parsed);
      setStepIdx(0);
      setPlaying(false);
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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0B0F17] text-slate-100">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#111827] px-4 py-2.5">
        <div className="flex items-center gap-3">
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
                  DEMO TRACE
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              {session.title} · {session.steps.length} steps ·{' '}
              <span className="font-mono text-amber-300">{session.totals.thrashFiles} thrash hotspot(s)</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-1 font-mono text-xs">
            <span className="text-slate-400">
              Tokens <strong className="text-slate-100">{(session.totals.totalTokens / 1000).toFixed(1)}k</strong>
            </span>
            <span className="flex items-center gap-1 text-emerald-400">
              <Coins className="h-3.5 w-3.5" />${session.totals.totalCostUsd.toFixed(4)}
            </span>
            <span className="text-rose-400">{session.totals.failedCommands} test fail(s)</span>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 hover:border-violet-500">
            <Upload className="h-3.5 w-3.5 text-violet-400" />
            <span>Load JSON / JSONL</span>
            <input
              type="file"
              accept=".json,.jsonl"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUploadLog(f);
              }}
            />
          </label>
        </div>
      </header>

      {/* Top Scrubbable Timeline + Token/Cost Bar Chart */}
      <section className="border-b border-slate-800 bg-[#0F172A] px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
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
            className="mx-3 h-1.5 flex-1 cursor-pointer accent-violet-400"
          />

          <div className="hidden items-center gap-3 text-[11px] text-slate-400 sm:flex">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-400" /> Input</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-600" /> Cache</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-violet-400" /> Output</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Fail</span>
          </div>
        </div>

        {/* Interactive per-step token & event strip */}
        <div className="grid grid-flow-col gap-1.5 overflow-x-auto pb-1">
          {session.steps.map((s) => {
            const total = s.inputTokens + s.cacheReadTokens + s.outputTokens;
            const hPct = Math.max(12, Math.round((total / maxTokensInStep) * 100));
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
                className={`group flex h-14 min-w-[34px] flex-col items-center justify-end rounded-lg border px-1 py-1 transition ${
                  active
                    ? 'border-violet-400 bg-violet-500/20'
                    : 'border-slate-800 bg-[#111827] hover:border-slate-600'
                }`}
              >
                <div className="flex h-8 w-full items-end justify-center">
                  <div className={`w-3 rounded-t ${barColor}`} style={{ height: `${hPct}%` }} />
                </div>
                <span className="mt-0.5 font-mono text-[9px] text-slate-400">#{s.index + 1}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Split: Left Codebase Heatmap + Snapshot, Right Step Inspector + Revert Patch */}
      <div className="grid flex-1 overflow-hidden lg:grid-cols-[1.05fr_1.25fr]">
        {/* Codebase Touch Heatmap & Reconstructed Snapshot */}
        <section className="flex flex-col overflow-hidden border-r border-slate-800 bg-[#0B0F17]">
          <div className="flex items-center justify-between border-b border-slate-800 bg-[#111827] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Codebase Touch Heatmap (Size vs. Read/Edit Thrash)
              </h2>
            </div>
          </div>

          <div className="grid gap-2.5 p-4 sm:grid-cols-2">
            {session.heatmap.map((f) => {
              const hot = f.edits >= 3 || f.thrashScore >= 6;
              const tileStyle = hot
                ? 'border-rose-500/60 bg-rose-500/10'
                : f.edits >= 1
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-slate-800 bg-[#111827]';
              const activeFile = currentStep?.targetFile === f.path;
              const weightSpan = f.estimatedBytes > 600 ? 'sm:col-span-2' : '';
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
                    {hot && (
                      <span className="shrink-0 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                        THRASH ({f.edits} edits)
                      </span>
                    )}
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
                  <div className="border-b border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-300">
                    Step #{stepIdx + 1} Edit Diff
                  </div>
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
    </div>
  );
}

export default App;
