---
status: done
---
# Speclet TUI

## Requirements
As a developer running pi in a project with `.speclet/` files, I want a live panel above the editor showing my selected speclet's short task checklist, so that I can see progress without leaving the terminal or asking the agent.

### Acceptance Criteria
- AC1: WHEN an interactive session starts with eligible speclets, THE SYSTEM SHALL show the selected speclet's name, frontmatter status, done/total progress, and numbered short task titles above the editor. Automatic selection ranks in-progress, approved, draft, done, then unknown; ties use newest mtime, then filename ascending.
- AC2: WHEN an eligible file or the `.speclet/` directory is created, edited, atomically replaced, or deleted during an interactive session, THE SYSTEM SHALL reflect the settled disk state within 1 second under normal local filesystem operation. Session shutdown SHALL stop refresh work and clear session selection.
- AC3: WHEN `/speclet` runs interactively, THE SYSTEM SHALL list all eligible filenames with status and progress and allow selecting one. Selection SHALL remain pinned across refreshes while the file exists; cancelling SHALL preserve selection. If it disappears, THE SYSTEM SHALL return to automatic selection. Without a pin, each refresh SHALL apply AC1 ranking. If dispatched in a non-interactive mode, the command SHALL return a textual list or the AC4 empty message without a selection dialog.
- AC4: IF `.speclet/` is absent or has no eligible files, THE SYSTEM SHALL hide the widget and `/speclet` SHALL report "No speclets found." A speclet with zero tasks SHALL remain visible with 0/0 progress.
- AC5: WHILE visible, THE SYSTEM SHALL render at most 12 content lines, including one heading and, when needed, a final `+N more` row. It SHALL retain task order, count all tasks for progress, and display only checkbox state, number, and short title. Every line SHALL fit the current terminal width, including after resizing; descriptions, criteria, and dependency sub-bullets SHALL not appear.
- AC6: WHEN discovering speclets, THE SYSTEM SHALL consider only regular `.md` files directly inside `ctx.cwd/.speclet/`, excluding `context.md`; it SHALL not follow symlinks or scan subdirectories.
- AC7: WHILE loaded, THE SYSTEM SHALL never create, modify, or delete `.speclet/` files or directories. Read/parse errors SHALL not crash pi; a file that vanishes during a scan SHALL be omitted, and other read failures SHALL be reported without stopping subsequent refreshes.
- AC8: WHEN loaded as a local pi package, THE SYSTEM SHALL register without errors. In non-interactive modes it SHALL start no refresh timer or widget and SHALL not open a selection dialog.
- AC9: WHEN parsing a readable speclet, THE SYSTEM SHALL obtain its name from the first level-one heading outside code fences, falling back to filename stem. It SHALL read a valid scalar frontmatter status (draft, approved, in-progress, done), otherwise use unknown. It SHALL count only top-level numbered `- [ ]`, `- [x]`, or `- [X]` rows inside `## Tasks`, ending at the next level-one or level-two heading, and ignore fenced examples and indented detail rows. Missing Tasks means zero tasks; malformed frontmatter SHALL not prevent parsing a recoverable Tasks section.

## Design Notes
- Build a custom read-only extension in this repository at `speclet-tui/`. Adopt the compact panel/command presentation from [rpiv-todo](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo), without installing or forking it. Its conversation-backed mutation tool, collapse shortcut, localization, and detached-session coordination are out of scope.
- Package: `package.json` with `type: module` and `pi: { extensions: ["./index.ts"] }`. Declare imported pi packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) as peer dependencies with `*` ranges; no third-party runtime dependencies. Use type-only imports for types and runtime imports for helpers such as `truncateToWidth`.
- The task authoring format is `- [ ] N. Short title` with indented scope/verification, `Criteria:`, and optional `Depends on:` below. Parser output separates task ID, title, and checked state; details remain in Markdown for the agent. There is no legacy inline-format support.
- Use pure discovery/parser, selection, and render helpers with focused tests. Parse the restricted frontmatter scalar format emitted by Speclet, including quoted values; unsupported or malformed values become unknown. Ignore backtick and tilde fenced blocks. Task numbers are labels, not array positions.
- In the extension factory, register commands and lifecycle handlers only. On interactive `session_start`, scan immediately and start a non-overlapping 500 ms refresh loop over the small directory. Re-read file content so same-size edits are detected. This handles initially absent directories, replacement, and deletion without watcher rearming. On `session_shutdown`, clear timers and invalidate pending scans so stale results cannot repaint a later session.
- Retain a selected file path only within the session. Explicit selection is pinned; otherwise rank each fresh scan. Render `Speclet: {name} ({done}/{total}) · {status}` with `✓` or `·` task rows. Use a custom `ctx.ui.setWidget` component that computes width-sensitive lines in `render(width)`; suppress control sequences from file text before terminal rendering. The fixed 12-line budget excludes framework-added spacing.
- Guard TUI work using the installed host's interactive mode discriminator, not `hasUI` alone (RPC also has UI capability). Use the supported textual message path if a command runs without an interactive UI. Missing or unreadable directories hide the panel; non-missing read failures produce a deduplicated diagnostic and remain retryable.
- Local installed pi documentation confirms session-scoped startup/cleanup, above-editor widgets, local package installation, and peer package declarations. Verify the exact component and command APIs against the installed types during implementation; no rpiv-specific widget API is assumed.

## Tasks
- [x] 1. Scaffold the extension
  - Create `speclet-tui/` package and command/lifecycle entry points. Smoke-test loading and non-interactive guards with an empty fixture; select a local TypeScript test runner and expose its command.
  - Criteria: AC8
- [x] 2. Parse speclet files
  - Implement discovery and parsing helpers. Test excluded paths, heading/name fallback, quoted/invalid/missing status, malformed frontmatter, x/X checkboxes, section boundaries, fenced examples, and indented task details.
  - Criteria: AC6, AC9
  - Depends on: 1
- [x] 3. Show the task panel
  - Wire startup selection, title-only rendering, and `/speclet` listing/selection. Test ranking, pin/cancel/fallback through refreshed snapshots, empty and zero-task states, exact overflow counts, narrow widths, Unicode, and resizing.
  - Criteria: AC1, AC3, AC4, AC5
  - Depends on: 2
- [x] 4. Refresh from disk safely
  - Add the session-scoped refresh loop, error handling, and shutdown invalidation. Test file/directory creation, deletion/recreation, atomic replacement, same-size edits, selected-file deletion, and in-flight shutdown. Assert read-only filesystem behavior across these paths.
  - Criteria: AC2, AC7
  - Depends on: 3
- [x] 5. Verify the integrated extension
  - Add repeatable integration fixtures and run the suite plus an interactive smoke test in a scratch project. Install locally there with `pi install -l /absolute/path/to/this/repo/speclet-tui`; record the resolved path and host version.
  - Exercise all criteria, including external edits and timing, overflow/resize, malformed/unreadable input, selection removal, and session cleanup. For read-only checks, compare bytes and paths during separate no-edit intervals; for live-edit tests compare against the fixture writer's expected state. Record evidence and limitations in Outcome.
  - Criteria: AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9
  - Depends on: 4

## Outcome
All 5 tasks complete; 47/47 unit tests pass (bun test). Integrated verification in scratch project `/tmp/speclet-e2e` (host pi 0.85.1, installed via `pi install -l /Applications/XAMPP/xamppfiles/htdocs/airesearch/skills/speclet-tui`):

- **AC1** — widget appeared above the editor: `Speclet: Beta Feature (1/2) · in-progress` with `✓`/`·` numbered rows, in-progress ranked first, criteria/indent rows omitted.
- **AC2** — external `sed` edit flipped `(1/2)` → `(2/2)` in the panel without restart. Timestamped evidence (2026-09-08 re-verification): unit test with the production 500 ms poll measured **~494 ms** consistently across 6 runs (`AC2 measured latency` assertion, <1000 ms enforced); live tmux integration measured **379 ms, 159 ms, 161 ms** across three timed external edits. Atomic rename, same-size edits, deletion/recreation covered by unit tests.
- **AC3** — `/speclet` opened a picker listing `a.md · draft · 0/3`, `b.md · in-progress · 2/2`, `c.md · done · 15/15`; pinning `a.md` switched the panel; deleting the pinned file fell back to ranked `b.md`.
- **AC4** — moving `.speclet/` away hid the widget entirely; zero-task speclets render `0/0` heading (unit-tested).
- **AC5** — 20-task speclet rendered exactly 12 content lines ending `+10 more`; narrow-width and Unicode truncation unit-tested against a display-width reference implementation.
- **AC6** — `context.md`, non-`.md` files, subdirectories, and symlinks excluded (unit-tested and confirmed live).
- **AC7** — controller unit test fingerprints `.speclet/` (path → sha256) across scans/pins/polls and asserts byte equality; live session showed no writes beyond test-driven external edits.
- **AC8** — `pi -p` in the scratch project loaded the extension without errors (session then failed only on upstream provider quota, 429, unrelated); no timer/widget/dialog in non-interactive mode.
- **AC9** — parser behaviors (h1-outside-fences naming, quoted/invalid/missing frontmatter status, unclosed frontmatter recovery, x/X checkboxes, section boundaries at next h1/h2, fenced-example and indented-row exclusion, task numbers as labels) unit-tested.

Limitations / follow-ups:
- The live read-only checksum comparison could not be a strict before/after diff because the test scenario itself mutates fixtures (sed/rm/mv); byte-identity evidence comes from the dedicated AC7 unit test.
- RPC-mode `/speclet` textual notify path is code-reviewed but was not exercised (no RPC client in the harness loop); print-mode path shares the same branch.
- Provider quota exhausted mid-session, so the model chat was never exercised — irrelevant to the panel, which is model-independent.
- Collapse keybinding, i18n, and detached-session isolation remain out of scope per Design Notes.

Review fixes (2026-09-08, all pre-done findings resolved and re-validated):
1. Closed frontmatter is now stripped before Markdown parsing, so YAML comments (e.g. `# internal note`) can no longer become the displayed name; malformed (unclosed) frontmatter recovery retained. Regression test added.
2. All display strings are sanitized: filename-derived stem names (parse + error entries), picker labels, textual listings, and diagnostics. Raw filenames preserved for lookup. Regression tests added.
3. `/speclet` selection now maps option labels to file identities via `pickerOptions()` instead of parsing presentation text; labels survive round-trip even when a filename contains ` · `. Regression tests added.
4. AC2 re-verified with timestamped measurement: unit-level ~494 ms × 6 runs and live integration 379/159/161 ms — within the 1-second requirement. Measured latency is logged by the test on every run.
