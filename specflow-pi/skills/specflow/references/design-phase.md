# Design: make expectations visible

Use the confirmed outcome brief and project foundations. Interview about the experience and technical approach before settling the design; do not jump from an idea directly to architecture. For UI work, establish the user's entry point, primary action, navigation/context, important content, and relevant empty/loading/error/permission states. Ask about device, accessibility, language, and feedback needs when they affect use. Prepare a small representative screen or clickable prototype when a concrete reference will help resolve direction. For non-UI work, use a concrete API exchange, CLI session, or input/output example. Label provenance at the entry point and in the packet:

```text
Provenance: sample | simulated | live
```

Include realistic but minimal content, the primary action, and one important empty/error/unknown state. A prototype is an experience reference, not application code, live integration evidence, or permission to modify an example project. Optional references belong under `.specflow/specs/{feature}/artifacts/`; artifacts are never executable planning documents.

For technical design, match the design boundary to the requested delivery boundary. For a whole-app plan, establish enough across the agreed scope to judge feasibility and sequence work: system boundary, main data entities and ownership, major interfaces/integrations, access/privacy boundaries, dependencies, and consequential failure behavior. For a bounded slice, cover the slice and its interfaces to the rest of the system. If foundational technology remains undecided, offer a reasoned proposal and trade-offs for confirmation. Ask about performance, security, backup/recovery, compatibility, and operating constraints when the product context or data risk makes them material; do not invent targets to fill a section.

Keep low-level detail proportional: specify near-term or risky interfaces enough to implement safely; summarize stable or later details at the level needed to plan dependencies and integration, without speculative schemas or component contracts. Add diagrams, performance, security, or compatibility detail only when the scope's risk or coordination requires them.

Avoid projection tables, service abstractions, queues, websockets, configuration screens, multi-stage heuristics, and future-proofing without a current-slice need. A simpler rule that establishes the accepted behavior is preferred. Do not fabricate payloads, stack traces, or interaction states solely to make a prototype look complete.

Decide integration feasibility early. A polished fixture is not enough for an MVP that depends on an external service or generated content; identify the smallest real integration demonstration and its boundary.

Label decisions `Confirmed`, `Proposed`, `Assumed`, `Open`, or `Deferred`, and tie only key decisions to acceptance IDs. `Open` means an important choice is not understood enough to recommend; `Proposed` means a specific option is ready for user confirmation. Do not duplicate the full requirements document in a traceability table. Review the design against the primary journeys and important failure states across the agreed delivery scope. Keep out-of-scope future work as roadmap; do not demote agreed later milestones to roadmap merely because they follow the first increment.
