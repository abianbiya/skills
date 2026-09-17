---
status: done
---
# Spec Completion Lifecycle

## Requirements
As the user of a spec workflow, I want a finished spec to be confirmed, reported, and then retired, so that a completed spec never reappears in the panel and I still gate the terminal transition.

### Acceptance Criteria
- AC1: WHEN every task is checked and integrated verification passes, THE AGENT SHALL report changed files, checks run, and an Outcome summary, then ask exactly once whether to mark the spec done, leave it as-is, or archive it, and SHALL NOT set a terminal status before that answer.
- AC2: WHEN the user chooses done, THE AGENT SHALL set `status: done` and leave the file at its current path.
- AC3: WHEN the user chooses archive in speclet, THE AGENT SHALL set `status: archived` and move the file to `.speclet/archive/{filename}`; IF the move fails, THE AGENT SHALL leave the file in place, keep the prior status, and report the failure.
- AC4: WHEN the user chooses archive in specflow, THE AGENT SHALL set `status: archived` with `archived_at` and a user-supplied `archive_reason` in place, without moving directories.
- AC5: WHEN a speclet has status done or archived, THE PANEL SHALL NOT render it and THE PICKER SHALL NOT list it, in this session or any later session.
- AC6: WHEN a specflow spec has status completed or archived, or its phase resolves to done or archived, THE PANEL SHALL NOT render it and THE PICKER SHALL NOT list it, in this session or any later session.
- AC7: WHILE the picker's "Show finished" toggle is on, THE PICKER SHALL list finished specs — including archived speclets read from `.speclet/archive/` — and allow pinning one; the toggle SHALL be session-scoped and SHALL be cleared on shutdown.
- AC8: WHEN no unfinished spec exists, THE PANEL SHALL remain hidden unless explicitly revealed by the user.
- AC9: WHEN a spec is unreadable or its status is unknown, THE PANEL SHALL stay visible rather than hide the problem.

## Design Notes
- Terminal statuses are already authoritative in the TUI: `done` outranks task counts, and `unknown` counts as unfinished. Both stay true; AC5/AC9 just move `done` from "ranked last" to "not listed".
- `discoverSpeclets()` reads only regular files directly inside the directory, so `.speclet/archive/` is invisible to the 500 ms poll with no filtering. Archive listing is an explicit opt-in extra read (`includeArchive`), never part of the poll — this keeps AC3's move safe and the steady-state scan unchanged.
- The two extension trees differ by contract, not by accident: `speclet-pi/src` must stay byte-identical to `speclet-tui/src` (`speclet-pi/scripts/check-fork.ts`, run in `prepublishOnly`), while `specflow-pi/src` is a declared fork of the same dev tree (`specflow-pi/scripts/check-fork.ts`) and may adapt freely. Shared helpers are `src/shared.ts` only; selection/visibility predicates live in each tree's own `render.ts`, so the "finished" rule is implemented twice on purpose.
- Specflow's contract already matches AC1 and AC4: Phase 5 Complete requires "an explicit completion request" and Resume says "Report readiness for Complete; await explicit completion request", while Archive sets `archived_at` + required `archive_reason` in place. Speclet needs both the ask and the archive path added; specflow prose only gains the file/checks report so the two read alike.
- Keep `archive` as an explicit status value in speclet (`SpecletStatus` + `VALID_STATUSES`) even though the moved file is normally undiscovered: without it, an archived file read through the AC7 toggle would parse as `unknown` and defeat AC5.
- A `done` speclet with unchecked boxes stays hidden, consistent with the existing "status is authoritative" rule; the AC1 ask is what makes that safe, since the agent can no longer reach `done` unattended.
- Pinning interacts with the toggle: a pin pointing at a finished spec is dropped once the toggle is off, mirroring the existing "pinned file disappeared → unpin" behavior. A pinned finished spec is reachable only while the toggle is on.
- Layout of an archived speclet is unchanged apart from its directory, and status changes keep both files at their paths (speclet archive is the one deliberate exception).

## Tasks
- [x] 1. Speclet skill: gate the terminal transition
  - Replace the unconditional "mark done" ending in the Execution section with AC1's report-then-ask sequence for the three outcomes; add `archived` to the Status section with the `.speclet/archive/{filename}` location and the AC3 failure rule.
  - Criteria: AC1, AC2, AC3
- [x] 2. Specflow skill: report before completion
  - Add the changed-files and checks-run report requirement before the completion request in Phase 5 Complete, keeping the existing explicit-request and archive-reason gates intact.
  - Criteria: AC1, AC4
- [x] 3. Speclet parser: archived status and archive discovery
  - Add `archived` to `SpecletStatus` and `VALID_STATUSES`; add an opt-in `includeArchive` argument to `discoverSpeclets()` that also lists regular `.md` files in `{dir}/archive`, sharing `context.md` exclusion and the existing read-failure handling.
  - Criteria: AC3, AC5, AC7, AC9
- [x] 4. Speclet render: finished predicate and visible set
  - Replace `allSpecletsDone()` with a finished-status predicate plus a `visibleFiles(files, showFinished)` helper; keep `unknown` unfinished, keep rank order for unfinished specs, and drop finished specs from `selectActive`'s default candidate set.
  - Criteria: AC5, AC8, AC9
- [x] 5. Speclet controller: session toggle state
  - Add a session-scoped `showFinished` flag with its setter, include it in the change signature, use it in `panelVisible()`, clear it in `stop()`, and drop a pin that points at a finished spec when the toggle turns off.
  - Criteria: AC5, AC7, AC8
  - Depends on: 4
- [x] 6. Speclet extension: picker toggle and archive listing
  - Add a "Show finished" / "Hide finished" picker action alongside the existing panel toggle; while it is on, list finished specs from the archive-aware discovery path and allow pinning them.
  - Criteria: AC5, AC6, AC7
  - Depends on: 3, 5
- [x] 7. Speclet tests
  - Extend `src/speclet.test.ts`, `src/render.test.ts`, and `src/controller.test.ts` for archived parsing, archive-directory discovery opt-in, hidden finished specs, toggle-driven listing, pin drop, and the still-visible `unknown` case; keep the existing all-done auto-hide tests passing with the new predicate.
  - Criteria: AC3, AC5, AC7, AC8, AC9
  - Depends on: 3, 4, 5, 6
- [x] 8. Sync the speclet package and run its guards
  - Mirror `speclet-tui` into `speclet-pi` via `scripts/sync-extension.ts`, then run `bun test`, `scripts/sync-skill.ts --check`, and `scripts/check-fork.ts` from `speclet-pi`.
  - Criteria: AC1, AC5, AC7
  - Depends on: 1, 7
- [x] 9. Specflow extension: same hiding rule as a declared fork
  - In `specflow-pi/src/{render,controller}.ts` and `extensions/index.ts`, hide completed and archived specs from the panel and picker, add the matching session-scoped "Show finished" toggle, and leave archive in place; then run `bun test` and `scripts/check-fork.ts`.
  - Criteria: AC4, AC6, AC7, AC8
  - Depends on: 4, 5
- [x] 10. Update both package READMEs
  - Correct the documented panel/picker behavior to the new hiding rule and the archive location; note that specflow archives stay in place.
  - Criteria: AC5, AC6, AC7

## Outcome
All ten tasks validated. AC1–AC9 verified across the integrated feature, not per task: `isFinished`/`visibleFiles` (speclet) and `isFinished`/`visibleSpecs` (specflow) drive both the panel candidate set and the picker list, so a retired spec is hidden everywhere except the toggle.

Checks run (all green):

| Command | Result |
|---|---|
| `bun test` in `speclet-tui` | 120 pass, 0 fail (265 assertions) |
| `bun test` in `speclet-pi` | 120 pass, 0 fail (265 assertions) |
| `bun test` in `specflow-pi` | 123 pass, 0 fail (299 assertions) |
| `speclet-pi`: `sync-skill.ts --check`, `check-fork.ts` | bundled skill in sync; 11 src files + extensions/index.ts in sync |
| `specflow-pi`: `check-fork.ts`, `sync-skill.ts --check` | fork contract holds; skill tree in sync |

New coverage: archived status parsing and `includeArchive` discovery (missing archive dir included), `isFinished`/`visibleFiles`/`visibleSpecs`, done+archived hiding, toggle reveal, retired-pin drop, `stop()` clearing the toggle, and specflow's "every task checked but still `active` is not retired" case.

Surprises and deviations:

- Three pre-existing `speclet-tui` tests encoded the old semantics and were changed rather than only added to: an explicit **Show panel** reveal no longer resurrects a retired speclet (AC5/AC7 — the toggle is the only way back), the pinned-done test asserts `active()` is now undefined without the toggle, and the atomic-rename test switched its fixture from `done` to `approved` so it still tests rename pickup without depending on visibility.
- Non-interactive `/speclet` and `/specflow` text listings still include retired specs, and the speclet one now reads `.speclet/archive` too. Reading AC5 as covering the panel and the interactive picker only: a non-interactive session has no toggle, so hiding them there would put finished specs out of reach. Say the word and I will filter that listing as well.
- Specflow needed no status or archive change: `completed`/`archived` plus in-place archiving already satisfy AC4, so its only prose edit is the report sentence in Phase 5 Complete. Its finished toggle is a top-level picker entry outside `actionOptions`, because a retired-only set has no active spec and would otherwise offer no way to toggle.
- The unreadable-directory diagnostic text changed from `cannot read .speclet directory:` to `cannot read speclet directory {dir}:` so main and archive reads share one error path; nothing asserted the old wording.
- `archived` was added to the parser whitelist even though a moved file is normally undiscovered: without it, an archived file read through the toggle would parse as `unknown`.

Follow-ups:

- The extension glue (`index.ts` / `extensions/index.ts`) still has no automated test in either package, so the picker toggle is covered only through controller-level tests. Pre-existing gap, unchanged here.
- A filename present in both `.speclet/` and `.speclet/archive/` would pin the first match. Reachable only by copying instead of moving.
