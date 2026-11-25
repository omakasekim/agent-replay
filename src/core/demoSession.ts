const RATE_LIMIT_V0 = `export async function checkLimit(key: string, max = 10) {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);
  return count <= max;
}`;

const RATE_LIMIT_V1 = `export async function checkLimit(key: string, max = 10) {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.pexpire(key, 60_000);
  }
  return { allowed: count <= max, remaining: Math.max(0, max - count) };
}`;

const RATE_LIMIT_V2 = `const SLIDING_LUA = \`
local key = KEYS[1]
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', key, 0, now - 60000)
local cnt = redis.call('ZCARD', key)
if cnt >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', key, now, ARGV[3])
redis.call('PEXPIRE', key, 60000)
return tonumber(ARGV[2]) - cnt
\`;

export async function checkLimit(key: string, max = 10) {
  const rem = await redis.eval(SLIDING_LUA, 1, key, Date.now(), max);
  return { allowed: rem > 0, remaining: rem };
}`;

const RATE_LIMIT_V3 = `const SLIDING_LUA = \`
local key = KEYS[1]
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', key, 0, now - 60000)
local cnt = redis.call('ZCARD', key)
if cnt >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', key, now, ARGV[3])
redis.call('PEXPIRE', key, 60000)
return tonumber(ARGV[2]) - cnt
\`;

export async function checkLimit(key: string, max = 10, reqId = crypto.randomUUID()) {
  const rem = Number(await redis.eval(SLIDING_LUA, 1, key, Date.now(), max, reqId));
  return { allowed: rem > 0, remaining: Math.max(0, rem - 1) };
}`;

const AUTH_MIDDLEWARE_V0 = `import { checkLimit } from '../middleware/rateLimit';

export async function authHandler(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? '127.0.0.1';
  if (!(await checkLimit(\`auth:\${ip}\`))) {
    return new Response('Too Many Requests', { status: 429 });
  }
  return new Response('OK', { status: 200 });
}`;

const AUTH_MIDDLEWARE_V1 = `import { checkLimit } from '../middleware/rateLimit';

export async function authHandler(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? '127.0.0.1';
  const lim = await checkLimit(\`auth:\${ip}\`, 10);
  if (!lim.allowed) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'X-RateLimit-Remaining': String(lim.remaining) },
    });
  }
  return new Response('OK', { status: 200 });
}`;

const TEST_V0 = `import { authHandler } from '../src/api/authHandler';

test('enforces burst sliding window rate limit', async () => {
  for (let i = 0; i < 10; i++) {
    const r = await authHandler(new Request('http://localhost/auth'));
    expect(r.status).toBe(200);
  }
  const blocked = await authHandler(new Request('http://localhost/auth'));
  expect(blocked.status).toBe(429);
});`;

const TEST_V1 = `import { authHandler } from '../src/api/authHandler';

test('enforces burst sliding window rate limit without boundary double-burst', async () => {
  for (let i = 0; i < 10; i++) {
    const r = await authHandler(new Request('http://localhost/auth'));
    expect(r.status).toBe(200);
  }
  const blocked = await authHandler(new Request('http://localhost/auth'));
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
});`;

const REDIS_CLIENT = `export const redis = {
  async eval(_script: string, _numKeys: number, ..._args: Array<string | number>) {
    return 10;
  },
  async incr(_key: string) {
    return 1;
  },
  async expire(_key: string, _sec: number) {},
  async pexpire(_key: string, _ms: number) {},
};`;

export const DEMO_AGENT_SESSION_JSON = JSON.stringify({
  title: 'Fix Sliding-Window Rate Limiter Boundary Bug',
  model: 'claude-sonnet-4-5',
  steps: [
    {
      kind: 'search',
      outcome: 'ok',
      toolName: 'Grep',
      targetFile: 'src/middleware/rateLimit.ts',
      summary: 'Locate rate limiter implementation matching 429 boundary test failure',
      outputPreview: 'src/middleware/rateLimit.ts:1: export async function checkLimit',
      inputTokens: 1420,
      cacheReadTokens: 0,
      outputTokens: 185,
    },
    {
      kind: 'read',
      outcome: 'ok',
      toolName: 'Read',
      targetFile: 'src/middleware/rateLimit.ts',
      summary: 'Read existing fixed-window Redis counter',
      afterContent: RATE_LIMIT_V0,
      inputTokens: 980,
      cacheReadTokens: 1400,
      outputTokens: 210,
    },
    {
      kind: 'read',
      outcome: 'ok',
      toolName: 'Read',
      targetFile: 'src/api/authHandler.ts',
      summary: 'Check authHandler call site expectations',
      afterContent: AUTH_MIDDLEWARE_V0,
      inputTokens: 640,
      cacheReadTokens: 2300,
      outputTokens: 140,
    },
    {
      kind: 'edit',
      outcome: 'ok',
      toolName: 'Edit',
      targetFile: 'src/middleware/rateLimit.ts',
      summary: 'Return { allowed, remaining } from checkLimit with millisecond TTL',
      beforeContent: RATE_LIMIT_V0,
      afterContent: RATE_LIMIT_V1,
      inputTokens: 820,
      cacheReadTokens: 2940,
      outputTokens: 420,
    },
    {
      kind: 'command',
      outcome: 'fail',
      toolName: 'Bash',
      command: 'npx vitest run tests/auth.test.ts',
      summary: 'Run auth rate-limit test suite (fails on truthy object check)',
      outputPreview: 'FAIL tests/auth.test.ts > expected 429, received 200 (!{ allowed: false } is always false)',
      inputTokens: 1250,
      cacheReadTokens: 3760,
      outputTokens: 190,
    },
    {
      kind: 'edit',
      outcome: 'ok',
      toolName: 'Edit',
      targetFile: 'src/api/authHandler.ts',
      summary: 'Check lim.allowed and set X-RateLimit-Remaining header',
      beforeContent: AUTH_MIDDLEWARE_V0,
      afterContent: AUTH_MIDDLEWARE_V1,
      inputTokens: 740,
      cacheReadTokens: 4800,
      outputTokens: 360,
    },
    {
      kind: 'read',
      outcome: 'ok',
      toolName: 'Read',
      targetFile: 'src/lib/redisClient.ts',
      summary: 'Inspect redis eval signature before writing atomic Lua script',
      afterContent: REDIS_CLIENT,
      inputTokens: 590,
      cacheReadTokens: 5400,
      outputTokens: 150,
    },
    {
      kind: 'edit',
      outcome: 'ok',
      toolName: 'Edit',
      targetFile: 'src/middleware/rateLimit.ts',
      summary: 'Switch fixed-window counter to atomic sorted-set sliding window Lua',
      beforeContent: RATE_LIMIT_V1,
      afterContent: RATE_LIMIT_V2,
      inputTokens: 1180,
      cacheReadTokens: 5900,
      outputTokens: 690,
    },
    {
      kind: 'command',
      outcome: 'fail',
      toolName: 'Bash',
      command: 'npx vitest run tests/auth.test.ts',
      summary: 'Re-run auth tests (fails: missing ARGV[3] member id in Lua call)',
      outputPreview: 'Error: ZADD member nil passed to SLIDING_LUA (missing ARGV[3])',
      inputTokens: 1320,
      cacheReadTokens: 7080,
      outputTokens: 210,
    },
    {
      kind: 'read',
      outcome: 'ok',
      toolName: 'Read',
      targetFile: 'src/middleware/rateLimit.ts',
      summary: 'Re-read rateLimit.ts lines 1-16 to inspect ARGV argument count',
      afterContent: RATE_LIMIT_V2,
      inputTokens: 420,
      cacheReadTokens: 8200,
      outputTokens: 120,
    },
    {
      kind: 'edit',
      outcome: 'ok',
      toolName: 'Edit',
      targetFile: 'src/middleware/rateLimit.ts',
      summary: 'Pass crypto.randomUUID() as ARGV[3] and cast eval result cleanly',
      beforeContent: RATE_LIMIT_V2,
      afterContent: RATE_LIMIT_V3,
      inputTokens: 890,
      cacheReadTokens: 8620,
      outputTokens: 510,
    },
    {
      kind: 'read',
      outcome: 'ok',
      toolName: 'Read',
      targetFile: 'tests/auth.test.ts',
      summary: 'Verify assertion coverage for X-RateLimit-Remaining header',
      afterContent: TEST_V0,
      inputTokens: 520,
      cacheReadTokens: 9400,
      outputTokens: 115,
    },
    {
      kind: 'edit',
      outcome: 'ok',
      toolName: 'Edit',
      targetFile: 'tests/auth.test.ts',
      summary: 'Assert X-RateLimit-Remaining === "0" on 429 rejection',
      beforeContent: TEST_V0,
      afterContent: TEST_V1,
      inputTokens: 640,
      cacheReadTokens: 9920,
      outputTokens: 320,
    },
    {
      kind: 'command',
      outcome: 'ok',
      toolName: 'Bash',
      command: 'npx vitest run && npm run build',
      summary: 'All 12 unit & integration tests pass cleanly',
      outputPreview: '✓ tests/auth.test.ts (12 passed) · dist built in 412ms',
      inputTokens: 780,
      cacheReadTokens: 10560,
      outputTokens: 280,
    },
  ],
});

export const DEMO_SQL_MIGRATION_SESSION_JSON = JSON.stringify({
  title: 'Zero-Downtime Postgres NOT NULL Migration',
  model: 'gemini-3-pro',
  steps: [
    {
      kind: 'read',
      outcome: 'ok',
      toolName: 'Read',
      targetFile: 'migrations/004_add_api_key.sql',
      summary: 'Inspect failing migration locking users table',
      afterContent: 'ALTER TABLE users ADD COLUMN api_key TEXT NOT NULL;\nCREATE INDEX idx_users_api_key ON users(api_key);',
      inputTokens: 1120,
      cacheReadTokens: 0,
      outputTokens: 190,
    },
    {
      kind: 'command',
      outcome: 'fail',
      toolName: 'Bash',
      command: 'drift-sentinel check migrations/004_add_api_key.sql',
      summary: 'Preflight check blocks ACCESS EXCLUSIVE table rewrite',
      outputPreview: '[BLOCKING] ADD COLUMN ... NOT NULL without DEFAULT rewrites table under ACCESS EXCLUSIVE lock',
      inputTokens: 920,
      cacheReadTokens: 1120,
      outputTokens: 165,
    },
    {
      kind: 'edit',
      outcome: 'ok',
      toolName: 'Edit',
      targetFile: 'migrations/004_add_api_key.sql',
      summary: 'Make column nullable first and use CONCURRENTLY index',
      beforeContent: 'ALTER TABLE users ADD COLUMN api_key TEXT NOT NULL;\nCREATE INDEX idx_users_api_key ON users(api_key);',
      afterContent: 'SET lock_timeout = \'2s\';\nALTER TABLE users ADD COLUMN api_key TEXT;\nCREATE INDEX CONCURRENTLY idx_users_api_key ON users(api_key);',
      inputTokens: 860,
      cacheReadTokens: 2040,
      outputTokens: 310,
    },
    {
      kind: 'write',
      outcome: 'ok',
      toolName: 'Write',
      targetFile: 'scripts/backfill_api_keys.ts',
      summary: 'Add chunked key backfill worker to avoid long transactions',
      beforeContent: '',
      afterContent: 'export async function backfillBatch(db: any, limit = 500) {\n  return db.query("UPDATE users SET api_key = gen_random_uuid() WHERE api_key IS NULL LIMIT $1", [limit]);\n}',
      inputTokens: 1040,
      cacheReadTokens: 2900,
      outputTokens: 430,
    },
    {
      kind: 'edit',
      outcome: 'ok',
      toolName: 'Edit',
      targetFile: 'migrations/004_add_api_key.sql',
      summary: 'Add NOT VALID check constraint + separate VALIDATE step',
      beforeContent: 'SET lock_timeout = \'2s\';\nALTER TABLE users ADD COLUMN api_key TEXT;\nCREATE INDEX CONCURRENTLY idx_users_api_key ON users(api_key);',
      afterContent: 'SET lock_timeout = \'2s\';\nALTER TABLE users ADD COLUMN api_key TEXT;\nALTER TABLE users ADD CONSTRAINT users_api_key_nn CHECK (api_key IS NOT NULL) NOT VALID;\nCREATE INDEX CONCURRENTLY idx_users_api_key ON users(api_key);',
      inputTokens: 780,
      cacheReadTokens: 3940,
      outputTokens: 290,
    },
    {
      kind: 'command',
      outcome: 'ok',
      toolName: 'Bash',
      command: 'drift-sentinel check migrations/004_add_api_key.sql',
      summary: 'Migration passes zero-downtime preflight checks',
      outputPreview: '✓ 0 blocking lock hazards · safe for online rollout',
      inputTokens: 640,
      cacheReadTokens: 4720,
      outputTokens: 140,
    },
  ],
});

export const DEMO_REACT_RACE_SESSION_JSON = JSON.stringify({
  title: 'Fix Stale Search Response Race Condition',
  model: 'claude-sonnet-4-5',
  steps: [
    {
      kind: 'read',
      outcome: 'ok',
      toolName: 'Read',
      targetFile: 'src/hooks/useSearch.ts',
      summary: 'Inspect search hook missing AbortController cancellation',
      afterContent: 'export function useSearch(query: string) {\n  const [data, setData] = useState([]);\n  useEffect(() => {\n    fetch(`/api/search?q=${query}`).then(r => r.json()).then(setData);\n  }, [query]);\n  return data;\n}',
      inputTokens: 980,
      cacheReadTokens: 0,
      outputTokens: 160,
    },
    {
      kind: 'edit',
      outcome: 'ok',
      toolName: 'Edit',
      targetFile: 'src/hooks/useSearch.ts',
      summary: 'Introduce AbortController cleanup inside useEffect',
      beforeContent: 'export function useSearch(query: string) {\n  const [data, setData] = useState([]);\n  useEffect(() => {\n    fetch(`/api/search?q=${query}`).then(r => r.json()).then(setData);\n  }, [query]);\n  return data;\n}',
      afterContent: 'export function useSearch(query: string) {\n  const [data, setData] = useState([]);\n  useEffect(() => {\n    const ctrl = new AbortController();\n    fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })\n      .then(r => r.json())\n      .then(setData)\n      .catch(() => {});\n    return () => ctrl.abort();\n  }, [query]);\n  return data;\n}',
      inputTokens: 890,
      cacheReadTokens: 980,
      outputTokens: 340,
    },
    {
      kind: 'command',
      outcome: 'fail',
      toolName: 'Bash',
      command: 'npx vitest run src/hooks/useSearch.test.ts',
      summary: 'Test fails when non-AbortError network error is swallowed silently',
      outputPreview: 'FAIL expected error state to be set on HTTP 500 response',
      inputTokens: 1120,
      cacheReadTokens: 1870,
      outputTokens: 210,
    },
    {
      kind: 'edit',
      outcome: 'ok',
      toolName: 'Edit',
      targetFile: 'src/hooks/useSearch.ts',
      summary: 'Ignore only AbortError and expose error state cleanly',
      beforeContent: 'export function useSearch(query: string) {\n  const [data, setData] = useState([]);\n  useEffect(() => {\n    const ctrl = new AbortController();\n    fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })\n      .then(r => r.json())\n      .then(setData)\n      .catch(() => {});\n    return () => ctrl.abort();\n  }, [query]);\n  return data;\n}',
      afterContent: 'export function useSearch(query: string) {\n  const [data, setData] = useState([]);\n  const [error, setError] = useState<string | null>(null);\n  useEffect(() => {\n    const ctrl = new AbortController();\n    setError(null);\n    fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })\n      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })\n      .then(setData)\n      .catch(err => { if (err.name !== "AbortError") setError(String(err)); });\n    return () => ctrl.abort();\n  }, [query]);\n  return { data, error };\n}',
      inputTokens: 940,
      cacheReadTokens: 2990,
      outputTokens: 410,
    },
    {
      kind: 'command',
      outcome: 'ok',
      toolName: 'Bash',
      command: 'npx vitest run src/hooks/useSearch.test.ts',
      summary: 'Race condition and HTTP 500 error tests pass',
      outputPreview: '✓ src/hooks/useSearch.test.ts (5 passed)',
      inputTokens: 610,
      cacheReadTokens: 3930,
      outputTokens: 130,
    },
  ],
});

export const DEMO_SESSION_PRESETS = [
  { id: 'rate-limiter', label: 'Rate Limiter Bugfix (14 steps)', raw: DEMO_AGENT_SESSION_JSON },
  { id: 'sql-migration', label: 'Postgres Online Migration (6 steps)', raw: DEMO_SQL_MIGRATION_SESSION_JSON },
  { id: 'react-race', label: 'React AbortController Race (5 steps)', raw: DEMO_REACT_RACE_SESSION_JSON },
] as const;
