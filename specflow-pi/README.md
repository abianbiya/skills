# @abianbiya/specflow

Spec-driven development for [pi](https://pi.dev) — outcome-first SpecFlow workflow (staged new-app discovery or focused feature clarification → experience reference → executable approved-scope plan → iterative delivery and handoff) plus a live cockpit panel that shows where every spec stands and when the agent is waiting on your approval.

Installing this package gives you two things:

1. **The `specflow` skill** — staged new-app discovery, requirements, experience/technical design, and executable tasks for the approved delivery scope, in `.specflow/specs/{feature}/`, plus lifecycle guidance (complete, archive, list, resume).
2. **The SpecFlow TUI extension** — a live display for parsed phase, progress, next task, traceability/metadata warnings, and review-gate state. Its `/specflow` menu sends requests to the agent to execute a selected task, approve a recorded decision, validate, change settings, switch specs, or read documents. The extension itself never writes to `.specflow/` and does not enforce authorization or orchestrate execution; the agent must follow the skill and approved `tasks.md` scope.

## Install

```bash
pi install npm:@abianbiya/specflow
```

Or try it without installing:

```bash
pi -e npm:@abianbiya/specflow
```

For development against a local checkout:

```bash
pi install -l /absolute/path/to/specflow-pi
```

## Usage

- Ask for a new app: the agent conducts a staged interview across project foundations, requirements/behavior, experience/technical design, and executable tasks for the requested delivery target. For a whole-app request, it plans all agreed in-scope work across milestones before one plan review. It summarizes decisions between rounds and can recommend unchosen technologies for confirmation. Ask for an existing-project feature: the agent first inspects the repository and focuses questions on material unknowns.
- Live panel — the selected spec's name, phase (Requirements / Design / Tasks / Executing), done/total task count, status, and gate badge, updating within ~0.5 s of file edits. Specs that are `completed` or `archived` are retired: the panel stops following them and the `/specflow` list stops showing them, in this session and in every later one. Archives stay where they are — specflow never moves directories.
- `/specflow` — act on the active spec without leaving the terminal:
  - **Execute a task…** — when the spec is active and ungated, pick an unfinished task (`▶` ready, `⏸` blocked, with what it waits on); the selected task is sent to the agent. For hands-off whole-plan execution, ask the agent to execute the already approved plan through final handoff.
  - **Approve gate and resume** — sends your approval of only the recorded decision. For a plan review, the plan must state the requested execution scope separately from the still-unapproved authority; approval authorizes exactly that requested scope, not unlisted work. A prototype approval does not grant application implementation authority.
  - **Workflow settings…** — choose assurance 1–10, delivery target, review cadence, or planning detail for this spec. Canceling sends nothing; selecting a value requests an agent edit, not application execution.
  - **Validate implementation** / **Open document…** — `requirements.md`, `design.md`, `tasks.md`, or `project.md` in a scrollable popup. Metadata errors remain visible instead of making a spec runnable by guesswork.
  - **Hide/Show panel**, **Show/Hide finished**, and the spec list to switch which spec the panel follows (**Show finished** also lists `completed` and `archived` specs so you can read one again)
- Panel rows, beyond the phase: `Next: 2.1 Wire the Fastify hook` (first task whose dependencies are done), and one warning row when traceability is incomplete — `⚠ 1 unclaimed AC · 1 orphan criterion · 1 dangling dep`, i.e. requirements no task implements, citations of ACs that don't exist, and `Depends on:` ids that don't resolve.
- `resume` / `complete` / `archive` — lifecycle routes from the skill; the panel reflects the reconciled state.

## Workflow preferences

Defaults are assurance **2**, delivery target **mvp**, review cadence **milestone**, and planning detail **concise**. Assurance controls evidence depth, delivery target describes the intended result, planning detail controls document explanation, and review cadence controls progress reporting inside authorized work; none substitutes for plan approval or limits new-app discovery. The agent merges skill defaults, `.specflow/config.json`, and per-spec `config.json`; explicit user instructions take precedence. Existing approved commitments are preserved. Evaluation mode uses isolated output and does not create executable task plans or authorize application edits.

```json
{"assurance_level": 2, "delivery_target": "mvp", "review_cadence": "milestone", "planning_detail": "concise"}
```

Levels 1–2 focus on the main journey, 3–5 add common failures/recovery, 6–8 add risk-relevant operational checks, and 9–10 require explicit risk-to-evidence review. Levels do not add features or waive authorization, truthful output, or required regression checks. The numeric picker is not a graphical slider. See [configuration](skills/specflow/references/configuration.md) for exact semantics. Settings are interpreted by the agent; the panel does not enforce tests or establish product acceptance.

## Companion package

[`@abianbiya/speclet`](https://www.npmjs.com/package/@abianbiya/speclet) is the lightweight sibling: single-file specs for small features. Use SpecFlow for work that benefits from separate outcome, experience, and milestone records.

## License

MIT
