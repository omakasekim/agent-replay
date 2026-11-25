import type { FileHeatmapEntry, ReplaySession, SessionStep, StepKind, StepOutcome } from './types.ts';

function estimateCostUsd(input: number, cacheRead: number, output: number): number {
  // Approximate frontier coding model pricing per 1M tokens ($3/M in, $0.30/M cache read, $15/M out)
  return (input * 3 + cacheRead * 0.3 + output * 15) / 1_000_000;
}

export function buildUnifiedDiffLines(
  filePath: string,
  beforeText: string,
  afterText: string,
): Array<{ type: 'context' | 'add' | 'del'; text: string; oldLn: number | null; newLn: number | null }> {
  const a = beforeText.split('\n');
  const b = afterText.split('\n');
  const n = a.length;
  const m = b.length;

  // LCS dynamic programming table (fine for file edits; cap fallback for huge files)
  if (n * m > 40_000) {
    return [
      ...a.map((text, idx) => ({ type: 'del' as const, text, oldLn: idx + 1, newLn: null })),
      ...b.map((text, idx) => ({ type: 'add' as const, text, oldLn: null, newLn: idx + 1 })),
    ];
  }

  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: Array<{ type: 'context' | 'add' | 'del'; text: string; oldLn: number | null; newLn: number | null }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'context', text: a[i], oldLn: i + 1, newLn: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i], oldLn: i + 1, newLn: null });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j], oldLn: null, newLn: j + 1 });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: a[i], oldLn: i + 1, newLn: null });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', text: b[j], oldLn: null, newLn: j + 1 });
    j++;
  }
  void filePath;
  return ops;
}

export function generateRevertPatch(session: ReplaySession, stepIndex: number): string {
  const step = session.steps[stepIndex];
  if (!step || !step.targetFile) return '# Selected step did not modify a file.';
  const before = step.afterContent ?? '';
  const after = step.beforeContent ?? '';
  const diffLines = buildUnifiedDiffLines(step.targetFile, before, after);
  const oldLines = before ? before.split('\n').length : 0;
  const newLines = after ? after.split('\n').length : 0;
  const body = diffLines
    .map((l) => `${l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}${l.text}`)
    .join('\n');

  return [
    `--- a/${step.targetFile}`,
    `+++ b/${step.targetFile}`,
    `@@ -${oldLines ? 1 : 0},${oldLines} +${newLines ? 1 : 0},${newLines} @@ Revert step #${step.index + 1}: ${step.summary}`,
    body,
    '',
  ].join('\n');
}

export function generateRollbackFromStepPatch(session: ReplaySession, targetStepIndex: number): string {
  const targetSnap = session.snapshotsByStep[targetStepIndex] ?? {};
  const finalSnap = session.snapshotsByStep[session.snapshotsByStep.length - 1] ?? {};
  const allPaths = Array.from(new Set([...Object.keys(targetSnap), ...Object.keys(finalSnap)])).sort();

  const chunks: string[] = [];
  for (const p of allPaths) {
    const finalText = finalSnap[p] ?? '';
    const targetText = targetSnap[p] ?? '';
    if (finalText === targetText) continue;
    const diffLines = buildUnifiedDiffLines(p, finalText, targetText);
    const oldCnt = finalText ? finalText.split('\n').length : 0;
    const newCnt = targetText ? targetText.split('\n').length : 0;
    chunks.push(
      `--- a/${p}\n+++ b/${p}\n@@ -${oldCnt ? 1 : 0},${oldCnt} +${newCnt ? 1 : 0},${newCnt} @@ Rollback to step #${targetStepIndex + 1}\n` +
        diffLines.map((l) => `${l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}${l.text}`).join('\n'),
    );
  }
  return chunks.length > 0 ? chunks.join('\n') + '\n' : `# Working tree matches step #${targetStepIndex + 1}; no rollback needed.\n`;
}

function normalizeStepFromGeneric(raw: Record<string, unknown>, idx: number): SessionStep {
  const kindRaw = String(raw.kind ?? raw.type ?? 'reasoning').toLowerCase();
  const kind: StepKind =
    kindRaw === 'read' || kindRaw === 'edit' || kindRaw === 'write' || kindRaw === 'command' || kindRaw === 'search'
      ? kindRaw
      : 'reasoning';
  const inputTokens = Number(raw.inputTokens ?? raw.input_tokens ?? 0) || 0;
  const cacheReadTokens = Number(raw.cacheReadTokens ?? raw.cache_read_input_tokens ?? 0) || 0;
  const outputTokens = Number(raw.outputTokens ?? raw.output_tokens ?? 0) || 0;
  const costUsd =
    typeof raw.costUsd === 'number'
      ? raw.costUsd
      : estimateCostUsd(inputTokens, cacheReadTokens, outputTokens);

  return {
    index: idx,
    timestamp: String(raw.timestamp ?? new Date(Date.UTC(2026, 10, 25, 10, idx)).toISOString()),
    kind,
    outcome: raw.outcome === 'fail' ? 'fail' : 'ok',
    toolName: String(raw.toolName ?? raw.tool ?? kind),
    targetFile: typeof raw.targetFile === 'string' ? raw.targetFile : typeof raw.file === 'string' ? raw.file : undefined,
    summary: String(raw.summary ?? raw.message ?? `${kind} step`),
    command: typeof raw.command === 'string' ? raw.command : undefined,
    outputPreview: typeof raw.outputPreview === 'string' ? raw.outputPreview : typeof raw.output === 'string' ? raw.output : undefined,
    beforeContent: typeof raw.beforeContent === 'string' ? raw.beforeContent : undefined,
    afterContent: typeof raw.afterContent === 'string' ? raw.afterContent : undefined,
    inputTokens,
    cacheReadTokens,
    outputTokens,
    costUsd,
  };
}

function parseJsonlEvents(lines: string[]): { model: string; steps: SessionStep[] } {
  const steps: SessionStep[] = [];
  let model = 'claude-code-transcript';
  const liveFiles = new Map<string, string>();
  const toolUseById = new Map<string, number>();

  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Handle direct step-array JSONL
    if (typeof obj.kind === 'string' && typeof obj.summary === 'string') {
      steps.push(normalizeStepFromGeneric(obj, steps.length));
      continue;
    }

    const ts = String(obj.timestamp ?? new Date().toISOString());
    const msg = (obj.message ?? obj) as Record<string, unknown>;
    if (typeof msg.model === 'string') model = msg.model;
    const usage = (msg.usage ?? {}) as Record<string, unknown>;
    const inTok = Number(usage.input_tokens ?? 0) || 0;
    const cacheTok = Number(usage.cache_read_input_tokens ?? 0) || 0;
    const outTok = Number(usage.output_tokens ?? 0) || 0;

    const content = Array.isArray(msg.content) ? msg.content : [];
    let usageAttributed = false;

    for (const block of content as Array<Record<string, unknown>>) {
      if (block?.type === 'tool_use') {
        const toolName = String(block.name ?? 'tool');
        const input = (block.input ?? {}) as Record<string, unknown>;
        const filePath =
          typeof input.file_path === 'string'
            ? input.file_path
            : typeof input.path === 'string'
              ? input.path
              : undefined;
        const lower = toolName.toLowerCase();
        const kind: StepKind =
          lower.includes('read')
            ? 'read'
            : lower.includes('write')
              ? 'write'
              : lower.includes('edit') || lower.includes('replace')
                ? 'edit'
                : lower.includes('bash') || lower.includes('command')
                  ? 'command'
                  : 'search';

        const prevContent = filePath ? liveFiles.get(filePath) ?? '' : undefined;
        let nextContent = prevContent;
        if (filePath && kind === 'write' && typeof input.content === 'string') {
          nextContent = input.content;
          liveFiles.set(filePath, nextContent);
        } else if (
          filePath &&
          kind === 'edit' &&
          typeof input.old_string === 'string' &&
          typeof input.new_string === 'string'
        ) {
          const base = prevContent ?? input.old_string;
          nextContent = base.replace(input.old_string, input.new_string);
          liveFiles.set(filePath, nextContent);
        }

        const stepIdx = steps.length;
        const iTok = usageAttributed ? 0 : inTok;
        const cTok = usageAttributed ? 0 : cacheTok;
        const oTok = usageAttributed ? 0 : outTok;
        usageAttributed = true;

        steps.push({
          index: stepIdx,
          timestamp: ts,
          kind,
          outcome: 'ok',
          toolName,
          targetFile: filePath,
          summary: filePath
            ? `${toolName} ${filePath.split('/').pop()}`
            : typeof input.command === 'string'
              ? `Run ${input.command.slice(0, 60)}`
              : `Invoke ${toolName}`,
          command: typeof input.command === 'string' ? input.command : undefined,
          beforeContent: kind === 'edit' || kind === 'write' ? prevContent : undefined,
          afterContent: kind === 'edit' || kind === 'write' ? nextContent : undefined,
          inputTokens: iTok,
          cacheReadTokens: cTok,
          outputTokens: oTok,
          costUsd: estimateCostUsd(iTok, cTok, oTok),
        });
        if (typeof block.id === 'string') {
          toolUseById.set(block.id, stepIdx);
        }
      } else if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const idx = toolUseById.get(block.tool_use_id);
        if (idx !== undefined && steps[idx]) {
          const textOut =
            typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n')
                : '';
          steps[idx].outputPreview = textOut.slice(0, 800);
          if (block.is_error === true || /\b(FAIL|Error:|Command exited with code [1-9])\b/.test(textOut)) {
            steps[idx].outcome = 'fail';
          }
        }
      }
    }
  }

  return { model, steps };
}

export function buildReplaySession(
  rawText: string,
  opts: { id?: string; title?: string; isDemo?: boolean } = {},
): ReplaySession {
  let title = opts.title ?? 'Agent Coding Session';
  let model = 'agent-session-v1';
  let steps: SessionStep[] = [];

  const trimmed = rawText.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        steps = parsed.map((item, idx) => normalizeStepFromGeneric(item as Record<string, unknown>, idx));
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (typeof obj.title === 'string') title = obj.title;
        if (typeof obj.model === 'string') model = obj.model;
        if (Array.isArray(obj.steps)) {
          steps = obj.steps.map((item, idx) => normalizeStepFromGeneric(item as Record<string, unknown>, idx));
        }
      }
    } catch {
      const jsonl = parseJsonlEvents(trimmed.split('\n'));
      model = jsonl.model;
      steps = jsonl.steps;
    }
  } else {
    const jsonl = parseJsonlEvents(trimmed.split('\n'));
    model = jsonl.model;
    steps = jsonl.steps;
  }

  // Reconstruct per-step file snapshots + cumulative touch heatmap
  const snapshotsByStep: Array<Record<string, string>> = [];
  const workingSnap: Record<string, string> = {};
  const touchMap = new Map<string, { reads: number; edits: number; steps: number[]; bytes: number }>();

  for (const step of steps) {
    if (step.targetFile) {
      const entry = touchMap.get(step.targetFile) ?? { reads: 0, edits: 0, steps: [], bytes: 180 };
      if (step.kind === 'read' || step.kind === 'search') {
        entry.reads += 1;
        if (step.afterContent && !(step.targetFile in workingSnap)) {
          workingSnap[step.targetFile] = step.afterContent;
        }
      } else if (step.kind === 'edit' || step.kind === 'write') {
        entry.edits += 1;
        if (step.beforeContent !== undefined && !(step.targetFile in workingSnap)) {
          // Initialize pre-step baseline cleanly if this is the first touch
        }
        if (step.afterContent !== undefined) {
          workingSnap[step.targetFile] = step.afterContent;
        }
      }
      const snapContent = workingSnap[step.targetFile] ?? step.afterContent ?? step.beforeContent ?? '';
      entry.bytes = Math.max(entry.bytes, snapContent.length);
      if (!entry.steps.includes(step.index)) entry.steps.push(step.index);
      touchMap.set(step.targetFile, entry);
    }
    snapshotsByStep.push({ ...workingSnap });
  }

  const heatmap: FileHeatmapEntry[] = Array.from(touchMap.entries())
    .map(([path, info]) => {
      const thrashScore = info.edits * 2 + info.reads + (info.edits >= 3 ? 3 : 0);
      return {
        path,
        reads: info.reads,
        edits: info.edits,
        thrashScore,
        estimatedBytes: info.bytes,
        touchedAtSteps: info.steps,
      };
    })
    .sort((a, b) => b.thrashScore - a.thrashScore);

  const totals = steps.reduce(
    (acc, s) => {
      acc.inputTokens += s.inputTokens;
      acc.cacheReadTokens += s.cacheReadTokens;
      acc.outputTokens += s.outputTokens;
      acc.totalTokens += s.inputTokens + s.cacheReadTokens + s.outputTokens;
      acc.totalCostUsd += s.costUsd;
      if (s.kind === 'command' && s.outcome === 'fail') acc.failedCommands += 1;
      return acc;
    },
    {
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      failedCommands: 0,
      thrashFiles: heatmap.filter((h) => h.edits >= 3 || h.thrashScore >= 6).length,
    },
  );

  return {
    id: opts.id ?? 'session-1',
    title,
    model,
    isDemo: Boolean(opts.isDemo),
    steps,
    snapshotsByStep,
    heatmap,
    totals,
  };
}
