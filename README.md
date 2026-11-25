# agent-replay

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-10b981.svg)
![Local First](https://img.shields.io/badge/privacy-100%25%20local-a78bfa.svg)

> Local-first visual session debugger and time-travel explorer for AI coding agent transcripts, file touch heatmaps, token/cost telemetry, and 1-click revert patches.

## Quickstart

```bash
npm install && npm run build
npx agent-replay --demo                    # Explore built-in 14-step rate-limiter debugging session
npx agent-replay ./path/to/session.jsonl   # Inspect a Claude Code JSONL or universal JSON transcript
```

## Highlights

- **Codebase Touch Heatmap:** Proportional file grid highlighting read/edit thrashing hotspots so you spot where an agent spun its wheels.
- **Scrubbable Timeline & Cost Strip:** Step forward/back or scrub across edits, reads, and failed test runs alongside per-step input/cache/output token cost telemetry.
- **State Reconstruction & Rollback:** Inspect reconstructed file snapshots at any historical step and copy/download a ready-to-apply `git apply` revert or full post-step rollback `.patch`.

## Verify

```bash
npm test
npm run build
```
