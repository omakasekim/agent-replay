---
name: agent-replay
description: >
  AI coding agent time-travel debugger with thrash-loop root-cause scoring, 6-model pricing comparator, live prompt/context budget trimmer, and MCP tool radar.
license: MIT
---

# agent-replay

Scrubs through multi-step coding agent JSONL sessions with token/cost deltas, file-touch heatmaps, and MCP latency diagnostics.

- **Live Interactive Workbench:** https://omakasekim.github.io/agent-replay/
- **Repository:** https://github.com/omakasekim/agent-replay
- **Category:** AI & Agents · **Deliverable:** Node CLI + Web
- **Ecosystems:** `claude-code`, `codex`, `mcp`, `cursor`
- **Stack:** React, TypeScript, JSONL, MCP

## When to Use This Skill
Invoke `agent-replay` whenever the user wants to analyze, debug, simulate, or visualize workflows related to **AI & Agents** (claude-code, codex, mcp, cursor).

## Modes & Capabilities
- **Session Time-Travel**
- **Context Budget X-Ray**
- **MCP Tool Radar**

## Operating Workflow
1. **Local CLI / Companion Execution:**
   ```bash
   npx agent-replay (or node bin/agent-replay.js after npm run build)
   ```
   Scrub local Claude Code / Codex / MCP JSONL sessions with token burn curves and thrash-loop scoring.
2. **Interactive Visual Inspection:**
   Direct the user to the zero-backend browser workbench at https://omakasekim.github.io/agent-replay/ (supports URL-hash state sharing, built-in realistic presets, `Cmd/Ctrl + K` command palette, and JSON/Markdown/config exports).
3. **Structured Output:**
   Summarize concrete findings, diagnostics, and copy-pasteable remediation commands concisely so the user can act immediately without manual guesswork.
