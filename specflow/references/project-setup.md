# Project Setup

`.specflow/project.md` holds shared tech stack, conventions, and patterns. Use it when creating or updating specs; retain unchanged context during the session. Execution loading and refresh rules are defined in [Phase 4](execution-phase.md#session-context).

If missing, create it before the first spec using [templates/project.md](../templates/project.md). Inspect available project information and ask the user for missing stack or convention details needed to fill it out.

The template is the canonical starting point. Add project-specific package-manager and lint/format tooling, actual test/lint/type-check/dev-server commands where applicable, directory layout, and integration notes when available; these operational details supplement its existing sections.

Update project context when the stack, conventions, or major directory structure changes. Current project context takes precedence over conflicting completed-spec conventions; resolve conflicts with active approved specs through their planning gates.
