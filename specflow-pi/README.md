# @abianbiya/specflow

Spec-driven development for [pi](https://pi.dev) — full SpecFlow workflow (Requirements → Design → Tasks → Execution with explicit review gates) plus a live cockpit panel that shows where every spec stands and when the agent is waiting on your approval.

Installing this package gives you two things:

1. **The `specflow` skill** — the structured five-phase workflow: drafting `.specflow/specs/{feature}/` documents (requirements, design, tasks), explicit approval gates between phases, validated task execution, and lifecycle management (complete, archive, list, resume).
2. **The SpecFlow TUI extension** — a live cockpit panel for the active spec (phase, progress, next actionable task, traceability warnings, and a gate badge when the agent is parked awaiting your review), plus a `/specflow` command that can **launch work** — execute a task, approve a gate and resume, validate — as well as switch specs and read documents. The extension itself never writes to `.specflow/`: every action reaches the agent as an explicit user message, so the skill stays the only writer.

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

- Ask for a feature and the agent drafts requirements, then design, then tasks — each stopping for your approval (the panel shows `awaiting your review` at every stop).
- Live panel — the selected spec's name, phase (Requirements / Design / Tasks / Executing), done/total task count, status, and gate badge, updating within ~0.5 s of file edits.
- `/specflow` — act on the active spec without leaving the terminal:
  - **Execute a task…** — pick from the unfinished tasks (`▶` ready, `⏸` blocked, with what they wait on); the chosen task is sent to the agent as `Execute task 2.1 of the rate-limit spec.`
  - **Approve gate and resume** — appears only while a review gate is pending
  - **Validate implementation** / **Open document…** — `requirements.md`, `design.md`, `tasks.md`, or `project.md` in a scrollable popup
  - **Hide/Show panel**, and the spec list to switch which spec the panel follows
- Panel rows, beyond the phase: `Next: 2.1 Wire the Fastify hook` (first task whose dependencies are done), and one warning row when traceability is incomplete — `⚠ 1 unclaimed AC · 1 orphan criterion · 1 dangling dep`, i.e. requirements no task implements, citations of ACs that don't exist, and `Depends on:` ids that don't resolve.
- `resume` / `complete` / `archive` — lifecycle routes from the skill; the panel reflects the reconciled state.

## Companion package

[`@abianbiya/speclet`](https://www.npmjs.com/package/@abianbiya/speclet) is the lightweight sibling: single-file specs for small features. Use specflow for mid-to-large features with multiple review gates.

## License

MIT
