---
status: done
---
# Speclet Pi Package

## Requirements
As a pi user who likes the speclet workflow, I want to install speclet (skill + TUI extension) with a single `pi install` command, so that I get the workflow and the live panel without copying files or wiring local paths.

### Acceptance Criteria
- AC1: WHEN the package is installed into a scratch project via `pi install -l <abs-path>/speclet-pi` and an interactive session starts, THE SYSTEM SHALL register both the `speclet` skill (visible as `/skill:speclet`) and the TUI extension (live panel, `/speclet` picker, details popup, task inspector) without errors.
- AC2: IF the bundled `skills/speclet/SKILL.md` differs from the source skill at `../speclet/SKILL.md`, THE SYSTEM SHALL fail the prepublish check with a non-zero exit naming the file; running the sync script in copy mode SHALL make the two byte-identical.
- AC3: WHEN `npm pack --dry-run` runs in `speclet-pi/`, THE SYSTEM SHALL include only the package manifest, README, LICENSE, `skills/speclet/SKILL.md`, `extensions/index.ts`, and `src/**` — no unrelated repo files, secrets, or stray artifacts.
- AC4: WHEN `bun test` runs inside `speclet-pi/`, THE SYSTEM SHALL pass with the same test coverage as `speclet-tui` (87 tests baseline).
- AC5: WHILE the package manifest declares `pi` resource paths and `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` as `*`-range peer dependencies (with no bundled pi packages), THE SYSTEM SHALL be installable from npm or git sources per pi package rules, and carry the `pi-package` keyword for gallery discoverability.

## Design Notes
- New package directory `speclet-pi/` in this repo (user-confirmed structure): `speclet/` and `speclet-tui/` stay untouched as development sources.
- `package.json`: name `@abianbiya/speclet` (name verified free on npm, 2026-09-09), version `0.1.0`, `type: module`, `license: MIT`, `private` omitted, `keywords: ["pi-package", ...]`, `files` allow-list per AC3, `scripts.test: "bun test"`, `pi: { extensions: ["./extensions"], skills: ["./skills"] }`, peerDependencies `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` with `"*"` ranges + `peerDependenciesMeta` optional — mirroring the proven `speclet-tui` manifest.
- Extension code moves in unchanged: `speclet-tui/index.ts` → `speclet-pi/extensions/index.ts` (only relative import paths adjusted `./src/...` → `../src/...`); `speclet-tui/src/*.ts` (impl + colocated tests) → `speclet-pi/src/`.
- Skill bundling: copy `speclet/SKILL.md` → `speclet-pi/skills/speclet/SKILL.md`. Guard drift with `scripts/sync-skill.ts` (bun): copy mode overwrites the bundled copy from `../speclet/SKILL.md`; `--check` mode byte-compares and exits non-zero on drift (AC2). Wired as `prepublishOnly` so `npm publish` can never ship a stale skill.
- README.md: what speclet is, what the package installs, install commands (`pi install npm:@abianbiya/speclet`, `pi install git:github.com/abianbiya/skills` caveat — repo root is not the package, so git installs should target a tagged package path or a future dedicated repo; document npm as the primary channel, local path for dev), and usage (skill workflow, panel, `/speclet`, `shift+up` inspector).
- LICENSE: MIT.
- Prerequisites outside the coding checklist: `npm adduser` login on this machine (currently missing), `npm publish --access public`, and optionally a dedicated git repo if git-channel installs are wanted. Gallery listing happens automatically once the npm package carries the `pi-package` keyword.
- ponytail: skipped — CI, npm provenance/signing, screenshot/video gallery metadata, changesets/versioning automation, and moving `~/.agents/skills/speclet` to symlink to the package. Upgrade path: add CI + gallery media when the package gets its own repo.

## Tasks
- [x] 1. Scaffold the package and move the extension code
  - Create `speclet-pi/` with `package.json` (manifest, peer deps, files, keywords), move `speclet-tui/index.ts` → `extensions/index.ts` with adjusted relative imports, copy `src/` impl + tests. Verify with `bun test` in `speclet-pi/`.
  - Criteria: AC3, AC4, AC5
- [x] 2. Bundle the skill with a drift guard
  - Copy `speclet/SKILL.md` → `skills/speclet/SKILL.md`; add `scripts/sync-skill.ts` (copy + `--check`) wired as `prepublishOnly`. Verify copy mode yields byte-identical files and `--check` fails on an injected drift.
  - Criteria: AC2
  - Depends on: 1
- [x] 3. Add README and LICENSE
  - Write install/usage docs (npm primary, local-path dev install, git-channel caveat) and the MIT license file.
  - Criteria: AC3
  - Depends on: 1
- [x] 4. Verify package integrity and installation
  - Run `bun test`, `npm pack --dry-run` (inspect tarball listing against AC3), then `pi install -l <abs>/speclet-pi` in a scratch project: confirm `/skill:speclet` is available and panel, `/speclet` picker, details popup, and task inspector all work; record host version and evidence.
  - Criteria: AC1, AC3, AC4
  - Depends on: 2, 3

## Outcome
All 4 tasks complete; 87/87 unit tests pass in `speclet-pi/` (bun test), bundled skill verified in sync. `npm pack --dry-run` produced exactly the 11 intended files (LICENSE, README, package.json, extensions/index.ts, skills/speclet/SKILL.md, src/*.ts + tests), 23.8 kB tarball — no strays.

Live verification in scratch project `/tmp/speclet-pkg-e2e` (host pi 0.85.1, `pi install -l /Applications/XAMPP/xamppfiles/htdocs/airesearch/skills/speclet-pi`), via tmux interactive session:

- **AC1** — package registered without errors; live panel rendered `Speclet: Demo Feature (1/2) · in-progress` with `● 1 First task` / `○ 2 Second task`; `/speclet` picker listed `demo.md · in-progress · 1/2` + Hide panel + View details; View details popup rendered Requirements (with AC1 text) and Design Notes in a bordered popup; `shift+up` opened the task inspector; enter opened the task popup with description and resolved criteria text; `skill:speclet` appeared in command autocomplete.
- **AC2** — sync script copy mode produced byte-identical files (cmp); injected drift made `--check` exit 1 naming the file; copy restored sync.
- **AC3** — tarball contents match the allow-list exactly.
- **AC4** — 87 tests pass (same count as speclet-tui baseline).
- **AC5** — manifest declares `pi` resources + `*`-range optional peer deps + `pi-package` keyword; install from local path succeeded cleanly.

Notes: (1) On this machine pi reports a benign `speclet` skill-name collision — the user's global skill wins and the package's bundled copy is skipped; other users without a global speclet get the bundled one. (2) Publishing prerequisites remain: `npm adduser` login, then `npm publish --access public`; gallery listing is automatic via the `pi-package` keyword. (3) Follow-ups from ponytail skips: dedicated git repo if git-channel installs are wanted, CI, gallery media.
