import type {
  AuditConfig,
  AuditExport,
  AuditRequestRecord,
  EfficiencyWarning,
  SessionMetrics,
} from "./types.ts";

const number = (value: number): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const bytes = (value: number): string =>
  value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(2)} MiB`
    : value >= 1024
      ? `${(value / 1024).toFixed(1)} KiB`
      : `${value} B`;
const ms = (value: number): string => `${(value / 1000).toFixed(2)}s`;

export function buildExport(metrics: SessionMetrics): AuditExport {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    session: {
      sessionId: metrics.sessionId,
      userTurns: metrics.userTurns,
      requestCount: metrics.requestCount,
      toolCalls: metrics.toolCalls,
      compactions: metrics.compactions,
    },
    requests: metrics.requests.map((request) => {
      const usage = metrics.usages.get(request.requestSequence);
      return {
        requestSequence: request.requestSequence,
        userTurn: request.userTurn,
        ...(request.provider === undefined
          ? {}
          : { provider: request.provider }),
        ...(request.model === undefined ? {} : { model: request.model }),
        ...(request.api === undefined ? {} : { api: request.api }),
        analysis: request.analysis,
        contextAddedBytes: request.contextAddedBytes,
        followedCompaction: request.followedCompaction,
        cumulativeToolCalls: request.cumulativeToolCalls,
        ...(usage === undefined
          ? {}
          : { usage: usage.usage, timing: usage.timing }),
      };
    }),
  };
}

export function efficiencyWarnings(
  metrics: SessionMetrics,
): EfficiencyWarning[] {
  if (metrics.requests.length === 0) return [];
  const warnings: EfficiencyWarning[] = [];
  const first = metrics.requests[0];
  if (!first) return [];
  const latest = metrics.requests.at(-1) ?? first;
  const total = metrics.payloadBytes || 1;
  const averageTools =
    metrics.requests.reduce(
      (sum, request) => sum + request.analysis.sections.toolDefinitionBytes,
      0,
    ) / metrics.requests.length;
  const averageSystem =
    metrics.requests.reduce(
      (sum, request) =>
        sum +
        request.analysis.sections.systemBytes +
        request.analysis.sections.developerBytes,
      0,
    ) / metrics.requests.length;
  const historyGrowth =
    metrics.requests.length > 1
      ? metrics.requests.at(-1)!.analysis.payloadBytes -
        first.analysis.payloadBytes
      : 0;
  const toolResults = metrics.requests.reduce(
    (sum, request) => sum + request.analysis.sections.toolResultBytes,
    0,
  );
  const cacheRatio =
    metrics.inputTokens + metrics.cacheReadTokens > 0
      ? metrics.cacheReadTokens /
        (metrics.inputTokens + metrics.cacheReadTokens)
      : null;
  const callsPerTurn =
    metrics.userTurns > 0 ? metrics.requestCount / metrics.userTurns : 0;
  const outputRatio =
    metrics.inputTokens > 0 ? metrics.outputTokens / metrics.inputTokens : 0;

  if (averageTools > first.analysis.payloadBytes * 0.25)
    warnings.push({
      id: "tool-schema-overhead",
      message: "Tool schemas are a large fixed prompt cost.",
      evidence: `${bytes(averageTools)} per request; ${percent(averageTools / Math.max(first.analysis.payloadBytes, 1))} of first request.`,
    });
  const capturedTools = latest.analysis.tools ?? [];
  const calledTools = metrics.toolCallsByName ?? new Map<string, number>();
  const unusedTools = capturedTools.filter(
    (tool) => !calledTools.has(tool.name),
  );
  const unusedToolBytes = unusedTools.reduce(
    (sum, tool) => sum + tool.bytes,
    0,
  );
  if (
    unusedTools.length > 0 &&
    latest.analysis.sections.toolDefinitionBytes > 0 &&
    unusedToolBytes > latest.analysis.sections.toolDefinitionBytes * 0.25
  )
    warnings.push({
      id: "unused-tool-schemas",
      message:
        "Tool schemas that were never called this session still cost context.",
      evidence: `${unusedTools.length} of ${capturedTools.length} captured schemas (${bytes(unusedToolBytes)} per request): ${unusedTools
        .slice(0, 3)
        .map((tool) => tool.name)
        .join(", ")}${unusedTools.length > 3 ? ", …" : ""}.`,
    });
  if (averageSystem > first.analysis.payloadBytes * 0.35)
    warnings.push({
      id: "system-overhead",
      message: "System/developer instructions dominate fixed context.",
      evidence: `${bytes(averageSystem)} per request; inspect AGENTS.md, skills, and custom prompts.`,
    });
  if (historyGrowth > Math.max(first.analysis.payloadBytes * 0.5, 64 * 1024))
    warnings.push({
      id: "history-growth",
      message: "Conversation context grew substantially.",
      evidence: `First to latest request: +${bytes(historyGrowth)}.`,
    });
  if (toolResults > total * 0.2)
    warnings.push({
      id: "tool-results",
      message: "Tool results consume a significant share of request context.",
      evidence: `${bytes(toolResults)} across captured requests.`,
    });
  if (cacheRatio !== null && metrics.requestCount >= 3 && cacheRatio < 0.1)
    warnings.push({
      id: "low-cache-reuse",
      message: "Prompt-cache reuse appears low.",
      evidence: `${percent(cacheRatio)} cache-read/input-token ratio.`,
    });
  if (callsPerTurn > 3)
    warnings.push({
      id: "calls-per-turn",
      message: "Many LLM calls are required per user turn.",
      evidence: `${callsPerTurn.toFixed(1)} calls per user turn.`,
    });
  if (outputRatio > 0.75 && metrics.outputTokens > 4_000)
    warnings.push({
      id: "verbose-output",
      message: "Assistant output is unusually large relative to input.",
      evidence: `${number(metrics.outputTokens)} output tokens vs ${number(metrics.inputTokens)} input tokens.`,
    });
  if (
    metrics.compactions === 0 &&
    metrics.requests.length >= 8 &&
    historyGrowth > 256 * 1024
  )
    warnings.push({
      id: "late-compaction",
      message: "Large context growth occurred without compaction.",
      evidence: `${bytes(historyGrowth)} growth across ${metrics.requests.length} requests.`,
    });
  return warnings;
}

export function sessionStatus(metrics: SessionMetrics): string {
  const latest = metrics.requests.at(-1);
  const avgDuration = metrics.requestDurationCount
    ? metrics.requestDurationMs / metrics.requestDurationCount
    : 0;
  const system = latest
    ? latest.analysis.sections.systemBytes +
      latest.analysis.sections.developerBytes
    : 0;
  const overhead = latest
    ? system +
      latest.analysis.sections.toolDefinitionBytes +
      latest.analysis.sections.toolResultBytes
    : 0;
  return [
    `requests ${metrics.requestCount}`,
    `input ${number(metrics.inputTokens)}`,
    `output ${number(metrics.outputTokens)}`,
    `cached ${number(metrics.cacheReadTokens)}`,
    `payload ${bytes(metrics.payloadBytes)}`,
    `context ${latest ? bytes(latest.analysis.payloadBytes) : "n/a"}`,
    `avg ${ms(avgDuration)}`,
    `calls/turn ${metrics.userTurns ? (metrics.requestCount / metrics.userTurns).toFixed(1) : "n/a"}`,
    `overhead ${latest ? percent(overhead / Math.max(latest.analysis.payloadBytes, 1)) : "n/a"}`,
  ].join(" | ");
}

export function lastRequestSummary(
  request: AuditRequestRecord,
  metrics: SessionMetrics,
): string {
  const usage = metrics.usages.get(request.requestSequence);
  const sections = request.analysis.sections;
  return [
    `LLM #${request.requestSequence} ${request.provider ?? "unknown"}/${request.model ?? "unknown"}`,
    `${bytes(request.analysis.payloadBytes)} (~${number(request.analysis.approximateTokens)} rough tokens)`,
    `system ${bytes(sections.systemBytes + sections.developerBytes)}`,
    `tools ${bytes(sections.toolDefinitionBytes)}`,
    `history ${bytes(sections.userBytes + sections.assistantBytes)}`,
    `tool results ${bytes(sections.toolResultBytes)}`,
    usage?.usage.inputTokens !== undefined
      ? `actual input ${number(usage.usage.inputTokens ?? 0)}`
      : "actual input unavailable",
    usage?.timing.totalRequestMs
      ? ms(usage.timing.totalRequestMs)
      : "duration pending",
  ].join(" | ");
}

/**
 * Compact summary for the status line, which shares one line with every other
 * extension. Footers are narrower than they look, and some (pi-powerline-footer,
 * via its secondary-row layout) *drop* a segment that does not fit instead of
 * truncating it — so an oversized status does not degrade, it disappears. Hence
 * three facts and nothing more.
 */
export function compactRequestSummary(
  request: AuditRequestRecord,
  metrics: SessionMetrics,
): string {
  const parts = [
    `${number(metrics.requestCount)} req`,
    bytes(request.analysis.payloadBytes),
  ];
  const usage = metrics.usages.get(request.requestSequence);
  const input = usage?.usage.inputTokens ?? 0;
  const cacheRead = usage?.usage.cacheReadTokens ?? 0;
  if (input + cacheRead > 0)
    parts.push(`${Math.round((cacheRead / (input + cacheRead)) * 100)}% cached`);
  return parts.join(" · ");
}

/**
 * Status-line content: the audit state first, so the active mode is visible
 * before a request completes, then a compact summary of the last request. The
 * full breakdown stays in `/llm-audit status`, `/llm-audit last` and the report.
 *
 * A non-metrics mode with content capture off is called out explicitly — that is
 * the state where someone expects prompts to be recorded and they are not.
 */
export function statusLineLabel(
  config: AuditConfig,
  metrics: SessionMetrics,
): string {
  const state = !config.enabled
    ? "llm-audit off"
    : config.mode === "metrics"
      ? "llm-audit metrics"
      : config.capturePayload
        ? `llm-audit ${config.mode}`
        : `llm-audit ${config.mode} (capture off)`;
  const latest = config.showTurnSummary ? metrics.requests.at(-1) : undefined;
  return latest ? `${state} | ${compactRequestSummary(latest, metrics)}` : state;
}

export function markdownReport(metrics: SessionMetrics): string {
  const latest = metrics.requests.at(-1);
  const averagePayload = metrics.requestCount
    ? metrics.payloadBytes / metrics.requestCount
    : 0;
  const maxRequest = Math.max(
    0,
    ...metrics.requests.map((request) => request.analysis.payloadBytes),
  );
  const cacheRatio =
    metrics.inputTokens + metrics.cacheReadTokens > 0
      ? metrics.cacheReadTokens /
        (metrics.inputTokens + metrics.cacheReadTokens)
      : null;
  const avgRequest = metrics.requestDurationCount
    ? metrics.requestDurationMs / metrics.requestDurationCount
    : 0;
  const avgTurn = metrics.turnDurationCount
    ? metrics.turnDurationMs / metrics.turnDurationCount
    : 0;
  const warnings = efficiencyWarnings(metrics);
  const sectionRows = latest
    ? Object.entries(latest.analysis.sections)
        .map(
          ([name, value]) =>
            `| ${name} | ${bytes(value)} | ${percent(value / Math.max(latest.analysis.payloadBytes, 1))} |`,
        )
        .join("\n")
    : "| n/a | n/a | n/a |";
  const growthRows =
    metrics.requests
      .map(
        (request) =>
          `| ${request.requestSequence} | ${request.userTurn} | ${bytes(request.analysis.payloadBytes)} | ${request.analysis.approximateTokens} | ${request.followedCompaction ? "yes" : "no"} |`,
      )
      .join("\n") || "| n/a | n/a | n/a | n/a | n/a |";
  const components =
    latest?.analysis.largestComponents
      .map((item) => `| ${item.path} | ${item.kind} | ${bytes(item.bytes)} |`)
      .join("\n") ?? "| n/a | n/a | n/a |";
  const toolRows =
    latest?.analysis.tools
      .map(
        (tool) =>
          `| ${tool.name} | ${bytes(tool.bytes)} | ${metrics.toolCallsByName?.get(tool.name) ?? 0} |`,
      )
      .join("\n") || "| n/a | n/a | n/a |";
  const compactionRows =
    metrics.requests
      .map((request, index) => ({
        request,
        prior: metrics.requests[index - 1],
      }))
      .filter(
        ({ request, prior }) =>
          request.followedCompaction && prior !== undefined,
      )
      .map(
        ({ request, prior }) =>
          `| ${request.requestSequence} | ${bytes(prior!.analysis.payloadBytes)} | ${bytes(request.analysis.payloadBytes)} | ${bytes(request.analysis.payloadBytes - prior!.analysis.payloadBytes)} |`,
      )
      .join("\n") || "| n/a | n/a | n/a | n/a |";
  return `# LLM audit report\n\n## Session overview\n\n- Session: \`${metrics.sessionId}\`\n- User prompts: ${metrics.userTurns}\n- LLM requests: ${metrics.requestCount}\n- Tool calls: ${metrics.toolCalls}\n- Compactions: ${metrics.compactions}\n- Models: ${[...new Set(metrics.requests.map((request) => `${request.provider ?? "unknown"}/${request.model ?? "unknown"}`))].join(", ") || "none"}\n\n## Usage and timing\n\n| Metric | Value |\n| --- | ---: |\n| Actual input tokens | ${number(metrics.inputTokens)} |\n| Actual output tokens | ${number(metrics.outputTokens)} |\n| Cache-read tokens | ${number(metrics.cacheReadTokens)} |\n| Cache-write tokens | ${number(metrics.cacheWriteTokens)} |\n| Cache-read ratio | ${cacheRatio === null ? "unavailable" : percent(cacheRatio)} |\n| Total cost | $${metrics.totalCost.toFixed(6)} |\n| Calls per user turn | ${metrics.userTurns ? (metrics.requestCount / metrics.userTurns).toFixed(2) : "n/a"} |\n| Average request duration | ${ms(avgRequest)} |\n| Average turn duration | ${ms(avgTurn)} |\n\n## Context growth\n\n| Request | User turn | Payload | Rough tokens | After compaction |\n| ---: | ---: | ---: | ---: | --- |\n${growthRows}\n\nAverage payload: ${bytes(averagePayload)}. Maximum payload: ${bytes(maxRequest)}.\n\n## Latest request overhead\n\n| Section | Bytes | Payload share |\n| --- | ---: | ---: |\n${sectionRows}\n\n## Largest latest components\n\n| Path | Classification | Bytes |\n| --- | --- | ---: |\n${components}\n\n## Tool schema cost\n\n| Tool | Bytes | Calls |\n| --- | ---: | ---: |\n${toolRows}\n\n## Compaction effects\n\n| First request after compaction | Prior payload | Next payload | Change |\n| ---: | ---: | ---: | ---: |\n${compactionRows}\n\n## Heuristic efficiency findings\n\n${warnings.length ? warnings.map((warning) => `- **${warning.message}** ${warning.evidence}`).join("\n") : "- No measured heuristic warning triggered."}\n\n> Heuristics are measured indicators, not proof of inefficiency. Usage/cost fields are included only when Pi exposes them; rough token estimates are explicitly not provider tokenizer counts.\n`;
}

/**
 * Per-tool schema cost for the latest request, plus observed call counts. This is
 * the actionable half of the `tool-schema-overhead` heuristic: which tool, and
 * whether it was ever used in this session.
 */
export function toolSchemaSummary(metrics: SessionMetrics): string {
  const latest = metrics.requests.at(-1);
  const tools = latest?.analysis.tools ?? [];
  if (tools.length === 0)
    return "No tool schemas captured in the latest request.";
  const called = metrics.toolCallsByName ?? new Map<string, number>();
  return [
    `tool schema cost (latest request, ${bytes(latest?.analysis.sections.toolDefinitionBytes ?? 0)} total):`,
    ...tools.map(
      (tool) =>
        `  ${tool.name} | ${bytes(tool.bytes)} | ${called.get(tool.name) ?? 0} calls${called.has(tool.name) ? "" : " (never called)"}`,
    ),
  ].join("\n");
}

export interface ExportSummary {
  sessionId: string;
  requests: number;
  userTurns: number;
  callsPerTurn: number | null;
  firstFixedBytes: number;
  toolSchemaBytes: number;
  historyGrowthBytes: number;
  inputTokens: number;
  outputTokens: number;
  cacheRatio: number | null;
  latencyMs: number;
  cost: number;
}

export function summarizeExport(exported: AuditExport): ExportSummary {
  const requests = exported.requests;
  const sum = (
    pick: (
      request: AuditExport["requests"][number],
    ) => number | null | undefined,
  ): number =>
    requests.reduce((total, request) => total + (pick(request) ?? 0), 0);
  const first = requests[0]?.analysis.sections;
  const inputTokens = sum((request) => request.usage?.inputTokens);
  const cacheReadTokens = sum((request) => request.usage?.cacheReadTokens);
  const userTurns = exported.session.userTurns;
  const firstPayload = requests[0]?.analysis.payloadBytes ?? 0;
  const lastPayload = requests.at(-1)?.analysis.payloadBytes ?? 0;
  return {
    sessionId: exported.session.sessionId,
    requests: requests.length,
    userTurns,
    callsPerTurn: userTurns > 0 ? requests.length / userTurns : null,
    firstFixedBytes:
      (first?.systemBytes ?? 0) +
      (first?.developerBytes ?? 0) +
      (first?.toolDefinitionBytes ?? 0),
    toolSchemaBytes: sum(
      (request) => request.analysis.sections.toolDefinitionBytes,
    ),
    historyGrowthBytes: requests.length > 1 ? lastPayload - firstPayload : 0,
    inputTokens,
    outputTokens: sum((request) => request.usage?.outputTokens),
    cacheRatio:
      inputTokens + cacheReadTokens > 0
        ? cacheReadTokens / (inputTokens + cacheReadTokens)
        : null,
    latencyMs: sum((request) => request.timing?.totalRequestMs),
    cost: sum((request) => request.usage?.totalCost),
  };
}

export interface ComparisonRow {
  label: string;
  baseline: number;
  candidate: number;
  delta: number;
}

/** Pairwise comparison of two exports; delta is candidate - baseline. */
export function compareSummaries(
  baseline: ExportSummary,
  candidate: ExportSummary,
): ComparisonRow[] {
  const row = (
    label: string,
    from: number | null,
    to: number | null,
  ): ComparisonRow => ({
    label,
    baseline: from ?? 0,
    candidate: to ?? 0,
    delta: (to ?? 0) - (from ?? 0),
  });
  return [
    row("requests", baseline.requests, candidate.requests),
    row("calls/turn", baseline.callsPerTurn, candidate.callsPerTurn),
    row(
      "first fixed bytes",
      baseline.firstFixedBytes,
      candidate.firstFixedBytes,
    ),
    row(
      "tool schema bytes",
      baseline.toolSchemaBytes,
      candidate.toolSchemaBytes,
    ),
    row(
      "history growth bytes",
      baseline.historyGrowthBytes,
      candidate.historyGrowthBytes,
    ),
    row("input tokens", baseline.inputTokens, candidate.inputTokens),
    row("output tokens", baseline.outputTokens, candidate.outputTokens),
    row("cache ratio", baseline.cacheRatio, candidate.cacheRatio),
    row("latency ms", baseline.latencyMs, candidate.latencyMs),
    row("cost", baseline.cost, candidate.cost),
  ];
}

export function formatComparison(
  baseline: ExportSummary,
  candidate: ExportSummary,
): string {
  return [
    `baseline ${baseline.sessionId} -> candidate ${candidate.sessionId}`,
    ...compareSummaries(baseline, candidate).map(
      (row) =>
        `${row.label}: ${number(row.baseline)} -> ${number(row.candidate)} (${row.delta > 0 ? "+" : ""}${number(row.delta)})`,
    ),
    "delta is candidate - baseline, so negative is cheaper. Keep task, model, thinking level, and prompt controlled.",
  ].join("\n");
}
