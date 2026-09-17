import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  SCHEMA_VERSION,
  type AuditRequestRecord,
  type NormalizedUsage,
  type SessionMetrics,
  type UsageRecord,
} from "./types.ts";

/**
 * Reads an audit JSONL back into an analysable shape.
 *
 * Two reasons this reads the log instead of using in-session metrics:
 *  - it works for sessions that already happened (this extension has produced
 *    logs of 100+ MiB), which the in-memory metrics cannot do;
 *  - every request re-sends its whole conversation prefix, so identical messages
 *    are deduped by content hash here. Measured on a real 117 MiB log: 41,896
 *    message instances were only 413 unique messages (99.0% re-sends). Deduping
 *    is what keeps a report openable and makes per-request deltas cheap.
 *
 * The reader streams line by line and applies hard caps, so a huge log cannot
 * exhaust memory.
 */

export const DEFAULT_LIMITS = {
  /** Refuse to read logs beyond this size. */
  maxLogBytes: 512 * 1024 * 1024,
  /** Stop indexing new unique messages past this count. */
  maxUniqueMessages: 20_000,
  /**
   * Per-message ceiling when bodies are embedded. Deliberately far above real
   * content: measured full bodies on a real corpus were 1.1 MiB escaped for 503
   * messages (1.14x escaping inflation), with a single 1 MiB outlier. A 64 KiB
   * cut here would only hide content users asked to see.
   */
  maxMessageBytes: 2 * 1024 * 1024,
  /** Total embedded body budget; past this, bodies are flagged, not embedded. */
  maxTotalBodyBytes: 64 * 1024 * 1024,
  /** Characters kept in a preview line. */
  maxPreviewChars: 240,
};

export interface StoredMessage {
  hash: string;
  role: string;
  bytes: number;
  preview: string;
  /** Bounded body text; only meaningful when the caller asked to embed bodies. */
  text: string;
  /**
   * Set when the embedded body is not the whole message: `limit` when the
   * per-message ceiling cut it, `budget` when the total body budget was already
   * spent. Absent means the body is complete.
   */
  omitReason?: "limit" | "budget";
  /** How many requests carried this content. */
  sends: number;
  /**
   * Most times this exact content appeared inside a single request. >1 means the
   * same bytes were genuinely occupying context twice at once — the only
   * unambiguous duplication. Counted per request on purpose: an earlier version
   * derived "added" from the longest common prefix with the previous request,
   * which reported 1.8 MiB of "waste" on a real log that was entirely a
   * prompt-change/compaction artifact (0 genuine duplicates).
   */
  duplicateInstances: number;
}

export interface LogRequest {
  /** The original record, minus the captured payload (kept out of memory). */
  record: AuditRequestRecord;
  payloadStored: boolean;
  /** Ordered content hashes of this request's conversation, when captured. */
  messageHashes?: string[];
  usage?: NormalizedUsage;
  timing?: Record<string, number | null | undefined>;
}

export interface ToolResultEntry {
  toolName: string;
  outputBytes: number;
  isError: boolean;
  durationMs?: number;
}

export interface AuditLog {
  sessionId: string;
  path: string;
  startedAt: string | null;
  requests: LogRequest[];
  messages: Map<string, StoredMessage>;
  toolCallsByName: Map<string, number>;
  toolResults: ToolResultEntry[];
  compactions: number;
  /** Request sequences whose request followed a compaction. */
  compactionsBefore: number[];
  errors: string[];
  requestsWithoutPayload: number;
  skippedLines: number;
  bytesRead: number;
  /** True when a cap stopped the reader from indexing everything. */
  hitLimit: boolean;
  limits: typeof DEFAULT_LIMITS;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const CONVERSATION_FIELDS = [
  "messages",
  "input",
  "contents",
  "conversation",
] as const;

/** Conversation array for OpenAI Chat/Responses, Anthropic, and Gemini shapes. */
export function conversationArray(payload: unknown): unknown[] {
  if (!isObject(payload)) return [];
  for (const field of CONVERSATION_FIELDS) {
    const value = payload[field];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function messageRole(message: unknown): string {
  if (isObject(message)) {
    if (typeof message.role === "string") return message.role;
    if (typeof message.type === "string") return message.type;
  }
  return "unknown";
}

/**
 * Bounded, schema-agnostic text extraction. Payloads carry text under different
 * keys per provider, and tool results nest it, so this walks a few known keys
 * with a depth cap instead of assuming one shape.
 */
export function extractText(value: unknown, limit: number, depth = 0): string {
  if (depth > 6 || limit <= 0) return "";
  if (typeof value === "string") return value.slice(0, limit);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const text = extractText(item, limit, depth + 1);
      if (text) parts.push(text);
      if (parts.join("\n").length >= limit) break;
    }
    return parts.join("\n").slice(0, limit);
  }
  if (isObject(value)) {
    const parts: string[] = [];
    for (const key of [
      "text",
      "content",
      "output",
      "result",
      "arguments",
      "input",
      "description",
    ]) {
      if (!(key in value)) continue;
      const text = extractText(value[key], limit, depth + 1);
      if (text) parts.push(text);
      if (parts.join("\n").length >= limit) break;
    }
    return parts.join("\n").slice(0, limit);
  }
  return "";
}

const preview = (text: string, limit: number): string =>
  text.replace(/\s+/g, " ").trim().slice(0, limit);

function hashMessage(message: unknown): string {
  return createHash("sha1").update(JSON.stringify(message)).digest("hex");
}

const emptyLimits = (): typeof DEFAULT_LIMITS => ({ ...DEFAULT_LIMITS });

export async function readAuditLog(
  path: string,
  options: { embedBodies?: boolean; limits?: Partial<typeof DEFAULT_LIMITS> } = {},
): Promise<AuditLog> {
  const limits = { ...emptyLimits(), ...(options.limits ?? {}) };
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Not a file: ${path}`);
  if (info.size > limits.maxLogBytes)
    throw new Error(
      `Audit log is ${Math.round(info.size / 1024 / 1024)} MiB, over the ${Math.round(limits.maxLogBytes / 1024 / 1024)} MiB read limit: ${path}`,
    );

  const log: AuditLog = {
    sessionId: path.split("/").pop()?.replace(/\.jsonl$/, "") ?? "unknown",
    path,
    startedAt: null,
    requests: [],
    messages: new Map(),
    toolCallsByName: new Map(),
    toolResults: [],
    compactions: 0,
    compactionsBefore: [],
    errors: [],
    requestsWithoutPayload: 0,
    skippedLines: 0,
    bytesRead: info.size,
    hitLimit: false,
    limits,
  };
  let followedCompaction = false;
  let embeddedBodyBytes = 0;
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      log.skippedLines++;
      continue;
    }
    if (!isObject(record)) continue;
    const type = record.recordType;

    if (type === "session_start") {
      if (typeof record.sessionId === "string") log.sessionId = record.sessionId;
      if (typeof record.timestamp === "string") log.startedAt = record.timestamp;
      continue;
    }
    if (type === "llm_request") {
      const { payload, ...rest } = record;
      const payloadStored = record.payloadStored === true && payload !== undefined;
      const request: LogRequest = {
        record: rest as unknown as AuditRequestRecord,
        payloadStored,
      };
      if (record.followedCompaction === true) followedCompaction = true;
      if (followedCompaction) {
        log.compactionsBefore.push(Number(record.requestSequence));
        followedCompaction = false;
      }
      if (payloadStored) {
        const hashes: string[] = [];
        const counts = new Map<string, number>();
        for (const message of conversationArray(payload)) {
          const hash = hashMessage(message);
          hashes.push(hash);
          counts.set(hash, (counts.get(hash) ?? 0) + 1);
          if (log.messages.has(hash)) continue;
          if (log.messages.size >= limits.maxUniqueMessages) {
            log.hitLimit = true;
            continue;
          }
          const body = JSON.stringify(message);
          const bytes = Buffer.byteLength(body, "utf8");
          let text = "";
          let omitReason: "limit" | "budget" | undefined;
          if (options.embedBodies) {
            // Budget is checked before extraction and measured in message bytes,
            // so one oversized message cannot blow through the cap: a message
            // that does not fit is flagged, not embedded.
            if (embeddedBodyBytes + bytes > limits.maxTotalBodyBytes) {
              omitReason = "budget";
            } else {
              embeddedBodyBytes += bytes;
              text = extractText(message, limits.maxMessageBytes);
              if (text.length >= limits.maxMessageBytes) omitReason = "limit";
            }
          }
          log.messages.set(hash, {
            hash,
            role: messageRole(message),
            bytes,
            preview: preview(
              text || extractText(message, limits.maxPreviewChars),
              limits.maxPreviewChars,
            ),
            text,
            ...(omitReason === undefined ? {} : { omitReason }),
            sends: 0,
            duplicateInstances: 0,
          });
        }
        for (const [hash, count] of counts) {
          const message = log.messages.get(hash);
          if (!message) continue;
          message.sends++;
          message.duplicateInstances = Math.max(
            message.duplicateInstances,
            count,
          );
        }
        request.messageHashes = hashes;
      } else {
        log.requestsWithoutPayload++;
      }
      log.requests.push(request);
      continue;
    }
    if (type === "llm_usage") {
      const sequence = Number(record.requestSequence);
      const target = log.requests.find(
        (item) => item.record.requestSequence === sequence,
      );
      if (target) {
        if (isObject(record.usage))
          target.usage = record.usage as unknown as NormalizedUsage;
        if (isObject(record.timing))
          target.timing = record.timing as Record<
            string,
            number | null | undefined
          >;
      }
      continue;
    }
    if (type === "tool_call") {
      if (typeof record.toolName === "string")
        log.toolCallsByName.set(
          record.toolName,
          (log.toolCallsByName.get(record.toolName) ?? 0) + 1,
        );
      continue;
    }
    if (type === "tool_result") {
      log.toolResults.push({
        toolName: typeof record.toolName === "string" ? record.toolName : "unknown",
        outputBytes: typeof record.outputBytes === "number" ? record.outputBytes : 0,
        isError: record.isError === true,
        ...(typeof record.durationMs === "number"
          ? { durationMs: record.durationMs }
          : {}),
      });
      continue;
    }
    if (type === "compaction") {
      log.compactions++;
      continue;
    }
    if (type === "audit_error" && typeof record.message === "string") {
      log.errors.push(record.message);
    }
  }

  return log;
}

/** Rebuild session metrics so the existing reporter/heuristics can be reused. */
export function metricsFromLog(log: AuditLog): SessionMetrics {
  const requests = log.requests.map((item) => item.record);
  const usages = new Map<number, UsageRecord>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalCost = 0;
  let maxUserTurn = 0;
  let payloadBytes = 0;
  let requestDurationMs = 0;
  let requestDurationCount = 0;
  for (const request of requests) {
    payloadBytes += request.analysis?.payloadBytes ?? 0;
    maxUserTurn = Math.max(maxUserTurn, request.userTurn ?? 0);
  }
  for (const item of log.requests) {
    const sequence = item.record.requestSequence;
    const usage = item.usage;
    if (!usage) continue;
    inputTokens += usage.inputTokens ?? 0;
    outputTokens += usage.outputTokens ?? 0;
    cacheReadTokens += usage.cacheReadTokens ?? 0;
    cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    totalCost += usage.totalCost ?? 0;
    const timing = item.timing ?? {};
    const total = timing.totalRequestMs;
    if (typeof total === "number") {
      requestDurationMs += total;
      requestDurationCount++;
    }
    usages.set(sequence, {
      schemaVersion: SCHEMA_VERSION,
      recordType: "llm_usage",
      timestamp: item.record.timestamp,
      auditRecordId: item.record.auditRecordId,
      sessionId: log.sessionId,
      requestSequence: sequence,
      usage,
      timing: item.timing as UsageRecord["timing"],
    });
  }
  return {
    sessionId: log.sessionId,
    startedAt: log.startedAt ? Date.parse(log.startedAt) : Date.now(),
    requestCount: requests.length,
    userTurns: maxUserTurn,
    toolCalls: log.toolResults.length,
    payloadBytes,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalCost,
    requestDurationMs,
    requestDurationCount,
    turnDurationMs: 0,
    turnDurationCount: 0,
    compactions: log.compactions,
    requests,
    usages,
    toolDurations: log.toolResults.flatMap((item) =>
      item.durationMs === undefined ? [] : [item.durationMs],
    ),
    toolCallsByName: log.toolCallsByName,
  };
}

export interface SessionSummary {
  id: string;
  path: string;
  mtimeMs: number;
  bytes: number;
  startedAt: string | null;
  cwd: string | null;
  mode: string | null;
  requests: number;
  payloads: number;
  /** False when the scan budget was hit, so the counts are partial. */
  complete: boolean;
}

/**
 * Summarise recent session logs for `/llm-audit sessions`.
 *
 * Bounded on purpose: this directory can hold hundreds of megabytes of history
 * (541 MB here), so each file is scanned up to `scanBytes` and marked incomplete
 * rather than read in full just to render a list.
 */
export async function listSessions(
  directory: string,
  options: { limit?: number; scanBytes?: number } = {},
): Promise<SessionSummary[]> {
  const limit = options.limit ?? 20;
  const scanBytes = options.scanBytes ?? 4 * 1024 * 1024;
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const files: { path: string; mtimeMs: number; bytes: number }[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(directory, name);
    try {
      const info = await stat(path);
      files.push({ path, mtimeMs: info.mtimeMs, bytes: info.size });
    } catch {
      continue;
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const summaries: SessionSummary[] = [];
  for (const file of files.slice(0, limit)) {
    const summary: SessionSummary = {
      id: file.path.split("/").pop()!.replace(/\.jsonl$/, ""),
      path: file.path,
      mtimeMs: file.mtimeMs,
      bytes: file.bytes,
      startedAt: null,
      cwd: null,
      mode: null,
      requests: 0,
      payloads: 0,
      complete: true,
    };
    let scanned = 0;
    const lines = createInterface({
      input: createReadStream(file.path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      scanned += Buffer.byteLength(line, "utf8") + 1;
      if (scanned > scanBytes) {
        summary.complete = false;
        break;
      }
      if (!line.includes('"recordType"')) continue;
      if (line.includes('"session_start"')) {
        try {
          const record = JSON.parse(line) as Record<string, unknown>;
          if (typeof record.cwd === "string") summary.cwd = record.cwd;
          if (typeof record.mode === "string") summary.mode = record.mode;
          if (typeof record.timestamp === "string")
            summary.startedAt = record.timestamp;
        } catch {
          // a malformed line must not break the listing
        }
      } else if (line.includes('"llm_request"')) {
        summary.requests++;
        if (line.includes('"payloadStored":true')) summary.payloads++;
      }
    }
    summaries.push(summary);
  }
  return summaries;
}
