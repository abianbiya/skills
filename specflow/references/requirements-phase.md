# Requirements: interview for outcomes and behavior

For a greenfield app, interview after the project-foundation round. Ask in small, coherent groups and follow the user's answers; do not present one giant questionnaire. Cover the areas below to the extent they affect the intended first release. Pause between groups to summarize what is confirmed, what remains uncertain, and what you recommend next. There is no fixed question limit for new-app discovery. Do not repeat project-foundation questions already resolved in `project.md`.

- user roles, context, trigger, problem, current workaround, and desired change;
- the main journey from entry to successful outcome, with a concrete example;
- business rules, important states and transitions, permissions, and user-visible decisions;
- alternate paths and relevant empty, loading, unavailable, stale, invalid, or error states;
- information the user provides, sees, changes, retains, exports, or deletes;
- accessibility, language, privacy, safety, and compatibility needs that affect the experience;
- what makes the first release useful, what is explicitly excluded, and what could change that boundary.

For an existing feature, use repository evidence and narrow the interview to uncertainty that affects its scope, outcome, cost, risk, or acceptance. Users may skip a topic; record a material unknown instead of blocking on a low-impact detail.

## Turn behavior into reviewable requirements

First capture the user's examples in plain language. For a new app, use EARS as the default notation for confirmed, externally observable functional behavior and material business rules. Make at least one EARS pass over each primary journey and important rule group. Keep product purpose, rationale, design choices, and constraints in plain language when EARS would obscure them. For existing-project changes, use EARS for behavior that benefits from precise conditions and responses.

- **Event:** `WHEN {trigger}, THE SYSTEM SHALL {observable response}.`
- **State:** `WHILE {condition}, THE SYSTEM SHALL {observable response}.`
- **Unwanted condition:** `IF {condition}, THEN THE SYSTEM SHALL {safe response}.`
- **Optional feature:** `WHERE {feature is enabled}, THE SYSTEM SHALL {response}.`
- **Always applicable:** `THE SYSTEM SHALL {invariant}.`

For each important journey or rule, ask what starts it, who is acting, what state or permissions apply, what the user or another system should observe, and what should happen for a relevant invalid, missing, denied, or unavailable case. Ask about the data change only when it affects the user's result, privacy, or integrity. Convert the answers into one or more concise EARS criteria; ask a follow-up if trigger, condition, actor/permission, expected response, or important exception remains ambiguous. EARS is not a mandate to turn every preference, design detail, or implementation step into a requirement. Keep goals and rationale readable; use stable IDs such as `AC1` for observable acceptance examples. Do not equate each requirement with a separate test.

Write `requirements.md` so an implementer and reviewer can understand the app without repeating the interview. Keep it concise, but do not omit a relevant answer merely to meet a length target:

- user, problem, and observable outcome;
- main journey with a concrete success example;
- important failure, empty, or unknown state;
- first-release inclusions and explicit deferrals;
- acceptance criteria covering the primary journeys and material behavior/rules, without splitting them into implementation-sized fragments;
- constraints, assumptions, proposed decisions, and decisions still needed.

Use plain language. Tasks cite stable acceptance IDs with `Criteria:`. Include positive and negative examples when both matter to the outcome.

Label decisions `Confirmed`, `Proposed`, `Assumed`, `Open`, or `Deferred`. Product thresholds and time windows must be proposed or confirmed explicitly. Do not invent arbitrary latency, coverage, or quality targets.

For `evaluation`, keep the brief in the discussion or task-owned output. Do not create an executable plan in an example application, and do not treat prototype approval as implementation authority.

Review requirements together with the experience/design direction and the executable plan for the agreed delivery scope by default. Separate requirements/design/tasks approval gates apply only when requested or already established.
