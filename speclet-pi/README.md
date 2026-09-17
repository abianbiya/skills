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
- Live panel — always-visible checklist (`✓`/`○` tasks, status, progress) that updates within ~0.5 s of file edits. It hides itself once **every** speclet is `status: done` (nothing left to act on); pick a speclet from `/speclet` or choose **Show panel** to bring it back, and it reappears on its own when any speclet is reopened or added.
- `shift+up` — task inspector: navigate tasks, press enter to see a task's description and acceptance criteria. The key is configurable (see below).
- View details (in the `/speclet` picker) — read the spec's Requirements and Design Notes in a popup. If the host's markdown renderer expects a different theme shape (some pi forks, e.g. `@oh-my-pi`, read `theme.symbols` while styling inline code), the popup falls back to plain text with a one-time warning instead of raising an uncaught exception.

## Changing the inspector shortcut

The shortcut is bound when the extension loads, and pi's own `~/.pi/agent/keybindings.json` cannot remap it (that file only covers pi's built-in actions). It lives in `<agent dir>/speclet.json` instead:

```json
{ "shortcut": "ctrl+alt+i" }
```

Set it from pi:

```
/speclet shortcut            # show the current key and where it is configured
/speclet shortcut alt+i      # set one (modifiers + a single key, case-insensitive)
/speclet shortcut none       # remove the shortcut entirely
```

The active agent dir is used, so each profile can differ. Changes take effect after `/reload`. Without a config file the default stays `shift+up` (with `alt+up` as a fallback if the host rejects that binding); once you configure a key it is used exactly as written, and a value that is not a valid key id — or a file that cannot be parsed — disables the shortcut and warns instead of quietly binding something else.

## Escalation

Speclet is the lightweight sibling of [specflow](https://github.com/abianbiya/skills). Escalate to a full specflow workflow on 3+ design decisions, multi-module changes, or migrations.

## License

MIT
