# {Project name} — project context

{In two or three sentences, explain what the app is, who uses it, and the agreed delivery outcome. Keep this current as the project changes.}

## Purpose and expected outcome
- Purpose: {problem the app addresses}
- Agreed delivery outcome: {what the user should be able to do at the selected target}

## Users and simple flow
- Users and usage context: {who uses it and where}
- Main flow: {entry → primary action → result → return use}

## Existing system and conventions
For an existing repository, inspect applicable project instructions, stack, entry points, data and integration boundaries, and relevant conventions. Record verified facts and link existing guidance instead of copying it. For a new repository, record its status and location; establish conventions during implementation.

## Product and technical foundations
Assess each area for a new app. Record `N/A` with a reason when irrelevant. Use `Confirmed`, `Proposed`, `Assumed`, `Open`, or `Deferred` for product and technology decisions. Use `Verified` only for facts inspected in the repository or runtime; a choice can be both `Confirmed` and `Verified` after implementation. Keep the basis brief so a recommendation is not mistaken for a user decision.

| Area | Choice or current fact | State | Basis |
|---|---|---|---|
| Repository | {status and location} | {Verified / Open} | {inspection or user answer} |
| Platform and client | {web/mobile/desktop/CLI/API} | {decision state} | {reason or source} |
| Language | {language or proposal} | {decision state} | {reason or source} |
| Framework | {framework, none, or proposal} | {decision state} | {reason or source} |
| Runtime | {required version/environment} | {decision state; Verified when checked} | {check or source} |
| Storage and data ownership | {database/files and owner} | {decision state} | {reason or source} |
| Identity and access | {login, roles, tenancy, or N/A} | {decision state} | {reason or source} |
| Hosting and operation | {local or hosted environment} | {decision state} | {reason or source} |
| Integrations | {services or N/A} | {decision state} | {reason or source} |

## Run and verify
Record the verified start command, entry URL or path, relevant checks, required runtime, and known integration limits after implementation. Keep credentials out. Distinguish commands that were run from commands merely proposed.

## Constraints and workflow preferences
Record material compatibility, access, privacy, security, accessibility, localization, data, cost, connectivity, and release constraints. Workflow preferences belong in `.specflow/config.json`; see the configuration reference. Do not infer that assurance or delivery settings settle product or technology decisions.

## Specs history
Keep a short index of project specs with links and their current lifecycle status from each `tasks.md`. Put detailed approvals, task evidence, and decisions in the individual spec rather than duplicating them here.

| Spec | Scope | Status | Link |
|---|---|---|---|
| {Name} | {brief outcome} | {active/completed/archived} | {link to the spec's tasks.md} |
