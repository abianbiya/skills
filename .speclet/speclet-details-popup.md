---
status: done
---
# Speclet Details Popup

## Requirements
As a developer working with speclets, I want a "View details" entry in the `/speclet` picker that opens a popup showing the selected speclet's requirements and design notes, so that I can read the spec context without leaving the terminal or opening the file.

### Acceptance Criteria
- AC1: WHEN the user selects "View details" from the `/speclet` picker in an interactive session with an active speclet, THE SYSTEM SHALL open an overlay popup whose first line is the frontmatter-derived heading (`name · status · done/total`) and whose body contains the text of that speclet's `## Requirements` and `## Design Notes` sections.
- AC2: WHILE the popup is open and its content exceeds the visible area, THE SYSTEM SHALL scroll the body with `up`/`down`/`pgup`/`pgdn`/`home`/`end` without moving the editor cursor.
- AC3: WHEN the user presses `escape` or `q` while the popup is open, THE SYSTEM SHALL close the popup and restore the editor unchanged.
- AC4: IF the speclet file cannot be read when "View details" is selected, THE SYSTEM SHALL show an error notification naming the file and SHALL NOT open the popup.
- AC5: IF the active speclet has no `## Requirements` or `## Design Notes` section, THE SYSTEM SHALL show `(none)` for that section instead of failing.
- AC6: WHEN `/speclet` runs in a non-interactive mode, THE SYSTEM SHALL keep the existing textual behavior and never open the popup (dialog-free, as before).
- AC7: WHILE the popup is open or closed, THE SYSTEM SHALL never write to `.speclet/` files; the popup shows a snapshot read at open time and does not live-update.

## Design Notes
- User decision (2026-09-08): picker entry only — no global keybinding. Trigger is a new row appended to the `/speclet` select list (after "Hide panel"/"Show panel"), labeled `View details`.
- Mouse/click is impossible here: pi's regular (inline) mode does not capture mouse input (docs/tui.md), and the panel is a regular-mode widget. The popup uses `ctx.ui.custom()` with `{ overlay: true, overlayOptions: { anchor: "center", width: "80%", margin: 2 } }` — verify exact OverlayOptions fields against installed types during implementation.
- New pure helper `parseSections(content)` in `speclet.ts`: fence-aware extraction of `## Requirements` and `## Design Notes` section bodies (reuse `fenceMask`; section ends at next h1/h2; heading line itself excluded; trimmed). Returns `{ requirements: string[]; design: string[] }` of raw lines.
- New pure helper `renderDetailsLines(header, bodyLines, width, height, scrollOffset)` in `render.ts`: styles the heading (accent name, muted meta), renders the body window `[scrollOffset, scrollOffset+height)`, and appends a dim scroll indicator (`lines 12–40 of 96 · ↑↓ scroll · esc close`) when content overflows.
- The popup component reads the file fresh from disk at open time (`readFile` on the active speclet's path — always current, no caching); AC7 snapshot semantics follow from this. Header comes from the already-parsed active `SpecletFile`.
- Popup component implements `handleInput`: `matchesKey` for navigation keys and `escape`/`q` calling `done()`. Cap body height to terminal rows minus margins using `tui` dimensions available in the custom factory.
- Scroll clamp: offset bounded to `[0, max(0, bodyLines - visibleRows)]`.
- ponytail: skipped — live refresh while open, markdown rendering (raw lines shown as-is), mouse wheel (regular mode), and search. Upgrade path: swap raw lines for pi-tui `Markdown` component if rendering fidelity matters later.

## Tasks
- [x] 1. Section parser
  - Add `parseSections(content)` to `speclet.ts`: fence-aware extraction of the `## Requirements` and `## Design Notes` bodies (reuse `fenceMask`, section ends at the next h1/h2, heading lines excluded, trimmed).
  - Verify with unit tests: fenced examples ignored, section boundaries, missing sections yield empty arrays.
  - Criteria: AC1, AC5
- [x] 2. Details line renderer
  - Add `renderDetailsLines(header, bodyLines, width, height, scrollOffset)` to `render.ts`: accent header, body window at the given offset, dim scroll indicator when content overflows.
  - Verify with unit tests: header styling, window bounds, offset clamping, indicator content.
  - Criteria: AC1, AC2
- [x] 3. Picker wiring and popup
  - Append a `View details` row to the interactive `/speclet` select list; on selection read the active file fresh, open the overlay popup via `ctx.ui.custom()` with `{ overlay: true, overlayOptions }`, and handle `up`/`down`/`pgup`/`pgdn`/`home`/`end` scrolling plus `escape`/`q` close; notify an error naming the file when the read fails.
  - Verify the non-interactive `/speclet` path is untouched, then run a live tmux smoke test.
  - Criteria: AC1, AC2, AC3, AC4, AC6
- [x] 4. Integrated verification
  - Run the full suite, then a live tmux check: open details, confirm heading/body/scroll indicator, scroll both directions, close with `escape` and `q`, and confirm `.speclet/` bytes unchanged.
  - Criteria: AC1, AC2, AC3, AC4, AC7
  - Depends on: 1, 2, 3

## Outcome
All 4 tasks complete; 68/68 tests pass (`bun test`, stable across 5 consecutive full-suite runs; one timing-sensitive poll test widened from a 120 ms to a 400 ms observation window after a load-induced flake).

Live tmux verification (pi 0.85.1, pane 120×40, then 120×20 to force overflow):

- **AC1** — `/speclet` list ends with `Hide panel`/`Show panel` and `View details`; selecting it opened the overlay whose first line is `Speclet: Speclet Details Popup · in-progress · 0/4` followed by `## Requirements` and `## Design Notes` bodies (self-referential — the popup displayed this speclet).
- **AC2** — with the pane shrunk to force overflow, the dim indicator showed `lines 1–12 of 21 · ↑↓ scroll · esc close`; five `down` presses moved the window to `6–17`; `PageDown` jumped to `10–21`; `End` clamped at the last full window. `home`/`pageUp` share the same clamped code path.
- **AC3** — popup closed with `q` and, in a second opening, with `escape`; editor and panel restored.
- **AC4** — with the active file chmod 000, selecting `View details` (after pinning it) showed `Error: speclet-tui: cannot read speclet-details-popup.md: Error: EACCES: permission denied…` and no popup opened. The unreadable file also ranked out of automatic selection (unknown status).
- **AC5** — `(none)` rendering covered by unit tests for missing sections.
- **AC6** — non-interactive `/speclet` branch untouched (textual list, no dialog).
- **AC7** — sha256 fingerprints of `.speclet/` identical before and after a full popup open/scroll/close cycle.

Follow-ups: raw body lines are shown unstyled beyond header/indicator coloring (no markdown rendering); content is a snapshot taken at open time and does not live-update; popup scroll uses the whole body window (section headings scroll out of view).
