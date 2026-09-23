---
name: specflow
description: "Plan and build around demonstrated outcomes, with staged app discovery, executable scoped plans, concrete experience reviews, configurable assurance, and iterative delivery."
---

# SpecFlow

## Core contract

Establish the intended outcome, show a concrete example, agree on the delivery boundary, plan executable work for the approved scope, then build incrementally and demonstrate the result. The first useful slice is the first iteration, not a substitute for planning the rest of a requested app. Requirements, design, and tasks support that loop; document volume and passing tests are not measures of product success.

Before creating files, classify the assignment: `implementation`, `planning`, `prototype`, or `evaluation` of this skill. A project used as an example does not become an implementation target. Approval applies only to the artifact and scope presented. Screen approval is not application-change authorization.

For a new application idea, use a staged discovery interview before writing its first spec. Cover project foundations, user outcomes and behavior, experience and technical design, then the first useful milestone and its evidence. Ask in manageable rounds, summarize decisions and open questions between rounds, and follow up until each relevant area is understood well enough to review. Comprehensive discovery does not mean every possible feature or technical option: mark irrelevant areas not applicable, and defer future or low-impact choices. A user may ask to shorten or skip a round.

For an existing project or a bounded feature, inspect the repository and interview only for context the evidence cannot establish. A new-app interview is not shortened by MVP delivery or low assurance settings. `assurance_level` governs verification, `delivery_target` defines intended delivery, and `planning_detail` governs how much explanation the documents contain; none is a discovery-depth limit.

Resolve [configuration](references/configuration.md), then prepare requirements, design, and tasks from the interview. When the user asks for a complete new app at a delivery target, plan all agreed in-scope work as executable tasks across milestones; keep only deferred/out-of-target ideas as roadmap bullets. The default is one coherent review packet and one approval gate, not separate phase approvals. Use concise documents when requested, while retaining enough detail to make the approved scope executable.

For `evaluation`, use an isolated test directory or task-owned output, never the example application's `.specflow/`; do not create an executable checkbox plan; label evidence and stop at the evaluation decision. Evaluation approval never authorizes implementation.

Execute only the exact authorized plan, milestone, task, or range. A whole-plan approval can cover every listed in-scope task through final integration and user handoff; do not stop for new approval at each milestone. Demonstrate outcomes and distinguish engineering checks, real integration, experience review, and owner acceptance. Material changes to scope, experience, cost, compatibility, privacy/security, or risk return for focused review.

When an actual decision is pending, put `gate: review` in YAML frontmatter at the top of `tasks.md` and state the decision and requested scope in the body. Distinguish the execution authority requested from the authority actually recorded after the user approves; before then, authorization is `none`. A gate is a decision marker, not execution permission. Preserve existing approved commitments until explicitly reconciled.

## Routes

Load only the relevant reference; reuse unchanged context.

| Intent | Reference |
|---|---|
| New application / greenfield spec | [Project setup](references/project-setup.md), then [Requirements](references/requirements-phase.md), [Design](references/design-phase.md), and [Tasks](references/tasks-phase.md) in order |
| Settings, assurance, scope, or evaluation mode | [Configuration](references/configuration.md) |
| New feature, outcome brief, or interview | [Requirements](references/requirements-phase.md) |
| Prototype, screen direction, or technical decisions | [Design](references/design-phase.md) |
| Scope and executable task plan | [Tasks](references/tasks-phase.md) |
| Implement or validate authorized work | [Execution](references/execution-phase.md) |
| Resume, list, complete, or archive | [Lifecycle](references/lifecycle-phase.md) |
| Missing shared context in an existing project | [Project setup](references/project-setup.md) |

## Files

```text
.specflow/
├── project.md
├── config.json                 # optional partial project preferences
└── specs/{feature-name}/
    ├── config.json             # optional partial per-spec overrides
    ├── requirements.md         # short outcome brief
    ├── design.md               # experience reference and necessary decisions
    ├── tasks.md                # milestones, approvals, evidence, lifecycle
    └── artifacts/              # optional references; never executable planning docs
```

New flat executable specs require `tasks.md` frontmatter:

```yaml
---
status: active
gate: review
---
```

Use descriptive kebab-case names. Preserve older layouts and existing IDs as described in Lifecycle. Do not silently migrate or relax existing specs.
