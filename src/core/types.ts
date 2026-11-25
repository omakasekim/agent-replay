export type StepKind = 'read' | 'edit' | 'write' | 'command' | 'search' | 'reasoning';
export type StepOutcome = 'ok' | 'fail';

export interface SessionStep {
  index: number;
  timestamp: string;
  kind: StepKind;
  outcome: StepOutcome;
  toolName: string;
  targetFile?: string;
  summary: string;
  command?: string;
  outputPreview?: string;
  beforeContent?: string;
  afterContent?: string;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface FileHeatmapEntry {
  path: string;
  reads: number;
  edits: number;
  thrashScore: number;
  estimatedBytes: number;
  touchedAtSteps: number[];
}

export interface ReplaySession {
  id: string;
  title: string;
  model: string;
  isDemo: boolean;
  steps: SessionStep[];
  /** Snapshot map indexed by step index (0..N-1) -> Map(filePath -> content). */
  snapshotsByStep: Array<Record<string, string>>;
  heatmap: FileHeatmapEntry[];
  totals: {
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    failedCommands: number;
    thrashFiles: number;
  };
}
