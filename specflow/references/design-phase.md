# Phase 2: Design

Use the approved requirements and current project context to create or update `design.md` in the active feature directory. Follow the [planning approval gate](../SKILL.md#core-contract).

Research the codebase and external dependencies as needed. Summarize findings with sources and links in the conversation; do not create separate research files. Record unresolved research limitations and their impact. Consult relevant completed specs through the dependency links in requirements.

## Grilling (Optional)

When requested, use the [grilling format](requirements-phase.md#grilling-optional) for architectural decisions that materially affect the design: data ownership and models, coupling, consistency, API contracts, and access boundaries. Capture confirmed choices and rationale in Design Decisions.

## Document Content

| Section | Required content |
|---------|------------------|
| Overview | Technical approach and how it meets requirements |
| Architecture | System context, component boundaries and interactions, Mermaid diagram |
| Design Decisions | Options considered, choice, rationale |
| Components and Interfaces | Responsibilities, dependencies, method signatures, parameters and return types |
| Data Models | Fields, types, constraints, relationships; diagram where useful |
| API Design (if applicable) | Methods, paths, requests, responses, error contracts |
| Error Handling | Error categories, user impact, recovery/retry/fallback behavior |
| Testing Strategy | Unit, integration, and E2E scenarios as applicable; component coverage and project testing standards |
| Security Considerations | Access controls, relevant threats, data privacy |
| Performance Considerations | Expected load, capacity, caching and query behavior as applicable |
| Requirements Traceability | Map every requirement to design components using the [requirement IDs](requirements-phase.md#document-content) |

Keep the design sufficient to implement and verify all requirements without prescribing unrelated layers or technologies. Present it with a summary of key decisions for review.
