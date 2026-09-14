---
status: done
---
# SpecFlow Actionable Cockpit

## Requirements
As a pi user running the SpecFlow workflow, I want the panel to tell me which task to run next, warn me when a requirement has no implementing task, and let me launch work without typing the same sentence, so that the cockpit drives the workflow instead of only describing it.

### Acceptance Criteria
- AC1: WHEN a spec's `requirements.md` defines AC ids (list items or bold labels such as `- AC1: …` / `**AC1**`), THE SYSTEM SHALL expose them as the spec's defined criteria; IF `requirements.md` is absent or unreadable, THE SYSTEM SHALL treat the defined set as empty rather than failing discovery.
- AC2: WHEN traceability is computed for a spec, THE SYSTEM SHALL report `unclaimed` AC ids (defined in requirements but cited by no task's `Criteria:` row) and `orphan` criteria (cited by a task but not defined), and this analysis SHALL be a pure function of parsed state with no filesystem access.
- AC3: WHEN task dependencies (`Depends on:` rows) are analysed, THE SYSTEM SHALL classify every unfinished task as `ready` (all dependencies done), `blocked` (waiting on at least one unfinished dependency, naming them), or `dangling` (depending on an id that does not exist), and SHALL never treat a dangling dependency as satisfied.
- AC4: WHEN the panel renders a spec with unfinished tasks, IT SHALL show the next actionable task (first `ready` task in document order) by id and title; IF no task is ready but tasks remain, IT SHALL name a blocked task and what it waits on; IF all tasks are done, IT SHALL say so. The panel SHALL stay within its 6-line budget.
- AC5: WHEN the panel renders a spec whose traceability is incomplete, IT SHALL show a single warning line counting unclaimed, orphan, and dangling items; an otherwise consistent spec SHALL show no warning line.
- AC6: WHEN `/specflow` runs interactively, THE SYSTEM SHALL offer actions on the active spec — execute a chosen unfinished task, approve a pending gate and resume, validate the implementation, and open a document — and each action SHALL reach the agent as an explicit, legible user message via `pi.sendUserMessage`, so the extension itself never writes to `.specflow/`.
- AC7: WHEN an action is chosen, THE SYSTEM SHALL name the spec and the task in the message it sends, and SHALL mark blocked tasks as such in the chooser while still allowing them to be selected; cancelling any chooser SHALL perform no action.
- AC8: WHEN the session is non-interactive, THE SYSTEM SHALL keep the existing textual listing and SHALL never offer actions or send messages.

## Design Notes
- Split: `src/trace.ts` (new, pure) over `SpecflowSpec`; `src/parse.ts` gains one field (`criteria: string[]`) filled during discovery from `requirements.md`; `src/render.ts` gains the next-task and warning lines plus the task/action option builders; `extensions/index.ts` gains the action menu and `pi.sendUserMessage` wiring.
- Traceability semantics: `unclaimed` is the useful direction (a requirement nothing implements); `orphan` catches typo'd or stale citations. Both are warnings, never errors — a spec mid-authoring is expected to be inconsistent, and the panel must never block on it.
- Dependency edge parsing lives beside criteria parsing because both read indented detail rows; `Depends on:` values are dotted ids (`1.1`), comma- or space-separated.
- Message shapes are fixed and self-describing, e.g. `Execute task 2.1 of the rate-limit spec.` / `Approve and resume the rate-limit spec.` / `Validate the rate-limit spec implementation.` The skill already routes these intents (Phase 4 Execution / Validation), so no new agent-side protocol is needed.
- Panel budget: 5 lines max (rule, heading, phase rail, next line, optional warning) against the 6-line cap.
- ponytail: skipped — writing checkbox state from the TUI (the extension stays read-only; the agent remains the only writer), multi-spec batch execution, a persistent review queue across specs, inline task expansion in the panel. Upgrade path: a review-queue command if the gate inbox becomes the pain point.

## Tasks
- [x] 1. Criteria and dependency analysis
  - Add `criteria: string[]` to discovery (`parse.ts`) and implement `src/trace.ts`: `criteriaIdsOf`, `dependsOn`, `traceCriteria`, `dependencyGraph`, `nextTask`. Test defined/cited parsing, unclaimed, orphan, dangling, blocked, ready, next-in-document-order, and empty/degenerate specs.
- [x] 2. Panel lines and option builders
  - Render the next-actionable or blocked line and the single warning line inside the 6-line budget, and build the task chooser entries (ready vs blocked marks). Test every branch: ready, all-blocked, all-done, consistent, inconsistent, no tasks.
- [x] 3. `/specflow` actions
  - Add the interactive action menu (execute task, approve gate and resume, validate, open document, hide/show panel) wired to `pi.sendUserMessage`, naming spec and task; verify the non-interactive branch still only lists.
- [x] 4. Verify the cockpit
  - `bun test` green, prepublish guards green, live session check of the next-line, warning line, and each action's submitted message; confirm `.specflow/` is still byte-identical after an interactive session.

## Outcome

Executed 2026-09-11 by two agents in one working tree (pi-glm: `criteria` extraction in `parse.ts` + the pure `src/trace.ts`; manager: panel rows, option builders, the action menu, and all verification). Ownership stayed exclusive per file; nothing committed.

**Tests** — `bun test` in `specflow-pi/`: **110 pass / 0 fail** across 4 files (parse 40, render 42, trace 16, controller 12), up from 73. `bun test speclet-tui` still 87 pass / 0 fail. Both prepublish guards green; `npm pack --dry-run` 21 files (trace.ts + trace.test.ts joined the allow-list).

**AC1** — `describe`-style probe over 9 definition shapes: `- AC1:`, `* **AC2**`, `**AC3**`, bare `AC4:`, indented `  - AC5:`, and `\t- AC7:` all parse; `See AC9 above`, `(AC8)` mid-sentence, indented prose starting with a word, and fenced examples never do; duplicates dedupe in first-appearance order. Missing/unreadable/directory `requirements.md` → `[]` with no error field.
**AC2** — `traceCriteria` is pure (type-only imports). Live demo: `claimed=[{AC1:[1.1,1.2,2.1]},{AC2:[2.1]},{AC3:[2.2]}]`, `unclaimed=[AC4]`, `orphan=[{AC9,1.2}]`.
**AC3** — Live demo: `ready=[1.1,1.2]`, `blocked=[{2.1,by:[1.1]}]`, `dangling=[{2.2,missing:[9.9]}]`; a done task appears in no list; a cycle leaves nothing ready.
**AC4** — Panel showed `Next: 1.1 Implement the sliding-window counter` (and `Next: 1.3 Dead-letter after 5 attempts` for the mid-execution spec); a mutual-dependency fixture renders `Waiting: 1.1 1.1 work (blocked by 2.1)`, an unresolvable one `Waiting: 2.1 (unknown dependency 9.9)`, a finished spec `All tasks done`, and requirements-only specs add no row at all.
**AC5** — Panel showed `⚠ 1 unclaimed AC · 1 orphan criterion · 1 dangling dep`; a fully-claimed spec renders no warning row; 5 rows total against the 6-row cap.
**AC6** — `/specflow` listed actions (`Execute a task…`, `Approve gate and resume`, `Validate implementation`, `Open document…`, `Hide panel`) above the spec list. Each action reached the agent as a user message, visible in the transcript as `↳ Execute task 1.1 of the rate-limit spec.`, `↳ Approve and resume the rate-limit spec.`, `↳ Validate the rate-limit spec implementation.` (the demo session's model then returned 429 monthly-quota, unrelated to the feature). `.specflow/` hash was **byte-identical** across the whole action session, and the shipped code still contains no filesystem write API — the extension drives the agent rather than editing specs.
**AC7** — The task chooser marked `▶ 1.1 …`, `▶ 1.2 …`, `⏸ 2.1 … (blocked by 1.1)`, `⏸ 2.2 … (blocked by unknown dep)`, and every message named both spec and task. Cancelling: two controlled sessions pressed Escape at the chooser — the pane returned to the editor with no `↳` line and no `Sent:` notification, and **no session transcript was written at all**, whereas sessions that do send persist immediately (the action session's file holds exactly the three messages). All three `choice === undefined` guards return before the single `pi.sendUserMessage` call.
**AC8** — `pi --print "/specflow"` still returns only the textual listing (no actions), and the action menu lives inside the interactive-mode branch.

**Defect found during verification** — `CRITERIA_DEF_RE` was anchored without leading-whitespace allowance, so an *indented* AC bullet (`  - AC5: …`) was not recognised; the missed id then surfaced as a false "orphan criterion" warning on a consistent spec. Reported to the file's owner and fixed to `/^\s*(?:[-*+]\s+)?(?:\*\*)?(AC\d+)\b/` with regression tests for indented and tab-indented forms.

**Known limitation (conscious)** — a task that depends on both an unfinished id and a nonexistent one is classified `dangling`, so its chooser entry reads `(blocked by unknown dep)` rather than naming the unfinished dependency; the warning row counts it. Reported by pi-glm as a contract note; left as-is because naming the missing id is the actionable fact and the count is already surfaced.

**Skipped (ponytail)** — writing checkbox state from the TUI, batch/multi-spec execution, a cross-spec review queue, inline task expansion in the panel. Upgrade path: a review-queue command once the gate inbox becomes the pain point.
