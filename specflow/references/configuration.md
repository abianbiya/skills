# Configuration

Read this when starting a new spec, changing workflow preferences, or evaluating SpecFlow. Load `defaults.json`, then shallow-merge project `.specflow/config.json`, then the selected spec's `config.json`; explicit user instructions win. Config files are partial overrides: do not repeat inherited defaults without a reason. Malformed files, unknown keys, or invalid values require correction, not silent fallback.

| Key | Values | Effect |
|---|---|---|
| `assurance_level` | Integer 1–10; default 2 | Breadth and depth of verification |
| `delivery_target` | `prototype`, `mvp`, `production`; default `mvp` | What is delivered and what completion means |
| `review_cadence` | `milestone`, `task`; default `milestone` | Progress/checkpoint cadence inside authorized work, not a new approval gate |
| `planning_detail` | `concise`, `detailed`; default `concise` | Document explanation depth, not interview coverage or feature count |

Show effective settings in one line. Ask about settings only when the user has not already chosen them. The Pi picker offers these four values; a graphical slider is not required.

Settings answer different questions: `assurance_level` controls verification evidence; `delivery_target` describes the intended delivery; `planning_detail` controls document explanation depth. None reduces discovery coverage for a new app. A new-app interview remains staged and comprehensive at the default assurance level. A request for concise planning may shorten the written packet, not omit decisions or behavior needed to make it sound.

## Assignment modes

- **implementation**: a real project may be changed only within explicit authorization.
- **planning**: create a review packet/spec for the requested project; no implementation follows from planning alone.
- **prototype**: create a labeled experience reference; it does not prove live integration.
- **evaluation**: test the skill or workflow in an isolated directory/task-owned output. Do not write executable checkbox tasks, modify an example application, or imply implementation authorization. Report the result and limitations.

## Assurance scale

These are policy presets, not confidence scores. Higher levels do not add features, abstractions, coverage quotas, or documents automatically.

| Levels | Default evidence |
|---|---|
| 1–2: Focused | Main journey; focused changed-logic checks; applicable access, secret, and data-integrity/idempotency checks; relevant visual/keyboard review |
| 3–5: Operational | Focused evidence plus common failures, recovery, and affected integrations |
| 6–8: High assurance | Operational evidence plus risk-justified concurrency, compatibility, load, and failure recovery |
| 9–10: Critical | Explicit risk-to-evidence review, representative operating conditions, and independent review where authorized |

These band names describe verification depth, not delivery targets. At every level, preserve truthful states, authorization, privacy, and required repository checks. A missing heartbeat cannot become healthy to simplify an MVP. Level 2 may defer unrelated compatibility/load work, but it may not skip an integrity risk that can corrupt the primary user outcome; for example, retried monitoring ingestion needs duplicate protection.

`prototype` may complete with clearly labeled fixtures and an experience review. `mvp` requires a usable narrow journey through the normal application path. `production` adds concrete release/operating obligations agreed for that deployment.

## Decision labels

Every consequential product decision is labeled:

- **Confirmed** — explicitly selected by the user or inherited from an approved commitment.
- **Proposed** — consequential value awaiting confirmation.
- **Assumed** — reversible default used to continue planning.
- **Open** — material decision or fact not yet understood well enough to propose a choice.
- **Deferred** — intentionally excluded until a stated trigger.

Use this for thresholds, windows, baselines, freshness, retention, ordering, release/review behavior, latency, cost, and quality targets. Include relevant `Proposed` and `Open` decisions in the review packet; never silently turn a proposed number into a confirmed contract.

Interview in manageable rounds, with no fixed question ceiling for greenfield discovery. Ask follow-ups until each relevant decision area is clear enough to review; summarize confirmed choices, proposals, assumptions, open questions, and deferrals between rounds. For existing-project work, keep questions focused on material unknowns the repository cannot answer. Avoid interrogating the user about irrelevant or safely deferrable details.

## Persistence and authorization

Record effective settings and the concrete validation boundary once in the `Approval` section of `tasks.md`. Changing configuration does not authorize application edits, installation, deployment, paid work, or release. Existing approved specs keep their obligations until explicitly reconciled; a new config file cannot retroactively certify completed work.
