# Execution: deliver and demonstrate

Read project context, selected settings, and the relevant requirements/design/tasks once at the start. Confirm assignment mode, actual implementation target, approved plan baseline, included/excluded scope, and authorization. Existing specs retain their recorded boundaries until reconciled.

If the user approved all in-scope tasks in a whole-app plan, execute the complete plan in dependency order through final integration and handoff. Do not stop for new approval at each task or milestone; milestones are progress checkpoints within that authorization. Report progress without requiring the user to resume routine work. If authorization names a task/range or only a first slice, stay within that boundary. A task picker request authorizes only the selected task unless the Approval section already grants broader scope. `review_cadence` sets progress/reporting checkpoints inside authorized work; it never expands scope or requires reapproval by itself.

Use approved decisions and assumptions. Record low-risk reversible implementation choices with a short reason. If evidence requires a change to user outcome, scope, approved experience, cost, compatibility, privacy/security posture, or material risk, pause only the affected work, present the evidence and smallest options, and request a focused decision. Continue independent authorized work where safe. Do not turn an open plan question into an unapproved consequential decision. Evaluation mode never edits the example application.

After each demonstrable increment, update task status, evidence, and dependencies, then continue the remaining approved plan. Keep planned verification distinct from observed evidence and name any checks still unperformed. Reorder or split work when implementation evidence requires it, keeping acceptance IDs and user-visible scope stable. If a planned task becomes unnecessary or impossible, record why and revise the plan within the approved outcome; seek a decision only when the change crosses the boundaries above.

## Validation

Choose the smallest meaningful checks for changed behavior and the assurance level while respecting repository requirements:

- **Engineering:** changed logic, important failure modes, authorization, secret handling, and applicable data integrity/idempotency.
- **Integration:** normal user path with real dependencies; identify fixtures, bypasses, unavailable services, and untested environments.
- **Experience:** compare realistic content and primary interactions with the approved reference; inspect unknown/error states.
- **Owner acceptance:** record the user's response separately from automated success.

At level 1–2, always cover the main journey and applicable truthful-state, access, secret, and integrity risks. Do not add unrelated compatibility/load/concurrency suites merely because the level exists. For `mvp`, demonstrate one narrow real journey early. A prototype with fixtures cannot count as MVP integration.

Check a task only when its own scope and named validation pass. Keep milestone evidence distinct from whole-plan completion; do not claim the app is integrated until the complete normal path works. Do not weaken meaningful assertions or chase unrelated failures. Report unavailable checks honestly. Owner acceptance is recorded separately; it is not a reason to leave already authorized implementation and handoff tasks unfinished.

## Demonstration and handoff

When all authorized work is complete, refresh `project.md` with the implemented app brief, verified foundations, actual run/check commands, and current spec index. Provide a usable handoff so the user can access and try the app. Include only what applies: prerequisites, start/run command, URL or entry point, safe sample data/account setup (never disclose secrets), the main journey and important states to inspect, checks and environments actually exercised, limitations/unverified integrations, and how to stop/reset local data. Record owner acceptance as pending if the user has not tried it. Do not wait for a separate `complete` command to report completion and provide these instructions. Do not infer deployment or publication authority.

For read-only validation, report evidence without fixes or checkbox changes unless authorized. Completed coding tasks alone do not establish product completion.

## Orchestration

Use serial execution when work is dependent, changes shared contracts/files, includes schema or migration work, or needs an integration decision first. Parallelize only tasks that are independent in the plan and have clear, non-overlapping ownership and inputs. Use subagents only when the host supports them and delegation is within the approved scope; assign each a bounded task, files/modules, acceptance criteria, and required evidence. The parent coordinates dependencies, reviews results, resolves conflicts, integrates, and owns final validation and handoff. A child report is not completion evidence. If delegation is unavailable or adds coordination risk, execute serially without changing the approved outcome.
