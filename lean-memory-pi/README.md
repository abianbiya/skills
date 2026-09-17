# Lean Memory for Pi

**Project memory by default. Global memory by explicit choice.**

`@abianbiya/lean-memory` is a standalone Pi extension. A brand-new project sees
only your small global memory, not another project's tasks, logs or decisions.

Built on ideas and **line-preserving scratchpad / entry-aware deletion helpers
from [pi-memory](https://github.com/jayzeng/pi-memory) by Jay Zeng (MIT)**. Version
0.2 owns its scoped storage, search and snapshot lifecycle; it does **not** run
upstream's shared memory engine. Full credit and upstream license are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Scope rules

| Data | Default scope | Automatic injection |
| --- | --- | --- |
| Facts (`MEMORY.md`) | Current project | Small global + current-project facts |
| Scratchpad | Current project | Only open tasks in global/current project |
| Daily logs | Current project | Never; retrieve when relevant |
| Search | Current project + global | Only when called |
| Forget / restore | Current project | Recovery stays in its originating scope |

Use `scope: "global"` deliberately for universal preferences/safeguards, such as
"never use my personal browser profile." Repository commands, environment details,
and unfinished work belong to project memory. No cross-project search API is
exposed. These are tool-level boundaries, not an OS sandbox: ordinary filesystem
tools still have the user's permissions.

### Project identity

The canonical Git **working-tree root**, resolved through symlinks, is hashed with
SHA-256. Nested folders share a project's memory; repositories with the same name
do not. Separate worktrees have separate facts, tasks and logs. Nothing is keyed
by branch name, remote URL or folder basename. Renaming/moving a root creates a
new identity; existing memory stays archived until explicitly migrated.

For non-Git projects, set an absolute `LEAN_MEMORY_PROJECT_ROOT` in the harness
launch environment. The current directory must be inside that root. No project
config is read or executed. If no project is identified (including Git failure or
a bare repository), injection/search fall back to **global-only**; default project
read/write/task/recovery calls fail clearly rather than silently writing globally.

## Install

```bash
pi install npm:@abianbiya/lean-memory
```

Or try it without installing:

```bash
pi -e npm:@abianbiya/lean-memory
```

For development against a local checkout (run `npm install` in this package
directory first):

```bash
pi install /absolute/path/to/skills/lean-memory-pi
```

No qmd, embeddings, external service or API key is required for memory.
Pi supplies the SDK peer dependencies. Upstream `pi-memory@0.4.2` is pinned and
bundled for its helper functions; its original copyright/license is included.

Runtime requirements: Pi 0.85.1 or newer, which provides the
`@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` peer dependencies.
`main` points at the TypeScript extension entry that Pi loads; this package is not
intended to be imported as a Node module. The only installed runtime dependency is
`pi-memory@0.4.2` for its helper functions, and it is bundled in the tarball.

**Disable any separately loaded pi-memory extension** and remove/disable the old
`extensions/lean-memory/` adapter copy to prevent duplicate tool registrations:

```json
{
  "packages": [
    { "source": "npm:pi-memory", "extensions": [] },
    "npm:@abianbiya/lean-memory"
  ]
}
```

Merge these with existing settings, then `/reload`. Installing only Lean Memory
on a clean profile does not require a separate pi-memory package entry.

## Storage and configuration

Private memory stays outside repositories by default:

```text
~/.pi/agent/memory/
  global/
    MEMORY.md
    SCRATCHPAD.md
    daily/YYYY-MM-DD.md
    recovery/<uuid>.json
  projects/<sha256-of-canonical-working-tree-root>/
    MEMORY.md
    SCRATCHPAD.md
    daily/YYYY-MM-DD.md
    topics/*.md                 # optional manually maintained notes
    recovery/<uuid>.json
```

| Environment variable | Meaning |
| --- | --- |
| `LEAN_MEMORY_DIR` | Absolute storage root; default `~/.pi/agent/memory` |
| `LEAN_MEMORY_PROJECT_ROOT` | Optional explicit absolute project root, useful without Git |

Use `memory_status` to inspect the active project root/hash and exact directories.
Legacy `PI_MEMORY_*` variables are not used; Lean Memory does not mutate them or
share upstream's process-global storage state. Configure environment before
launch/reload. Storage is shared across profiles using the same root, separated
by canonical working tree. Memory is local/private and never packaged or committed.

Team-shared instructions belong in project `AGENTS.md`, not private memory.

## Tools

Seven familiar tool names remain, but scopes and behavior are explicit:

- `memory_write`: project by default; `scope: global` opts into global. Facts may
  append/overwrite; daily logs append only. Overwrite creates a full-file backup.
- `memory_read`: project by default; facts, scratchpad, daily log or scoped file
  list. Character offsets and bounded limits allow paging (maximum 12,000 chars).
- `scratchpad`: add/done/undo/clear_done/list in one scope. Clear-done backs up the
  original. Unknown prose and sub-notes survive checklist mutations.
- `memory_search`: default `scope: both` means current project + global only;
  `project` or `global` can narrow it. Local keyword matching requires all query
  terms. Returns up to 10 scoped filenames/snippets, default 3.
- `memory_forget`: removes matching entries and saves recovery before mutation.
- `memory_restore`: restores missing entries, idempotently preserving later writes.
  A recovery ID from project A cannot be restored in B or global memory.
- `memory_status`: identities, directories, search boundaries and snapshot policy.

Examples:

```text
memory_write(target="long_term", content="Tests run inside the app container.")
scratchpad(action="add", text="Verify concurrency before declaring completion.")
memory_write(scope="global", target="long_term", content="Use isolated browsers.")
memory_search(query="container tests", limit=3)
memory_read(target="daily", date="2026-09-15", offset=0, limit=4000)
```

### Browsing: `/memory`

`/memory` opens a read-only picker for the active scope — open tasks, facts and file
lists for this project and for global memory, each row showing its count or size.
Selecting a row shows its contents, then returns to the list; dismissing the picker
closes it. It writes nothing and reads disk directly, so it shows what another session
or an external editor has already saved. There is no global/cross-project row: another
project's memory is not reachable from here. Without an interactive UI (print/JSON
mode) the same inventory is emitted as one text notification instead of dialogs.

#### `/memory html` — browser view

Serves the same inventory as a local web page and opens it, so long facts and task
lists are readable in a real browser instead of a dialog. `/memory close` stops it.

- **Loopback only.** The socket binds `127.0.0.1` on an OS-assigned port — never a
  wildcard address, so other machines cannot reach it.
- **Token-gated.** A per-run random token is required (`/?token=…`, compared in
  constant time). Requests without it get `403`. The port is shown in the status line;
  the token is not, and is not logged.
- **Read-only, no filesystem surface.** Only `/` (a static shell) and `/data` (JSON) are
  served. No request path, header or body is ever turned into a path, and no write
  endpoint exists.
- **Injection-proof.** The shell carries no memory content; entries are rendered
  client-side with `textContent`, so a note containing `<script>` or `<img onerror>…`
  displays as literal text and cannot execute. A CSP of `default-src 'none'` blocks
  every external load.
- **Live.** The page polls every 2s, so writes from tools appear without a reload. It
  follows the project it was opened from even if the working directory later changes.
- **Ephemeral.** The server is unref'd: it never holds the pi process open, dies with
  the session, and does not survive a restart. Re-running `/memory html` replaces it.

Auto-launching the browser only happens in TUI mode. On a remote or headless host the
URL is announced instead, so nothing opens on the wrong machine. In print/JSON mode the
browser view is unavailable and `/memory` prints a listing.

The file list/status identifies directories for reading manually maintained topic
files with normal filesystem tools. Unrelated legacy archives are not part of
search, even if the old qmd collection still indexes them.

## Stable context and limits

Snapshots refresh on session/reload/cwd change, successful compaction, and facts
or scratchpad mutations through tools. The ambient prompt is cached per project
identity and stamped with an invalidation generation, so interleaved turns for two
projects cannot share one snapshot, and a snapshot that started before a write
cannot repopulate the cache once that write lands. Daily writes do not invalidate ambient
context. External edits and other sessions' writes become ambient after `/reload`
or compaction; explicit read/search always reads disk. No automatic per-prompt
search, exit-summary LLM call or copying of mixed recent logs takes place.

Keep global facts under 2,000 characters. Injection ceilings per scope: facts
2,400 characters, open tasks 800, plus headings/omission labels. Whole lines are
kept; omission is visible. Keep critical safeguards near the beginning and curate
files instead of relying on truncation. A fresh project needs no filler context.

Files are limited to 1 MiB. Search scans at most 1,000 directory entries per scope,
three nested directory levels and 8 MiB of text across selected scopes. It skips
recovery/hidden files and symlinks, bounds snippets to 1,000 characters, and labels
scan truncation. Oversized/unreadable files fail visibly, not as "no memories."

Writes use per-scope inter-process locks and atomic file replacement; recovery
is written before deletion. A lock waits up to five seconds, then fails without
stealing it. After a crashed writer, verify no writer remains before manually
removing that scope's `.lock` directory. Do not edit the same files concurrently
with tools that ignore this lock. Symlinks inside scoped storage are refused for
reads/writes and skipped by search. This does not protect against a hostile OS
user concurrently replacing directory components.

## Upgrading from pi-memory / Lean Memory 0.1

This release intentionally **does not automatically migrate** mixed old memories.
Old root-level `MEMORY.md`, `SCRATCHPAD.md`, `daily/`, `topics/` and recovery records
remain unchanged but are not injected or searched. An empty new scope is normal.

1. Back up the old memory directory.
2. Curate truly universal preferences into `global/MEMORY.md`; omit project lists.
3. Resolve each project's directory **offline**. The identity is the SHA-256 of the
   canonical, symlink-resolved working-tree root with **no trailing newline**, so the
   hashed string must match `fs.realpath` byte for byte:

   ```sh
   root=$(cd /path/to/repo && pwd -P)                    # canonical root, newline stripped
   printf '%s' "$root" | shasum -a 256 | cut -d' ' -f1   # GNU/Linux: sha256sum | cut -d' ' -f1
   ```

   That digest is the directory name under `~/.pi/agent/memory/projects/`. Confirm it
   against `memory_status` run from inside that repository *before* copying anything: a
   mismatch means you would populate a directory the extension never reads.
4. Copy only clearly attributable notes into `projects/<digest>/topics/<name>.md` (or
   facts/tasks into that project's `MEMORY.md` / `SCRATCHPAD.md`). Keep unfinished tasks
   open. Migration is a copy, not a move: leave the originals in place as the archive.
5. Verify from that project: `memory_read target="list"` shows the file and a
   `memory_search` for its contents returns it. Then verify from an unrelated project
   that the same search returns nothing.
6. Leave cross-repository or ambiguous notes archived until a single owning root is
   confirmed. A note that spans repositories (several projects, one tooling topic) has
   no correct destination yet; do not bulk-route by filename. Migrate one project per
   verification, not one file per guess. Ambiguous daily logs stay archived as they are:
   read them with normal filesystem tools when you need that history, and copy across
   only entries you can attribute to a confirmed root.
7. `/reload`, then re-check that another project cannot read or search those notes.

Old recovery IDs require the old implementation/archive; they are not silently
reinterpreted. Full-file overwrite/clear-done backups are for manual inspection
and merging, not automatic restore that could overwrite subsequent work.

**ponytail:** this release uses bounded local keyword search, not semantic/deep
search. The upgrade path is a scope-filtered index with isolation tests; reusing
the old shared qmd collection would defeat the boundary. Worktree-shared facts,
automatic archival and automatic identity migration are also intentionally absent.

## Development / release checks

```sh
npm run typecheck
npm test
npm pack --dry-run --ignore-scripts
```

Tests create disposable Git repositories and memory directories; they never
commit, touch real user memory, run migrations, query models, or invoke qmd.
They cover two-project isolation, global-only behavior, canonical identity,
scope-bound recovery, symlink/path validation, budgets and concurrent processes.

The owner's checkout reuses installed SDK/dev tools via ignored `node_modules`
links and an unchanged copy of the pinned upstream package. No machine paths are
included in the published source/manifest. To publish after review, run `npm publish
--access public`; `prepublishOnly` runs typecheck and tests. This is documentation,
not an indication that the package has been published.

## Rollback and license

Remove this package entry and re-enable upstream pi-memory, then `/reload`. The
new scoped files remain on disk. Upstream may resume injecting its old mixed
memory and searching its old collection, so rollback also changes isolation.

This extension is MIT licensed. Jay Zeng's upstream helpers retain their original
MIT copyright; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
