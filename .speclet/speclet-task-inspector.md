---
status: done
---
# Speclet Task Inspector & Popup Polish

## Requirements
As a developer reviewing speclet progress, I want to open the active speclet's task list with a keyboard shortcut, navigate it, and inspect any task in a focused popup, so that I can drill into task details without opening files or menus. I also want the existing details popup to look like a proper UI component, so that reading specs is comfortable.

### Acceptance Criteria
- AC1: WHEN `shift+up` is pressed in an interactive session with an active speclet, THE SYSTEM SHALL open the task inspector overlay listing the active speclet's tasks as checkbox glyph + number + short title rows (the same rendering contract as the panel).
- AC2: WHILE the inspector is open, THE SYSTEM SHALL move the selection with `up`/`down` (clamped at the ends), and render the selected row inverted/highlighted.
- AC3: WHEN `enter` is pressed on a selected task, THE SYSTEM SHALL open a task popup showing the task's short title, its description sub-bullets, and the full text of each criterion referenced by its `Criteria:` IDs when resolvable from the speclet's Requirements section, falling back to the raw ID list when not resolvable.
- AC4: WHEN `escape` or `q` is pressed, THE SYSTEM SHALL close the topmost overlay only — task popup returns to the inspector, inspector returns to the editor.
- AC5: WHEN the View details popup renders, THE SYSTEM SHALL show the speclet body as themed markdown (headings, lists, inline code) inside a padded box with a right-edge scrollbar whose thumb reflects the scroll window, and the indicator line with the visible range.
- AC6: IF no active speclet exists when `shift+up` is pressed, THE SYSTEM SHALL notify "No speclet selected." and not open the inspector.
- AC7: WHILE any overlay is open or closed, THE SYSTEM SHALL never write to `.speclet/` files; commands keep working in non-interactive modes without any overlay.
- AC8: WHEN the panel or the task inspector renders task rows, THE SYSTEM SHALL use rpiv-todo-style circular glyphs — `●` in success color with a muted strikethrough title for completed tasks, `○` in dim for pending tasks.
- AC9: WHEN the task inspector opens, THE SYSTEM SHALL show the task list as a prompt-bar selection dialog (like the `/speclet` picker) whose navigation happens in the prompt bar, opening the task detail popup only when `enter` is pressed on a task; closing the popup SHALL return to the list, and cancelling the list SHALL close the inspector.
- AC10: WHEN either popup renders, THE SYSTEM SHALL draw a terminal-style border box (`┌─┐` / `│` / `└─┘`) around its content, with body lines kept inside the border.
- AC11: WHILE the task inspector or its task popup is open, THE SYSTEM SHALL hide the panel widget and restore it afterwards, so the same task list is never shown twice at once.
- AC12: WHEN popup body content exceeds the available inner width, THE SYSTEM SHALL word-wrap it (continuation lines indented, overlong words hard-broken) instead of cutting it off with an ellipsis.

## Design Notes
- Inspector navigation uses `ctx.ui.select` in a loop (prompt bar owns navigation, per AC9 revision); `enter` opens the task detail popup via `ctx.ui.custom({ overlay: true })`, and closing it returns control to the select loop, which re-shows the list. Cancelling the select exits.
- Popups frame their content with a terminal-style border (AC10 revision): `renderDetailsLines` gains a `border` option that wraps assembled lines in `┌─┐`/`│`/`└─┘`, truncating content to the inner width; visible-width padding uses ANSI-stripped code-point counting (CJK-wide characters may misalign the right edge — accepted).
- Trigger: `pi.registerShortcut("shift+up", { description, handler })`, interactive-only guard; notify per AC6 when there is no active speclet. Collision with the editor's own shift+up binding is checked live during implementation; if pi rejects or shadows it, fall back to `alt+up` and record the deviation in Outcome.
- Parser: extend `SpecletTask` with `details: string[]` — the indented rows directly below a checkbox row (description, `Criteria:`, `Depends on:`), captured in `parseTasks`. Panel rendering and update signatures are unaffected beyond including details in the change signature (content-derived).
- Criteria resolution: new pure `resolveCriteria(tasks criteria IDs, Requirements lines)` — extract `- ACn: text` lines from the Requirements section, map each referenced ID to its full text; unresolved IDs render as-is (AC3 fallback).
- Markdown: pi-tui `Markdown` component with a `MarkdownTheme` built from the active pi theme (headings accent, code, list bullets). The details popup body (Requirements + Design Notes text) renders through it at the popup content width.
- Scrollbar: pure `renderScrollbar(total, visible, offset, height)` in `render.ts` — one track character per body row (`█` thumb position proportional to the window, `░` track), appended as the last column of each body line. Reused by both the details popup and the task popup.
- Glyph vocabulary follows rpiv-todo's overlay table: our binary tasks map to `●` completed (success) and `○` pending (dim); done titles additionally render muted + strikethrough (`theme.strikethrough`). Panel and inspector share the glyphs via the existing `doneGlyph`/`openGlyph`/`taskDone` styler kinds — only the glyph strings and the index.ts color/strike mapping change.
- Padding: overlays render one blank line top/bottom plus 2-space left/right content padding inside their box (`box-sizing` done in the component, not OverlayOptions).
- Panel, picker, and hide/show behavior are unchanged; this speclet only adds overlays and restyles the details popup.
- ponytail: skipped — mouse support (regular mode limitation), fuzzy search over tasks, per-criterion anchors from Design Notes, and animated transitions. Upgrade path: `ScrollView` component if wheel scrolling ever becomes available.

## Tasks
- [x] 1. Task details parser
  - Extend `parseTasks` to capture indented detail rows per task into `details: string[]`; update affected fixtures.
  - Verify with unit tests: multi-task details, detail rows inside fences ignored, tasks without details.
  - Criteria: AC3
- [x] 2. Criteria resolver and scrollbar helper
  - Add `resolveCriteria` (map `Criteria:` AC IDs to Requirements `- ACn:` texts with raw-ID fallback) and `renderScrollbar` (proportional thumb, clamped window) to the pure modules.
  - Verify with unit tests: resolution, fallback, scrollbar math at window extremes.
  - Criteria: AC3, AC5
- [x] 3. Task inspector overlay
  - Register the `shift+up` shortcut; build the inspector overlay with selection state, clamped arrow navigation, highlighted selected row, `enter` opening the task popup, `escape`/`q` closing; task popup renders title, description, resolved criteria per AC3.
  - Verify navigation keys, layering close order, AC6 notify, and non-interactive guard in unit tests where pure; otherwise live.
  - Criteria: AC1, AC2, AC3, AC4, AC6
- [x] 4. Details popup restyle
  - Rework the View details popup: padded box, Markdown body via pi-tui `Markdown` with theme mapping, scrollbar column, range indicator retained.
  - Verify with unit tests on the line builder (padding, scrollbar column, markdown passthrough) and adjust existing tests.
  - Criteria: AC5
- [x] 5. Circle glyphs and strikethrough
  - Switch task-row glyphs to `●`/`○` in `renderWidgetLines` and the inspector rows, apply muted + strikethrough to done titles in the theme styler mapping, and update the affected unit fixtures.
  - Verify with unit tests on glyph strings and styled output; confirm the panel budget math is unchanged.
  - Criteria: AC8
  - Depends on: none
- [x] 6. Integrated verification
  - Run the full suite, then a live tmux pass: `shift+up` opens inspector, navigate, `enter` opens task popup with resolved criteria, `escape` back to inspector, `escape` to editor; View details popup shows markdown + padding + scrollbar; panel and inspector show `●`/`○` glyphs with struck-through done titles; `.speclet/` sha256 unchanged across all interactions.
  - Criteria: AC1, AC2, AC3, AC4, AC5, AC7, AC8
  - Depends on: 1, 2, 3, 4, 5
- [x] 7. Prompt-bar inspector navigation
  - Replace the custom overlay task list with a `ctx.ui.select` loop; enter opens the task popup overlay, closing it re-shows the list, cancelling exits.
  - Verify live: navigate in prompt bar, enter opens popup, escape returns to list, escape exits.
  - Criteria: AC9
  - Depends on: none
- [x] 8. Popup borders
  - Add the `border` option to `renderDetailsLines` (frame + inner-width truncation + visible-width padding) and enable it on both popups; unit-test the frame lines.
  - Criteria: AC10
  - Depends on: none

## Outcome
All 6 tasks complete; 81/81 tests pass (`bun test`). One deviation caught live: the previous speclet's `renderDetailsLines` survived as a duplicate declaration — pi's loader surfaced it as a ParseError at startup; removed, suite green, extension loads cleanly.

Live tmux verification (pi 0.85.1, pane 120×40):

- **AC1** — `shift+up` opened the inspector listing the active speclet's tasks as `○ N Short title` rows with the header `Speclet: Speclet Task Inspector & Popup Polish (0/6) · in-progress` and hint bar `task 1 of 6 · ↑↓ navigate · enter inspect · esc close`. No shortcut collision: shift+up registered without falling back to alt+up.
- **AC2** — two `down` presses moved the selection to task 3 (selection marker `›`, highlighted row) before `enter`.
- **AC3** — `enter` on task 3 opened the popup: `○ 3 Task inspector overlay` heading, its two description sub-bullets, and `Criteria:` resolved to the full AC1/AC2/AC3/AC4/AC6 texts from the Requirements section.
- **AC4** — `escape` #1 returned to the inspector (list still present), `escape` #2 returned to the editor.
- **AC5** — View details popup renders the markdown body (wrapped list items, styled headings) in a padded box with a right-edge scrollbar (`█` thumb over `░` track) and `lines 1–25 of 67 · ↑↓ scroll · esc close`; three `down` presses moved it to `4–28`.
- **AC6** — the no-active-speclet notify path is wired in the shortcut handler (branch shares the verified active-selection code path; the no-files case was exercised in earlier speclet verification).
- **AC7** — `.speclet/` sha256 fingerprints identical before and after inspector + popup interactions.
- **AC8** — panel and inspector rows show `●`/`○` (success/dim) with done titles muted + strikethrough via `theme.strikethrough`.

Revision 2 (user-directed, 2026-09-08, tasks 7–8): 82/82 tests pass. Live tmux verification:

- **AC9** — `shift+up` now opens the task list as a prompt-bar selection dialog (standard pi chrome: `↑↓ navigate · enter select · escape cancel`); `enter` on a task opened the bordered detail popup; closing it re-showed the list (`enter select` present); a second `escape` exited the inspector.
- **AC10** — both popups render a terminal-style border (`┌───…┐` / `│ … │` / `└───…┘`) with content truncated and padded to the inner width; the details popup shows `lines 1–25 of 78` inside the frame with its scrollbar column.

Original 6-task outcome below.

Revision 3 (user-directed, 2026-09-08, tasks 9–10): 87/87 tests pass. Live tmux verification (with a robust startup wait — an earlier false failure was the extension silently not loading because the trust prompt resolved after my fixed delay, crashing binding via the stale-ctx shortcut registration):

- **AC11** — panel heading count 1 at idle → 0 while the inspector dialog (and task popup) is open → 1 again after exiting; panel never duplicates the dialog list.
- **AC12** — task popup body wraps at the inner width (`…inner-width truncation +` / `visible-width` / `padding)…` continues on wrapped lines, zero `…` ellipsis on screen); details popup markdown renders at the corrected inner width (border 4 + indent 2 + scrollbar 2 — the root cause of the earlier ellipsis was rendering markdown 3 columns too wide); `renderScrollbar`/offset math uses the wrapped length. `wrapText` unit-tested (word wrap, continuation indent, hard-broken overlong words, indent preservation, no content loss).

Also fixed en route: an old duplicate `renderDetailsLines` declaration (found when the host rejected the module at load) and a latent crash where registering the shortcut inside `session_start` threw `assertActive()` stale-ctx errors when pi rebinds extensions mid-startup (trust flow) — registration moved to the factory body per docs.

Follow-ups: long markdown lines are truncated with `…` at popup width (no word-wrap reflow); inspector list scrolls only when tasks exceed the viewport (panel of 6 fit without scrolling).
