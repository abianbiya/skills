import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { analyzePayload, asJsonObject, normalizeUsage } from "./analyzer.ts";
import { loadConfig, saveConfig } from "./config.ts";
import { registerCommands, type AuditController } from "./commands.ts";
import { AuditLogger } from "./logger.ts";
import { redactHeaders, redactValue, safeJsonBytes } from "./redaction.ts";
import {
  buildExport,
  lastRequestSummary,
  markdownReport,
  statusLineLabel,
} from "./reporter.ts";
import { registerAuditTool } from "./tools.ts";
import {
  SCHEMA_VERSION,
  type AuditConfig,
  type AuditMode,
  type AuditRequestRecord,
  type ProviderResponseRecord,
  type SessionMetrics,
  type SessionRecord,
  type ToolCallRecord,
  type UsageRecord,
} from "./types.ts";

const execFileAsync = promisify(execFile);

interface PendingRequest {
  record: AuditRequestRecord;
  startedAt: number;
  responseAt?: number;
  firstStreamAt?: number;
}

interface ToolStart {
  startedAt: number;
  toolName: string;
  inputBytes: number;
}

interface GitInfo {
  root?: string;
  branch?: string;
}

const now = (): string => new Date().toISOString();
const clock = (): number => performance.now();
const uuid = (): string => crypto.randomUUID();
const bytes = (value: string): number => Buffer.byteLength(value, "utf8");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function gitInfo(cwd: string): Promise<GitInfo> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"],
      { timeout: 1_000 },
    );
    const [root, branch] = stdout.trim().split(/\r?\n/);
    return {
      ...(root ? { root } : {}),
      ...(branch && branch !== "HEAD" ? { branch } : {}),
    };
  } catch {
    return {};
  }
}

function sessionId(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

function modelMetadata(model: unknown): {
  provider?: string;
  model?: string;
  api?: string;
} {
  if (!isRecord(model)) return {};
  return {
    ...(typeof model.provider === "string" ? { provider: model.provider } : {}),
    ...(typeof model.id === "string" ? { model: model.id } : {}),
    ...(typeof model.api === "string" ? { api: model.api } : {}),
  };
}

function messageUsage(message: unknown): unknown {
  return isRecord(message) && message.role === "assistant"
    ? message.usage
    : undefined;
}

function sessionMetrics(id: string): SessionMetrics {
  return {
    sessionId: id,
    startedAt: Date.now(),
    requestCount: 0,
    userTurns: 0,
    toolCalls: 0,
    payloadBytes: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
    requestDurationMs: 0,
    requestDurationCount: 0,
    turnDurationMs: 0,
    turnDurationCount: 0,
    compactions: 0,
    requests: [],
    usages: new Map(),
    toolDurations: [],
    toolCallsByName: new Map(),
  };
}

export default function llmAudit(pi: ExtensionAPI): void {
  const loaded = loadConfig();
  let config: AuditConfig = loaded.config;
  let enabled = config.enabled;
  let logger: AuditLogger | undefined;
  let metrics = sessionMetrics("pending");
  let git: GitInfo = {};
  let userPromptBytes = 0;
  let followedCompaction = false;
  let pending: PendingRequest[] = [];
  let pendingHeaders: Record<string, string>[] = [];
  const toolStarts = new Map<string, ToolStart>();
  const turnStarts = new Map<number, number>();

  const write = (
    record:
      | SessionRecord
      | AuditRequestRecord
      | ProviderResponseRecord
      | UsageRecord
      | ToolCallRecord,
  ): void => logger?.write(record);
  const active = (provider?: string, model?: string): boolean =>
    enabled &&
    !config.excludeProviders.includes(provider ?? "") &&
    !config.excludeModels.includes(model ?? "");
  const sessionRecord = (
    recordType: SessionRecord["recordType"],
    fields: Record<string, string | number | boolean | undefined> = {},
  ): SessionRecord => ({
    schemaVersion: SCHEMA_VERSION,
    recordType,
    timestamp: now(),
    sessionId: metrics.sessionId,
    ...fields,
  });

  const controller: AuditController = {
    getMetrics: () => metrics,
    // `enabled` is the live session flag, which can differ from what the config
    // file said at load time (e.g. after /llm-audit on).
    getConfig: () => ({ ...config, enabled }),
    patchConfig: (patch) => {
      config = { ...config, ...patch };
      if (patch.enabled !== undefined) enabled = patch.enabled;
    },
    saveConfig: () => saveConfig({ ...config, enabled }),
    getLogPath: () => logger?.filePath ?? "not initialized",
    getLogDirectory: () => config.logDirectory,
    getSessionId: () => metrics.sessionId,
    // Called after any command so a mode/state change is visible in the footer
    // immediately, instead of only after the next completed turn.
    refreshStatus: (ctx) => {
      if (ctx.mode !== "tui") return;
      ctx.ui.setStatus(
        "llm-audit",
        config.showStatus
          ? statusLineLabel({ ...config, enabled }, metrics)
          : undefined,
      );
    },
    clean: async () => (logger ? logger.cleanExpired() : 0),
  };
  registerCommands(pi, controller);
  registerAuditTool(pi, controller);

  pi.on("session_start", (event, ctx) => {
    metrics = sessionMetrics(sessionId(ctx));
    logger = new AuditLogger(config, metrics.sessionId);
    pending = [];
    pendingHeaders = [];
    git = {};
    void gitInfo(ctx.cwd).then((info) => {
      git = info;
    });
    write(
      sessionRecord("session_start", {
        cwd: ctx.cwd,
        reason: event.reason,
        previousSessionFile: event.previousSessionFile,
        mode: config.mode,
        configError: loaded.error,
      }),
    );
    controller.refreshStatus(ctx);
  });

  pi.on("session_before_switch", (event) => {
    write(
      sessionRecord("session_event", { event: "switch", reason: event.reason }),
    );
  });
  pi.on("session_before_fork", (event) => {
    write(
      sessionRecord("session_event", {
        event: "fork",
        position: event.position,
      }),
    );
  });
  pi.on("session_tree", (event) => {
    write(
      sessionRecord("session_event", {
        event: "tree",
        newLeafId: event.newLeafId ?? undefined,
        oldLeafId: event.oldLeafId ?? undefined,
      }),
    );
  });

  pi.on("before_agent_start", (event) => {
    metrics.userTurns++;
    userPromptBytes = bytes(event.prompt);
  });
  pi.on("turn_start", (event) => {
    turnStarts.set(event.turnIndex, clock());
  });
  pi.on("turn_end", (event, ctx) => {
    const startedAt = turnStarts.get(event.turnIndex);
    if (startedAt !== undefined) {
      metrics.turnDurationMs += clock() - startedAt;
      metrics.turnDurationCount++;
      turnStarts.delete(event.turnIndex);
    }
    if (config.showStatus && ctx.mode === "tui")
      ctx.ui.setStatus(
        "llm-audit",
        statusLineLabel({ ...config, enabled }, metrics),
      );
  });

  pi.on("before_provider_headers", (event) => {
    if (!enabled || !config.captureHeaders || config.mode === "metrics") return;
    pendingHeaders.push(
      redactHeaders(event.headers as Record<string, unknown>, config) as Record<
        string,
        string
      >,
    );
  });

  pi.on("before_provider_request", (event, ctx) => {
    const meta = modelMetadata(ctx.model);
    if (!active(meta.provider, meta.model)) return;
    try {
      const analysis = analyzePayload(event.payload, config);
      const capture = config.capturePayload && config.mode !== "metrics";
      const stored = capture
        ? redactValue(event.payload, config, true)
        : undefined;
      const headers =
        config.captureHeaders && config.mode !== "metrics"
          ? pendingHeaders.shift()
          : undefined;
      const request: AuditRequestRecord = {
        schemaVersion: SCHEMA_VERSION,
        recordType: "llm_request",
        timestamp: now(),
        auditRecordId: uuid(),
        sessionId: metrics.sessionId,
        requestSequence: ++metrics.requestCount,
        userTurn: metrics.userTurns,
        ...meta,
        thinkingLevel: pi.getThinkingLevel(),
        cwd: ctx.cwd,
        ...(git.root ? { gitRoot: git.root } : {}),
        ...(git.branch ? { gitBranch: git.branch } : {}),
        analysis,
        contextAddedBytes: userPromptBytes
          ? Math.max(0, analysis.payloadBytes - userPromptBytes)
          : null,
        followedCompaction,
        cumulativeToolCalls: metrics.toolCalls,
        ...(headers === undefined ? {} : { headers }),
        ...(stored ? { payload: stored.value } : {}),
        payloadStored: Boolean(stored),
      };
      followedCompaction = false;
      metrics.requests.push(request);
      metrics.payloadBytes += analysis.payloadBytes;
      pending.push({ record: request, startedAt: clock() });
      write(request);
    } catch (error) {
      write(
        sessionRecord("audit_error", {
          stage: "before_provider_request",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  pi.on("after_provider_response", (event) => {
    const request = pending.find((item) => item.responseAt === undefined);
    if (!request) return;
    request.responseAt = clock();
    const response: ProviderResponseRecord = {
      schemaVersion: SCHEMA_VERSION,
      recordType: "provider_response",
      timestamp: now(),
      auditRecordId: request.record.auditRecordId,
      sessionId: metrics.sessionId,
      requestSequence: request.record.requestSequence,
      status: event.status,
      responseHeadersMs: request.responseAt - request.startedAt,
      ...(config.captureHeaders && config.mode !== "metrics"
        ? { headers: redactHeaders(event.headers, config) }
        : {}),
    };
    write(response);
  });

  pi.on("message_update", () => {
    const request = pending.find((item) => item.firstStreamAt === undefined);
    if (request) request.firstStreamAt = clock();
  });

  pi.on("message_end", (event) => {
    const rawUsage = messageUsage(event.message);
    if (rawUsage === undefined) return;
    const request = pending.shift();
    if (!request) return;
    const endedAt = clock();
    const usage = normalizeUsage(rawUsage);
    metrics.inputTokens += usage.inputTokens ?? 0;
    metrics.outputTokens += usage.outputTokens ?? 0;
    metrics.cacheReadTokens += usage.cacheReadTokens ?? 0;
    metrics.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    metrics.totalCost += usage.totalCost ?? 0;
    const timing = {
      ...(request.responseAt === undefined
        ? {}
        : { responseHeadersMs: request.responseAt - request.startedAt }),
      ...(request.firstStreamAt === undefined
        ? {}
        : { firstStreamEventMs: request.firstStreamAt - request.startedAt }),
      generationMs:
        request.firstStreamAt === undefined
          ? endedAt - request.startedAt
          : endedAt - request.firstStreamAt,
      totalRequestMs: endedAt - request.startedAt,
    };
    metrics.requestDurationMs += timing.totalRequestMs;
    metrics.requestDurationCount++;
    const record: UsageRecord = {
      schemaVersion: SCHEMA_VERSION,
      recordType: "llm_usage",
      timestamp: now(),
      auditRecordId: request.record.auditRecordId,
      sessionId: metrics.sessionId,
      requestSequence: request.record.requestSequence,
      usage,
      timing,
      ...(config.mode === "full" && config.capturePayload
        ? { rawUsage: redactValue(rawUsage, config, true).value }
        : {}),
    };
    metrics.usages.set(record.requestSequence, record);
    write(record);
  });

  pi.on("tool_execution_start", (event) => {
    if (!enabled) return;
    metrics.toolCalls++;
    metrics.toolCallsByName.set(
      event.toolName,
      (metrics.toolCallsByName.get(event.toolName) ?? 0) + 1,
    );
    const inputBytes = safeJsonBytes(event.args, config).bytes;
    toolStarts.set(event.toolCallId, {
      startedAt: clock(),
      toolName: event.toolName,
      inputBytes,
    });
    write({
      schemaVersion: SCHEMA_VERSION,
      recordType: "tool_call",
      timestamp: now(),
      sessionId: metrics.sessionId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      userTurn: metrics.userTurns,
      inputBytes,
    });
  });
  pi.on("tool_result", (event) => {
    const start = toolStarts.get(event.toolCallId);
    const durationMs = start ? clock() - start.startedAt : undefined;
    if (durationMs !== undefined) metrics.toolDurations.push(durationMs);
    const outputBytes = safeJsonBytes(event.content, config).bytes;
    write({
      schemaVersion: SCHEMA_VERSION,
      recordType: "tool_result",
      timestamp: now(),
      sessionId: metrics.sessionId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      userTurn: metrics.userTurns,
      ...(durationMs === undefined ? {} : { durationMs }),
      isError: event.isError,
      outputBytes,
    });
    toolStarts.delete(event.toolCallId);
  });

  pi.on("session_compact", (event) => {
    metrics.compactions++;
    followedCompaction = true;
    write(
      sessionRecord("compaction", {
        reason: event.reason,
        willRetry: event.willRetry,
        fromExtension: event.fromExtension,
      }),
    );
  });
  pi.on("session_shutdown", async (event, ctx) => {
    write(
      sessionRecord("session_summary", {
        reason: event.reason,
        requests: metrics.requestCount,
        userTurns: metrics.userTurns,
        toolCalls: metrics.toolCalls,
        payloadBytes: metrics.payloadBytes,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        cacheReadTokens: metrics.cacheReadTokens,
        cacheWriteTokens: metrics.cacheWriteTokens,
        totalCost: metrics.totalCost,
        durationMs: Date.now() - metrics.startedAt,
      }),
    );
    if (ctx.mode === "tui") ctx.ui.setStatus("llm-audit", undefined);
    await logger?.flush();
  });
}

export { buildExport };
