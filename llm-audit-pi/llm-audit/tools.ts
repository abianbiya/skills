import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AuditController } from "./commands.ts";
import { sessionStatus, toolSchemaSummary } from "./reporter.ts";

/**
 * Read-only, agent-facing view of measured context cost.
 *
 * The extension's writing surface stays in the JSONL logger; this tool only
 * formats numbers that were already measured, so the agent can answer "why is
 * this session expensive?" without shelling out to jq against raw logs.
 *
 * Parameters are intentionally empty: a schema with no arguments costs less
 * context on every request, which is the very thing this extension measures.
 */
export function registerAuditTool(
  pi: ExtensionAPI,
  controller: AuditController,
): void {
  pi.registerTool({
    name: "llm_audit_context",
    label: "LLM Context Audit",
    description:
      "Report measured LLM context cost for this session: payload sizes, real token usage, cache ratio, and per-tool schema cost with call counts.",
    promptSnippet:
      "Inspect measured LLM context and token cost for the current session",
    promptGuidelines: [
      "Use llm_audit_context when the user asks why a session is expensive or large, or which tool schemas cost the most context.",
    ],
    parameters: Type.Object({}),
    async execute() {
      const metrics = controller.getMetrics();
      const config = controller.getConfig();
      return {
        content: [
          {
            type: "text" as const,
            text: `${sessionStatus(metrics)}\n${toolSchemaSummary(metrics)}`,
          },
        ],
        details: {
          auditEnabled: config.enabled,
          mode: config.mode,
          requests: metrics.requestCount,
          payloadBytes: metrics.payloadBytes,
        },
      };
    },
  });
}
