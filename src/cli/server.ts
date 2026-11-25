import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_AGENT_SESSION_JSON } from '../core/demoSession.ts';
import { buildReplaySession } from '../core/parser.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function parseArgs(argv: string[]) {
  let logPath: string | undefined;
  let demo = false;
  let port = 4323;
  let noOpen = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') demo = true;
    else if (a === '--no-open') noOpen = true;
    else if (a === '--port' && argv[i + 1]) port = Number(argv[++i]) || 4323;
    else if (a.startsWith('--port=')) port = Number(a.slice(7)) || 4323;
    else if (!a.startsWith('-')) logPath = resolve(a);
  }
  return { logPath, demo, port, noOpen };
}

function loadInitialSession(logPath: string | undefined, forceDemo: boolean) {
  if (!forceDemo && logPath && existsSync(logPath) && statSync(logPath).isFile()) {
    const raw = readFileSync(logPath, 'utf8');
    const parsed = buildReplaySession(raw, {
      id: logPath.split('/').pop() ?? 'session',
      title: `Session: ${logPath.split('/').pop()}`,
      isDemo: false,
    });
    if (parsed.steps.length > 0) return parsed;
  }
  return buildReplaySession(DEMO_AGENT_SESSION_JSON, {
    id: 'demo-rate-limiter',
    isDemo: true,
  });
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* ignore */
  }
}

export async function startCli(argv: string[]) {
  const { logPath, demo, port, noOpen } = parseArgs(argv);
  const here = dirname(fileURLToPath(import.meta.url));
  const clientDir = resolve(here, 'client');
  const session = loadInitialSession(logPath, demo);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/session') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(session));
      return;
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const target = resolve(clientDir, rel);
    const filePath = target.startsWith(clientDir) && existsSync(target) && statSync(target).isFile()
      ? target
      : join(clientDir, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });

  await new Promise<void>((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
  const listenUrl = `http://127.0.0.1:${port}`;
  console.log(`agent-replay listening at ${listenUrl} (steps=${session.steps.length}, demo=${session.isDemo})`);
  if (!noOpen) openBrowser(listenUrl);
}
