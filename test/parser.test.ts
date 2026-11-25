import { describe, expect, it } from 'vitest';
import { DEMO_AGENT_SESSION_JSON } from '../src/core/demoSession.ts';
import {
  buildReplaySession,
  generateRevertPatch,
  generateRollbackFromStepPatch,
} from '../src/core/parser.ts';

describe('agent-replay session parser & time-travel engine', () => {
  it('parses demo session, tracks thrashing files, and reconstructs per-step snapshots', () => {
    const session = buildReplaySession(DEMO_AGENT_SESSION_JSON, { isDemo: true });
    expect(session.steps.length).toBe(14);
    expect(session.totals.failedCommands).toBe(2);
    expect(session.totals.thrashFiles).toBeGreaterThanOrEqual(1);

    const topHotspot = session.heatmap[0];
    expect(topHotspot.path).toBe('src/middleware/rateLimit.ts');
    expect(topHotspot.edits).toBe(3);

    // Snapshot at step 1 (before Lua rewrite) should still have fixed-window incr()
    expect(session.snapshotsByStep[1]['src/middleware/rateLimit.ts']).toContain('redis.incr');
    // Snapshot at final step should contain SLIDING_LUA + randomUUID
    const lastIdx = session.steps.length - 1;
    expect(session.snapshotsByStep[lastIdx]['src/middleware/rateLimit.ts']).toContain('SLIDING_LUA');
  });

  it('parses Claude-style JSONL tool_use and tool_result logs with error detection', () => {
    const jsonl = [
      JSON.stringify({
        timestamp: '2026-11-25T10:00:00Z',
        message: {
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 500, cache_read_input_tokens: 1200, output_tokens: 150 },
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'x = 1', new_string: 'x = 2' } },
            { type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'npm test' } },
          ],
        },
      }),
      JSON.stringify({
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu_2', is_error: true, content: 'Command exited with code 1' }],
        },
      }),
    ].join('\n');

    const session = buildReplaySession(jsonl);
    expect(session.steps.length).toBe(2);
    expect(session.steps[0].kind).toBe('edit');
    expect(session.steps[1].outcome).toBe('fail');
  });

  it('generates clean revert and rollback unified patches', () => {
    const session = buildReplaySession(DEMO_AGENT_SESSION_JSON, { isDemo: true });
    const patch = generateRevertPatch(session, 10);
    expect(patch).toContain('--- a/src/middleware/rateLimit.ts');
    expect(patch).toContain('+++ b/src/middleware/rateLimit.ts');

    const rollback = generateRollbackFromStepPatch(session, 2);
    expect(rollback).toContain('Rollback to step #3');
    expect(rollback).toContain('redis.incr');
  });
});
