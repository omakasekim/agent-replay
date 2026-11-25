import { describe, expect, it } from 'vitest';
import {
  DEMO_AGENT_SESSION_JSON,
  DEMO_REACT_RACE_SESSION_JSON,
  DEMO_SQL_MIGRATION_SESSION_JSON,
} from '../src/core/demoSession.ts';
import {
  buildReplaySession,
  generateRevertPatch,
  generateRollbackFromStepPatch,
} from '../src/core/parser.ts';

describe('agent-replay session parser & rollback generator', () => {
  it('reconstructs file snapshots, heatmap thrash scores, and cost totals from demo JSON', () => {
    const session = buildReplaySession(DEMO_AGENT_SESSION_JSON, { isDemo: true });
    expect(session.steps.length).toBe(14);
    expect(session.totals.failedCommands).toBe(2);
    expect(session.totals.totalCostUsd).toBeGreaterThan(0);

    const hotFile = session.heatmap.find((h) => h.path === 'src/middleware/rateLimit.ts');
    expect(hotFile).toBeDefined();
    expect(hotFile!.edits).toBe(3);
    expect(session.snapshotsByStep[10]['src/middleware/rateLimit.ts']).toContain('crypto.randomUUID');
  });

  it('generates valid unified revert and multi-file rollback patches', () => {
    const session = buildReplaySession(DEMO_AGENT_SESSION_JSON, { isDemo: true });
    const stepPatch = generateRevertPatch(session, 10);
    expect(stepPatch).toContain('--- a/src/middleware/rateLimit.ts');
    expect(stepPatch).toContain('-export async function checkLimit(key: string, max = 10, reqId = crypto.randomUUID())');

    const rollback = generateRollbackFromStepPatch(session, 3);
    expect(rollback).toContain('--- a/src/middleware/rateLimit.ts');
  });

  it('parses Claude Code JSONL transcripts with assistant tool_use blocks', () => {
    const jsonl = [
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 500, cache_read_input_tokens: 1200, output_tokens: 140 },
          content: [
            { type: 'tool_use', name: 'Edit', input: { file_path: 'src/app.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 300, output_tokens: 90 },
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }],
        },
      }),
    ].join('\n');

    const session = buildReplaySession(jsonl);
    expect(session.steps).toHaveLength(2);
    expect(session.steps[0].kind).toBe('edit');
    expect(session.steps[1].command).toBe('npm test');
  });

  it('parses SQL migration and React race presets cleanly', () => {
    const sql = buildReplaySession(DEMO_SQL_MIGRATION_SESSION_JSON, { isDemo: true });
    expect(sql.steps.length).toBe(6);
    expect(sql.totals.failedCommands).toBe(1);

    const react = buildReplaySession(DEMO_REACT_RACE_SESSION_JSON, { isDemo: true });
    expect(react.steps.length).toBe(5);
    expect(react.snapshotsByStep[4]['src/hooks/useSearch.ts']).toContain('AbortController');
  });
});
