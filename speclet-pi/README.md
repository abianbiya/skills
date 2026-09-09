# @abianbiya/speclet

Spec-driven development for [pi](https://pi.dev) — plan small features in one spec file with a single approval gate, then execute the checklist with a live progress panel.

Installing this package gives you two things:

1. **The `speclet` skill** — a structured workflow the agent follows: it drafts `.speclet/{feature}.md` (requirements, EARS-lite acceptance criteria, design notes, coding tasks), gets your explicit approval, then executes the full checklist with validation.
2. **The speclet TUI extension** — a live panel above the editor showing the active speclet's checklist, plus `/speclet` picker, details popup, and task inspector. Read-only; it never touches your spec files.

## Install

```bash
pi install npm:@abianbiya/speclet
```

Or try it without installing:

```bash
pi -e npm:@abianbiya/speclet
```

For development against a local checkout:

```bash
pi install -l /absolute/path/to/speclet-pi
```

## Usage

- Ask for a small feature and the agent drafts a speclet in `.speclet/{feature-name}.md`; approve it to start execution.
- `/speclet` — list speclets and pick which one the panel shows.
- Live panel — always-visible checklist (`✓`/`○` tasks, status, progress) that updates within ~0.5 s of file edits.
- `shift+up` — task inspector: navigate tasks, press enter to see a task's description and acceptance criteria.
- View details (in the `/speclet` picker) — read the spec's Requirements and Design Notes in a popup.

## Escalation

Speclet is the lightweight sibling of [specflow](https://github.com/abianbiya/skills). Escalate to a full specflow workflow on 3+ design decisions, multi-module changes, or migrations.

## License

MIT
