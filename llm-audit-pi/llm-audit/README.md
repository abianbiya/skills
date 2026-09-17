# llm-audit

`llm-audit` is a user-level [Pi Coding Agent](https://github.com/badlogic/pi-mono) extension that records the final provider-specific payload Pi sends, its measured shape, provider usage Pi exposes, and turn/tool timing. It is designed for context-cost investigation, not request replay.

**Privacy default:** `metrics` mode stores no prompt text, source code, tool output, headers, or payload. Enable payload capture deliberately.

## Compatibility

Built and verified against **Pi Coding Agent 0.85.1** (originally developed against 0.81.1; every hook it uses still exists in 0.85.1). It uses the public `before_provider_request`, `before_provider_headers`, `after_provider_response`, `message_update`, `message_end`, tool lifecycle, turn, compaction, session, UI, and command APIs.

`before_provider_request` is Pi's final serialized provider payload hook (verified on 0.85.1): it runs immediately before the HTTP request. It captures OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, Gemini, OpenAI-compatible, and unknown/custom payloads structurally without assuming a fixed schema.

## Install / reload

The extension is already installed here:

```text
~/.pi/agent/extensions/llm-audit/
```

Pi auto-discovers directory extensions whose entrypoint is `index.ts`. Reload an already-running interactive Pi session with:

```text
/reload
```

Or start Pi normally. There are no runtime npm dependencies.

## Layout

```text
llm-audit/
├── index.ts              # Pi hooks and session state
├── analyzer.ts           # provider-agnostic payload + usage analysis
├── redaction.ts          # bounded, non-mutating redaction/copying
├── config.ts             # config load and validation
├── logger.ts             # safe append-only JSONL writer
├── reporter.ts           # metrics, Markdown, heuristics, comparisons
├── logs.ts               # streaming JSONL reader + message dedupe
├── html.ts               # analysis model + self-contained HTML report
├── provenance.ts         # system-prompt attribution to files
├── commands.ts           # slash commands
├── settings.ts           # interactive config panel
├── tools.ts              # read-only agent-facing audit tool
├── types.ts              # records, config and shared types
├── compare-reports.js    # JSON export comparison CLI
├── tests/run.ts          # no-network test suite
└── tsconfig.json
```

## Configuration

Create `~/.pi/agent/llm-audit.json` (restart or `/reload` after changing it). When the active profile has its own `<profile>/llm-audit.json`, that file is used instead — the profile dir named by `PI_CODING_AGENT_DIR` wins, so per-profile `mode` and `logDirectory` are honoured:

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
  "redactFieldNames": ["internal_note"],
  "redactPatterns": ["ACME-[A-Z0-9]{20}"],
  "excludeModels": [],
  "excludeProviders": []
}
```

Invalid configuration falls back to safe defaults. `~` expands to the current user's home directory. Bounds are enforced (payload max 1 KiB–100 MiB; field max 256 B–10 MiB). `retentionDays: 0` disables expiry cleanup — `/llm-audit clean` then deletes nothing.

### Modes

- **`metrics` (default):** JSONL has sizes, estimates, normalized usage, timing, and no content/payload/headers.
- **`redacted`:** with `capturePayload: true`, logs a deep copied payload whose likely secrets and configured patterns are replaced.
- **`full`:** with `capturePayload: true`, logs the complete bounded payload _except_ secrets/authentication-like values are still always redacted. `captureHeaders: true` additionally logs only safe headers.

`capturePayload` remains an explicit second switch even in `full` mode. This prevents accidental content retention from a one-word mode change.

`/llm-audit capture metrics|redacted|full` sets both together and warns before enabling content capture, so you do not have to edit JSON to produce a content-rich report. It applies from the next request onward.

## Commands

One command, with subcommands (`/llm-audit <tab>` completes them):

| Subcommand | What it does |
| --- | --- |
| `/llm-audit` or `/llm-audit status` | enabled/mode/log path and session snapshot |
| `/llm-audit on`, `off`, `toggle` | enable or disable capture for this session |
| `/llm-audit capture metrics\|redacted\|full` | sets mode **and** content capture together, with a warning |
| `/llm-audit config` | interactive settings panel, saving explicitly to the config file |
| `/llm-audit tools` | per-tool schema bytes and call counts for the last request |
| `/llm-audit last` | safe summary of the last request (never prompt text) |
| `/llm-audit sessions` | lists recent session logs with request/payload counts and projects |
| `/llm-audit sources [session]` | **where the system prompt's bytes come from**, per block and per file |
| `/llm-audit html [<session>\|<path>] [--no-body] [--no-open]` | writes a self-contained HTML report and opens it |
| `/llm-audit report` | writes a Markdown session report |
| `/llm-audit export` | writes normalized `*.export.json` and `*.export.csv` |
| `/llm-audit baseline` | saves this session's export as the comparison baseline |
| `/llm-audit compare [file]` | compares the session against the baseline (or a given export) |
| `/llm-audit clean` | deletes only expired `*.jsonl` inside `logDirectory` |
| `/llm-audit help` | lists the subcommands |

`/llm-audit` and `/llm-audit-status` used to be separate commands, `mode` was separate from `capture`, and `on`/`off` were their own commands; they are now subcommands so the command menu stays a single entry.

### Settings panel

`/llm-audit config` opens a dialog-driven panel for capture on/off, content mode, status-line options, retention, log directory, and provider/model exclusions. Changes apply to the running session immediately; **Save to config file** is a separate action that validates and writes `<profile>/llm-audit.json` (0600). Closing the panel with unsaved edits asks once whether to save them, so a mode switch is never dropped silently — and nothing is persisted implicitly, because switching to `full` capture by itself must not silently make every future session record prompts and source code. Saving that choice asks for the same warning, folded into whichever prompt you are answering. A config file that cannot be parsed is never overwritten.

The status line always starts with the audit state — `llm-audit off`, `llm-audit metrics`, `llm-audit full` — so the active mode is visible as soon as the session starts, before any request completes. A content mode that is not actually capturing is called out (`llm-audit full (capture off)`), which is the state where someone expects prompts to be recorded and they are not. When `showTurnSummary` is enabled a **short** summary follows it (`llm-audit full | 119 req · 791.9 KiB · 100% cached`), deliberately capped: the status line shares one line with every other extension, and footers such as `pi-powerline-footer` *drop* a segment that does not fit rather than shortening it, so an oversized status does not degrade — it vanishes. The full breakdown lives in `/llm-audit status`, `/llm-audit last` and the report. Any `/llm-audit` command re-renders the line immediately, so a mode change is visible without waiting for the next turn; `showStatus` turns the whole entry off.

## Agent-facing tool

The extension registers one read-only tool, `llm_audit_context`, so the agent can answer context-cost questions itself instead of shelling out to `jq`: it reports the same measured numbers as `/llm-audit status` plus per-tool schema cost. It takes no parameters (an argument schema would itself cost context on every request) and only formats already-measured values — it never writes logs.

## Tool schema attribution

`analysis.tools` sizes each tool definition individually, covering OpenAI (`tools[].function.name`), Anthropic (`tools[].name`), and Gemini (`tools[].functionDeclarations[].name`). At most 20 schemas are recorded per request, largest first.

Combined with observed tool calls this drives two things:

- `/llm-audit-tools` and the report's **Tool schema cost** table show bytes and call counts per tool.
- The `unused-tool-schemas` heuristic flags schemas that were never called this session yet are re-sent on every request.

This is the actionable half of the older `tool-schema-overhead` heuristic, which could only say that tool schemas were expensive, not which ones.

## Where the context comes from

This is the part built for evaluating a setup rather than a session. The assembled system prompt labels its own blocks (`<project_context>`, `# Agentic profile`, `<available_skills>`, `## MEMORY.md (long-term)`, `## Daily log: …`), the skill block declares each skill's `<location>`, and the memory headers name their files. So each byte can be attributed to a file:

```text
/llm-audit sources

system prompt 24,203 B | attributed 17,221 B (71%)
  ▍▍▍▍▍▍▍▍            46.8%    11,339 B  memory
  ▍▍▍▍                19.8%     4,803 B  harness
  ▍▍▍▍                19.7%     4,761 B  skill
  ▍▍                   8.9%     2,149 B  agents
  ▍                    0.6%       144 B  project
blocks:
      4803 B  harness base prompt
       862 B  # Agentic profile             (8/19 lines)
            ~/.pi/profiles/agentic/AGENTS.md
       486 B  skill: herdr                   [not loaded]
            ~/.pi/profiles/agentic/skills/herdr/SKILL.md
      ...
      4096 B  ## MEMORY.md (long-term)      (20/50 lines)  [every request]
            ~/.pi/agent/memory/MEMORY.md
```

Attribution is line-based content matching, so each block carries `matched/total lines` as a confidence signal, and a source is only kept when the file substantiates it — a declared skill `<location>` is the exception, because the prompt state it itself. Everything unmatched is reported as harness boilerplate rather than spread over the rest. In metrics mode there is no text to attribute and the report says so instead of showing an empty table.

The actionable half: skills listed in the prompt but **never loaded** in the session are flagged with their byte cost, and memory blocks are flagged as re-injected into every request. That is what makes per-profile filtering (`skills: []` on a package entry) a measurable decision instead of a guess.

## HTML report

`/llm-audit-html` writes one self-contained HTML file next to the log (`<session>.report.html`): inline CSS, **no scripts, and no external subresources** (no image, stylesheet, font or iframe), so opening it cannot contact anything on its own. Hyperlinks found in captured content render as ordinary links you may choose to click. Markdown in captured content is rendered at generation time — on the Node side — which is why a modal would have needed scripts and a full-width card layout did not. It works for **any** session, including logs written weeks ago — it reads the JSONL rather than in-memory state, which also sidesteps the per-process limitation of the other commands. It is written `0600`.

Targets: no argument reports **this session**, `<session-id>` a specific one, or an absolute path any log. There is deliberately no "newest file in the log directory" fallback: silently reporting a different session than the one asked for is worse than an error that points at `/llm-audit sessions`.

The report leads with provenance — where the system prompt's bytes came from, then tool schema cost — and demotes session trends (growth, per-request table, deltas, duplicates) into collapsed sections.

- **Message bodies are embedded and expandable.** Every message row with text has a `show full message` control that opens the complete body in place; bodies are embedded exactly once, in the largest-messages table, and per-request deltas link to them by anchor. Two ceilings guard pathological input (2 MiB per message, 64 MiB per report) and anything they cut is labelled at the point it is cut, never silently. Rows whose content has no extractable text (binary, image, structured-only) say so instead of showing an empty body.
- **The report opens in your browser** when it is written. Add `--no-open` to suppress that (headless, CI, or remote sessions), and `--no-body` to write a previews-only report for sharing. A browser that cannot be launched is reported, not treated as a failure — the file is always written.
- Reports are written `0600` because they can quote prompt text and source code.

What it shows beyond the Markdown report:

- **Every provenance block in prompt order, expandable** — read exactly what the model received in each block (harness boilerplate, AGENTS.md, each skill, each memory file), with bytes, rough tokens, and share.
- **Rough token columns** beside every byte figure for tool schemas and messages (bytes ÷ 4, labelled as an estimate).
- **A context-window treemap** — the latest request as bands by category (system / tool schemas / conversation / tool results), each subdivided by its actual contributors, so it is obvious at a glance whether a session is dominated by fixed overhead or by history. Static inline SVG with per-tile tooltips.
- **Full-width expandable blocks and messages** — cards rather than cramped table cells, with the body rendered as markdown (headings, code fences, lists, quotes), because an in-cell expansion cannot span a table row without scripts.
- **Fixed vs variable context** — system + tool schemas against conversation, per request.
- **What each round-trip added** — a set difference against the previous request, so a prompt change or compaction is shown as such rather than as "new" context.
- **Cache-invalidating events** — requests whose first message changed, plus compactions. These are where prompt caching stops paying.
- **Duplicate content** — the same bytes occupying one request twice. Prefix re-sends *between* requests are normal and are deliberately not counted as duplication; an earlier version of this report did exactly that and reported 1.8 MiB of phantom waste on a real log, all of it a compaction/prompt-change artifact.
- **Largest messages** — the 10 largest unique messages, each expandable in place, with bytes, rough tokens, and how many requests re-sent it (that count is a multiplier: every request re-sends the whole conversation).
- **Graceful degradation** — with no captured payload it still reports composition, fixed overhead, per-tool schema cost and the heuristics, and says plainly that content was not captured.

Design note: messages are deduped by content hash before rendering. Measured on a real 117 MiB log, 41,896 message instances were only 413 unique messages (99.0% re-sends), so deduping turns an unusable 150 MiB page into a ~900 KiB one — and it is what makes per-request deltas cheap.

## JSONL records

Logs are one file per Pi session under `~/.pi/agent/logs/llm-audit/`, written with restrictive directory/file modes where supported. Records include `schemaVersion: 1` and one of:

- `session_start`
- `session_event` (switches, forks, tree moves)
- `llm_request`
- `provider_response`
- `llm_usage`
- `tool_call`
- `tool_result`
- `compaction`
- `session_summary`
- `audit_error`

A metrics-mode request resembles:

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

Usage is a separate `llm_usage` record matched by `auditRecordId` and `requestSequence`. Unavailable fields are omitted—never silently converted to zero.

## Inspect logs

```bash
LOG="$(ls -t ~/.pi/agent/logs/llm-audit/*.jsonl | head -1)"

# Last request's safe metadata and section sizes
jq 'select(.recordType == "llm_request") | {requestSequence, provider, model, analysis, payloadStored}' "$LOG" | tail -1

# Last captured exact payload (only exists in redacted/full + capturePayload)
jq 'select(.recordType == "llm_request" and .payloadStored) | .payload' "$LOG" | tail -1

# Usage rows
jq 'select(.recordType == "llm_usage") | {requestSequence, usage, timing}' "$LOG"

# Cache-read ratio across available Pi usage
jq -s '[.[] | select(.recordType == "llm_usage") | .usage] | {input: (map(.inputTokens // 0) | add), cacheRead: (map(.cacheReadTokens // 0) | add)} | . + {cacheReadRatio: (if (.input + .cacheRead) > 0 then .cacheRead / (.input + .cacheRead) else null end)}' "$LOG"
```

The `payload` field is the final payload from Pi's serialization hook, not Pi's internal message representation. It can still be affected by extensions loaded **after** this extension, because Pi chains payload hook rewrites in extension load order.

## Reports and efficiency

`/llm-audit-report` covers session counts, model/provider, actual input/output/cache usage, cost when Pi exposes it, payload growth, latest system/tool/history/tool-result overhead, timing, compactions, largest components, per-tool schema cost, and measured heuristics.

Two readings of the numbers matter, and they can disagree:

- **Overhead percentages are byte shares of the payload, not billed-token shares.** With prompt caching, a request can show ~99% "overhead" while costing almost nothing in new input tokens. A measured example: 58.5 KiB payload, `tools` 34.3 KiB, and an *actual* input of **230 tokens** because 45,696 tokens were cache reads. Always pair a byte-share with `actual input`/`cached` before drawing conclusions about cost.
- **Metrics are in-memory for the current process.** `/llm-audit status|report|export|compare|baseline|tools|last` cover the requests this process handled; resuming a session (`pi --continue`) starts collecting fresh even though the JSONL already holds the earlier requests. Run these commands in the session where the work happened, or read the JSONL directly.

Heuristics flag high tool-schema or system overhead, growing history, large tool results, low cache reuse, excessive calls per user turn, verbose output, and late compaction. They are indicators—not proof of poor configuration. Inspect your fixed first-request overhead to compare AGENTS.md, skills, MCP schemas, and tool sets.

### Controlled-run comparison

`/llm-audit-baseline` then `/llm-audit-compare` compares the current session against the saved baseline and prints signed deltas (candidate − baseline, so negative is cheaper). Run the same completed task with a baseline setup, then with MCP/tool additions; `/llm-audit-compare <file>` accepts any export path.

The standalone CLI works on `/llm-audit-export` output. When installed from npm it lives inside the installed package rather than under `~/.pi/agent/extensions`:

```bash
node ~/.pi/agent/extensions/llm-audit/compare-reports.js \
  ~/.pi/agent/logs/llm-audit/baseline.export.json \
  ~/.pi/agent/logs/llm-audit/candidate.export.json
```

It prints first-request fixed overhead, request count, calls/turn, schema/system bytes, context growth, input/output/cache tokens, latency, and cost. Keep task, model, thinking level, and prompt controlled; completion/success metadata is not exposed by Pi and therefore is not fabricated by this tool.

## Security and retention

Payloads can contain proprietary source, prompts, tool output, and user data. Keep the default `metrics` mode unless you have a concrete debugging need. Full mode always redacts likely API keys, bearer tokens, cookies, passwords, private keys, database URLs, token/secret/password-like field names, and configured patterns; redaction is defense in depth, not a substitute for protecting the log directory.

The extension deep-copies before redaction and never mutates Pi's payload or event objects. It bounds capture depth, array entries, individual fields, and total capture size. `/llm-audit-clean` never leaves `logDirectory` and deletes only expired `.jsonl` files.

## Limitations / troubleshooting

- The HTML report embeds each unique message once (deltas link to that copy) and applies per-message and total body ceilings; "What this report does not show" lists everything it omitted for that run.
- Tool schema cost in the HTML report comes from the latest request's captured schema, so it describes the tool set as it was then, not a union across the session. Logs written before schema attribution existed have no per-tool data.
- Pi exposes no raw HTTP response body, request ID, retry/attempt ID, or provider wire chunks. The request→response→assistant correlation is FIFO best effort; Pi normally serializes calls, but unusual custom concurrent providers/retries can make it ambiguous.
- `after_provider_response` measures response-header arrival. First stream timing uses the first Pi `message_update`, not a provider-wire token timestamp. Full generation ends at finalized assistant message.
- Pi exposes final assistant `usage` (including Pi's normalized cost) but does not expose a distinct verified provider cost receipt or tokenizer for all providers. Rough estimates use configured characters/token and are labeled as estimates.
- Unknown providers still receive generic recursive sizing and field classification. Unrecognized sections are `otherBytes`.
- If no JSONL appears, use `/llm-audit`, check `enabled`, `excludeProviders`, permissions on the log directory, then `/reload`. `audit_error` records diagnose extension-side capture errors without interrupting Pi.

## Development checks

```bash
cd ~/.pi/agent/extensions/llm-audit
bun tests/run.ts
# Type check without adding a runtime dependency:
bunx --yes --package typescript tsc -p tsconfig.json
# Verify formatting:
bunx --yes prettier --check '*.ts' 'tests/*.ts' '*.js' '*.md'
```

Tests use synthetic payloads and fake secrets only; no real LLM API call is made.
