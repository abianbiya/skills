# @abianbiya/llm-audit

A [pi](https://pi.dev) extension for **context-cost investigation**: it records the final provider payload pi sends, the measured shape of that payload, the usage pi reports, and turn/tool timing — then tells you *which* part of your context is expensive, down to the individual tool schema and the individual file in the system prompt.

It measures. It does not replay requests.

## Install

```bash
pi install npm:@abianbiya/llm-audit
```

This repository is the package source: `llm-audit-pi/` publishes as `@abianbiya/llm-audit`, and the shipped `llm-audit/` tree is a byte-for-byte copy of the dev extension (enforced by `prepublishOnly`).

## Quick start

1. `/llm-audit` — see the current state and a live snapshot of this session.
2. Do some work.
3. `/llm-audit` again — now it shows measured payload bytes, real input/output/cache tokens, timing, and per-tool schema cost.
4. `/llm-audit html` — writes and **opens** a self-contained HTML report for the session.
5. `/llm-audit sources` — where the system prompt's bytes came from, per file (requires captured payloads; see [Modes](#modes)).

## Why

That a session is expensive is easy to notice and hard to explain. The common culprits are invisible from inside the conversation:

```text
payload 51.8 KiB (~13.2k rough tokens)
  tool schemas  30.6 KiB  59%   <- which tools?
  system        20.8 KiB  40%
```

`llm-audit` answers the "which tools?" part: every tool definition is sized individually and cross-referenced against the tools that were actually called, so a schema that is re-sent on every request but never used shows up as a named, measurable cost.

## Privacy first

The default `metrics` mode stores **no prompt text, source code, tool output, headers, or payload** — only sizes, estimates, normalized usage, and timing. Content capture requires both a mode change *and* `capturePayload: true` (or the `/llm-audit capture` command, which warns before enabling), so a one-word edit cannot start retaining your code. In every mode, values that look like API keys, tokens, cookies, passwords, or private keys are redacted. Files are written `0600` in a `0700` directory.

## Commands

One command with subcommands — `/llm-audit <tab>` completes them:

| Subcommand | What it does |
| --- | --- |
| `/llm-audit` (or `status`) | enabled/mode/log path and session snapshot |
| `/llm-audit on` / `off` / `toggle` | capture on or off for this session |
| `/llm-audit capture metrics\|redacted\|full` | sets mode **and** content capture together, with a warning |
| `/llm-audit config` | interactive settings panel (explicit save to the config file) |
| `/llm-audit sources [session\|latest]` | **where the system prompt's bytes come from, per file** |
| `/llm-audit sessions` | list recent session logs with request/payload counts and projects |
| `/llm-audit tools` | **per-tool schema bytes and call counts** |
| `/llm-audit last` | safe summary of the last request (never prompt text) |
| `/llm-audit html [<session>\|<path>] [--no-body] [--no-open]` | **writes and opens the HTML report** |
| `/llm-audit report` | Markdown report |
| `/llm-audit export` | normalized `*.export.json` and `*.export.csv` |
| `/llm-audit baseline` | save this session's export as the comparison baseline |
| `/llm-audit compare [file]` | signed deltas against the baseline (or a given export) |
| `/llm-audit clean` | delete only expired `*.jsonl` in the log directory |
| `/llm-audit help` | list the subcommands |

### Settings panel

`/llm-audit config` opens a dialog-driven panel for capture on/off, content mode, status-line options, retention, log directory, and provider/model exclusions. Changes apply to the running session immediately; **Save to config file** is a separate action that validates and writes `<profile>/llm-audit.json` (`0600`). Nothing is persisted implicitly — switching to `full` capture by itself must not silently make every future session record prompts and source code, so saving that choice asks for confirmation. A config file that cannot be parsed is never overwritten.

### Status line

The footer entry always leads with the audit state — `llm-audit off`, `llm-audit metrics`, `llm-audit full` — so the active mode is visible as soon as the session starts, before any request completes. A content mode that is not actually capturing is called out (`llm-audit full (capture off)`), which is the state where someone expects prompts to be recorded and they are not. When `showTurnSummary` is enabled, the last-request summary follows it. Any `/llm-audit` command re-renders the line immediately; `showStatus: false` removes the whole entry.

## Configuration

`<profile>/llm-audit.json` when it exists (profile dir named by `PI_CODING_AGENT_DIR`), otherwise `~/.pi/agent/llm-audit.json` — so per-profile `mode` and `logDirectory` are honoured. Saves prefer the active profile dir. Restart or `/reload` after editing by hand.

```json
{
  "enabled": true,
  "mode": "metrics",
  "logDirectory": "~/.pi/agent/logs/llm-audit",
  "capturePayload": false,
  "captureHeaders": false,
  "showStatus": true,
  "showTurnSummary": true,
  "roughCharactersPerToken": 4,
  "maxPayloadBytes": 10485760,
  "maxFieldBytes": 1048576,
  "retentionDays": 30,
  "redactFieldNames": [],
  "redactPatterns": [],
  "excludeModels": [],
  "excludeProviders": []
}
```

| Key | Meaning |
| --- | --- |
| `enabled` | master capture switch for new sessions |
| `mode` | `metrics` \| `redacted` \| `full` — see below |
| `logDirectory` | where per-session `*.jsonl` logs and exports live (`~` expands) |
| `capturePayload` | store the (redacted) payload body; `metrics` mode never stores it |
| `captureHeaders` | additionally record safe request/response headers in `redacted`/`full` |
| `showStatus` | show the status-line entry after turns |
| `showTurnSummary` | append the last-request summary to the status line |
| `roughCharactersPerToken` | characters per rough-token estimate (default 4) |
| `maxPayloadBytes` | capture cap, 1 KiB–100 MiB |
| `maxFieldBytes` | per-field cap, 256 B–10 MiB (clamped to `maxPayloadBytes`) |
| `retentionDays` | expiry for `/llm-audit clean`; **0 disables cleanup** |
| `redactFieldNames` | extra field names to scrub (e.g. `["internal_note"]`) |
| `redactPatterns` | extra regexes to scrub (e.g. `["ACME-[A-Z0-9]{20}"]`) |
| `excludeModels` | models to skip recording |
| `excludeProviders` | providers to skip recording |

Invalid configuration falls back to safe defaults; numeric bounds are enforced.

## Modes

- **`metrics`** (default) — sizes, estimates, normalized usage, timing. No content, no payload, no headers.
- **`redacted`** — with `capturePayload: true`, records a deep-copied payload with likely secrets and configured patterns replaced.
- **`full`** — with `capturePayload: true`, records the complete bounded payload; secrets and authentication-like values are **still always redacted**.

`capturePayload` remains an explicit second switch even in `full` mode — this prevents accidental content retention from a one-word mode change. `/llm-audit capture <mode>` sets both together from the next request onward, so you do not have to edit JSON to produce a content-rich report.

## Where the context comes from

`/llm-audit sources` and the top of the HTML report split the system prompt by origin — harness boilerplate, project `AGENTS.md`, **skill metadata**, memory files — each with its byte cost, share of the prompt, source path, and a matched-lines confidence. Skills listed in the prompt but never loaded in the session are flagged with their byte cost, and memory blocks are flagged as re-injected on every request. That turns "should I cut this?" into a measurement instead of a hunch.

```text
system prompt 24,203 B | attributed 17,221 B (71%)
  ▍▍▍▍▍▍▍▍            46.8%    11,339 B  memory
  ▍▍▍▍                19.8%     4,803 B  harness
  ▍▍▍▍                19.7%     4,761 B  skill     <- 8 skills, none loaded in that session
  ▍▍                   8.9%     2,149 B  agents
```

Attribution is line-based content matching against the files the prompt labels itself (`<project_context>`, `# <profile>`, `<available_skills>`, memory headers). Attribution is a measurement, not a proof: every block carries `matched/total lines` as a confidence signal, and anything unmatched is reported as harness boilerplate. In `metrics` mode there is no payload text to match, and the command says so.

## HTML report

- **Context-window treemap.** The latest request as bands by category (system / tool schemas / conversation / tool results), each subdivided by its real contributors — static inline SVG, hover for exact figures. At a glance you can see whether a session is dominated by fixed overhead or by history.
- **Full-width expandable blocks and messages.** Cards rather than cramped table cells, with bodies rendered as markdown (headings, code fences, lists, quotes). No scripts: markdown is rendered at generation time, so opening the file still cannot contact anything.
- **Leads with provenance.** Every source block in prompt order, **expandable** so you can read exactly what the model received in each one (harness boilerplate, `AGENTS.md`, each skill, each memory file), with bytes, rough tokens and share. Tool schemas carry rough token totals, and the 10 largest messages are expandable with rough tokens and how many requests re-sent each.
`/llm-audit html` writes one self-contained file beside the log (`<session>.report.html`): inline CSS, no scripts, no external requests, so opening it cannot contact anything. It is written `0600` because it can quote prompt text and source code.

- **Works for any session**, including logs written weeks ago — it reads the JSONL rather than in-memory state. Targets: `latest` (default, this session), a `<session-id>`, or an absolute path. There is deliberately no "newest file in the log directory" fallback: silently reporting a different session than the one asked for is worse than an error that points at `/llm-audit sessions`.
- **Message bodies embedded and expandable.** Every row with text has a `show full message` control; bodies are embedded exactly once (in the largest-messages table), and per-request deltas link to them by anchor. Messages are deduped by content hash: on a real 117 MiB log, 41,896 message instances were only 413 unique messages (99.0% re-sends), which is what keeps the page small. Two ceilings guard pathological input — 2 MiB per message and 64 MiB per report — and anything they cut is labelled where it is cut, never silently.
- **Opens in your browser** when written; `--no-open` suppresses that (headless, CI, remote), and `--no-body` writes a previews-only report for sharing. A browser that cannot be launched is reported, not treated as a failure — the file is always written.
- Beyond the Markdown report it shows: **fixed vs variable context** per request, **what each round-trip added** (set differences, so a compaction or prompt change is shown as such rather than as "new" context), **cache-invalidating events** (first message changed, or a compaction), **duplicate content** (the same hash appearing twice *inside one request* — prefix re-sends between requests are normal and deliberately not counted), and **largest messages** with how many requests carried them.
- Graceful degradation: with no captured payload it still reports composition, fixed overhead, per-tool schema cost, and heuristics, and says plainly that content was not captured.

## Reports, efficiency, and comparison

`/llm-audit report` (Markdown) and `/llm-audit export` (JSON + CSV) cover session counts, model/provider, actual input/output/cache usage, cost when pi exposes it, payload growth, latest system/tool/history/tool-result overhead, timing, compactions, largest components, per-tool schema cost, and measured heuristics.

Two readings of the numbers matter, and they can disagree:

- **Overhead percentages are byte shares of the payload, not billed-token shares.** With prompt caching, a request can show ~99% "overhead" while costing almost nothing in fresh input tokens. Always pair a byte-share with `actual input`/`cached` before drawing conclusions about cost.
- **Metrics are in-memory for the current process.** `status`, `report`, `export`, `compare`, `tools`, `last` cover the requests this process handled; resuming a session (`pi --continue`) starts collecting fresh even though the JSONL already holds the earlier requests. Run these commands in the session where the work happened, or read the JSONL / generate the HTML report (both read the log directly).

### Controlled-run comparison

`/llm-audit baseline` then `/llm-audit compare` compares the current session against the saved baseline and prints signed deltas (candidate − baseline, so negative is cheaper). Run the same completed task with a baseline setup, then with your MCP/tool additions; `/llm-audit compare <file>` accepts any export path.

The standalone CLI works on exported JSON (no pi needed). When installed from npm it lives inside the installed package:

```bash
node node_modules/@abianbiya/llm-audit/llm-audit/compare-reports.js \
  baseline.export.json candidate.export.json
```

It prints first-request fixed overhead, request count, calls/turn, schema/system bytes, context growth, input/output/cache tokens, latency, and cost. Keep task, model, thinking level, and prompt controlled; completion/success metadata is not exposed by pi and therefore is not fabricated by this tool.

## Agent-facing tool

The extension also registers one read-only tool, `llm_audit_context`, so the agent can investigate its own context cost instead of shelling out to `jq` against raw logs. It takes no parameters (an argument schema would itself cost context on every request) and only formats already-measured values — it never writes.

## Logs

One JSONL file per pi session under the configured `logDirectory`, written `0600` in a `0700` directory, with a serialized append queue. Records carry `schemaVersion: 1` and one of `session_start`, `session_event` (switches/forks), `llm_request`, `provider_response`, `llm_usage`, `tool_call`, `tool_result`, `compaction`, `session_summary`, `audit_error`. Unavailable fields are **omitted, never written as zero**. Every record pins `sessionId`, `timestamp`, and (for requests) a `requestSequence` and `auditRecordId` that correlate request → response → usage.

Metrics-mode request records look like:

```json
{
  "schemaVersion": 1,
  "recordType": "llm_request",
  "requestSequence": 4,
  "analysis": {
    "payloadBytes": 74218,
    "approximateTokens": 18555,
    "tokenEstimate": "rough_characters",
    "sections": { "systemBytes": 21000, "toolDefinitionBytes": 16900 }
  },
  "payloadStored": false
}
```

Usage arrives as a separate `llm_usage` record matched by `auditRecordId`; timing spans response-header arrival (`after_provider_response`), first stream event, generation end, and the full request. The bundled [`llm-audit/README.md`](./llm-audit/README.md) is the full reference: complete record schema, `jq` recipes, every heuristic, and security notes.

## Measured, never invented

Unavailable fields are omitted rather than assumed; rough token estimates are labelled `rough_characters` and are not provider tokenizer counts; heuristics are reported as indicators, not proof. Provider shape detection covers OpenAI Chat Completions, OpenAI Responses, Anthropic Messages (all verified on real payloads), Gemini, plus OpenAI-compatible endpoints detected structurally; anything unrecognized still gets generic recursive sizing and field classification. The captured `payload` is the final serialized payload from pi's hook, which can still be affected by extensions loaded **after** this one, since pi chains payload-hook rewrites in load order.

## Compatibility

Built and verified against **Pi Coding Agent 0.85.1** (originally developed against 0.81.1; every hook it uses still exists in 0.85.1). It uses the public `before_provider_request`, `before_provider_headers`, `after_provider_response`, `message_update`, `message_end`, tool lifecycle, turn, compaction, session, UI, and command APIs. No runtime npm dependencies.

## Limitations

- pi exposes no raw HTTP response body, request ID, retry/attempt ID, or provider wire chunks; request→response→assistant correlation is FIFO best effort (pi normally serializes calls, but unusual custom concurrent providers or retries can make it ambiguous).
- Tool schema cost comes from the latest request's captured schema, so it describes the tool set as it was then, not a union across the session.
- `llm_audit_context` is the agent's read-only view; the authoritative record is the JSONL, which outlives the process.

## Development

```bash
bun run test                      # no-network test suite, synthetic payloads only (39 tests)
bun run scripts/check-fork.ts     # packaged tree must match the dev extension
bun run scripts/sync-audit.ts     # repair the packaged copy
bun x --yes --package typescript tsc -p llm-audit/tsconfig.json
```

Tests use synthetic payloads and fake secrets only; no real LLM API call is made. The `sync-audit`/`check-fork` pair keeps the published `llm-audit/` tree a byte-for-byte copy of the dev extension: the shipped copy is the copy that is tested.

## License

MIT © Abi Anbiya