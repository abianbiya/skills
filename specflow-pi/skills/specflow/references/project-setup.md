# Project context

Use `.specflow/project.md` for shared product purpose, users, platform and technical foundations, relevant conventions, actual run/check commands, important constraints, and a short index of specs. Start with a plain-language project brief so a reader can understand the app before its technical fields. Create or update it for actual project planning/implementation, not when merely evaluating the skill through an example.

For an existing project, inspect the repository and linked guidance first; record verified stack and workflow facts instead of asking the user to repeat them. Interview only about missing context that affects the requested work.

For a new application, conduct a project-foundation interview before requirements. Cover the relevant items below and classify each as `Confirmed`, `Proposed`, `Assumed`, `Open`, or `Deferred`:

- product purpose, first intended users, and where they will use it;
- target platform and client experience (web, mobile, desktop, CLI, API, or a combination);
- language, framework, runtime, and repository status;
- persistence needs, database or storage preference, and expected data ownership;
- identity, roles, tenancy, and important authorization boundaries;
- hosting/deployment environment and operational ownership;
- external services or integrations;
- material privacy, security, accessibility, localization, compatibility, cost, or connectivity constraints.

Do not force decisions that are irrelevant to the first release. If the user has no preference, offer a recommendation with its reason and trade-offs, label it `Proposed`, and leave it unconfirmed until accepted. Record unresolved but non-blocking choices as `Open` or `Deferred`; do not silently select a stack or architecture. Link existing repository guidance instead of copying it. Record run/check commands only after they can be verified.

Use [templates/project.md](../templates/project.md) for the standard section order and technical-foundations format, not as a demand to invent missing facts. Keep decision states distinct from inspected facts, and update the brief, run commands, and relevant foundations when implementation verifies or changes them. Keep the specs index current from each `tasks.md` lifecycle status; detailed approvals and evidence stay in the spec. Conflicting approved commitments need focused reconciliation. Add workflow preferences through [configuration](configuration.md) when chosen.
