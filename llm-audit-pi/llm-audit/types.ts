export const SCHEMA_VERSION = 1 as const;

export type AuditMode = "metrics" | "redacted" | "full";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

export interface AuditConfig {
  enabled: boolean;
  mode: AuditMode;
  logDirectory: string;
  capturePayload: boolean;
  captureHeaders: boolean;
  showStatus: boolean;
  showTurnSummary: boolean;
  roughCharactersPerToken: number;
  maxPayloadBytes: number;
  maxFieldBytes: number;
  retentionDays: number;
  redactFieldNames: string[];
  redactPatterns: string[];
  excludeModels: string[];
  excludeProviders: string[];
}

export interface SizeBreakdown {
  systemBytes: number;
  developerBytes: number;
  userBytes: number;
  assistantBytes: number;
  toolDefinitionBytes: number;
  toolResultBytes: number;
  reasoningBytes: number;
  multimodalBytes: number;
  otherBytes: number;
}

export interface TopLevelFieldSize {
  field: string;
  bytes: number;
  classification: keyof SizeBreakdown;
}

export interface LargestComponent {
  path: string;
  kind: keyof SizeBreakdown;
  bytes: number;
  role?: string;
}

export interface ToolSchemaSize {
  name: string;
  bytes: number;
}

export interface PayloadAnalysis {
  payloadBytes: number;
  payloadTruncated: boolean;
  approximateTokens: number;
  tokenEstimate: "rough_characters";
  messageCount: number;
  toolDefinitionCount: number;
  /** Largest tool schemas by serialized size, capped for log size. */
  tools: ToolSchemaSize[];
  topLevelFields: TopLevelFieldSize[];
  sections: SizeBreakdown;
  largestComponents: LargestComponent[];
  providerShape:
    | "openai-chat"
    | "openai-responses"
    | "anthropic-messages"
    | "gemini"
    | "unknown";
  promptCachingDetected: boolean | null;
}

export interface NormalizedUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  totalTokens?: number | null;
  inputCost?: number | null;
  outputCost?: number | null;
  cacheCost?: number | null;
  totalCost?: number | null;
  currency?: string | null;
}

export interface RequestTiming {
  responseHeadersMs?: number | null;
  firstStreamEventMs?: number | null;
  generationMs?: number | null;
  totalRequestMs?: number | null;
}

export interface AuditRequestRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  recordType: "llm_request";
  timestamp: string;
  auditRecordId: string;
  sessionId: string;
  requestSequence: number;
  userTurn: number;
  provider?: string;
  model?: string;
  api?: string;
  thinkingLevel?: string;
  cwd: string;
  gitRoot?: string;
  gitBranch?: string;
  analysis: PayloadAnalysis;
  contextAddedBytes: number | null;
  followedCompaction: boolean;
  cumulativeToolCalls: number;
  headers?: JsonObject;
  payload?: JsonValue;
  payloadStored: boolean;
}

export interface ProviderResponseRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  recordType: "provider_response";
  timestamp: string;
  auditRecordId: string;
  sessionId: string;
  requestSequence: number;
  status: number;
  headers?: JsonObject;
  responseHeadersMs?: number;
}

export interface UsageRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  recordType: "llm_usage";
  timestamp: string;
  auditRecordId: string;
  sessionId: string;
  requestSequence: number;
  usage: NormalizedUsage;
  rawUsage?: JsonValue;
  timing: RequestTiming;
}

export interface ToolCallRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  recordType: "tool_call" | "tool_result";
  timestamp: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  userTurn: number;
  durationMs?: number;
  isError?: boolean;
  inputBytes?: number;
  outputBytes?: number;
}

export interface SessionRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  recordType:
    | "session_start"
    | "session_event"
    | "compaction"
    | "session_summary"
    | "audit_error";
  timestamp: string;
  sessionId: string;
  [key: string]: JsonValue | number | boolean | undefined;
}

export type AuditRecord =
  | AuditRequestRecord
  | ProviderResponseRecord
  | UsageRecord
  | ToolCallRecord
  | SessionRecord;

export interface SessionMetrics {
  sessionId: string;
  startedAt: number;
  requestCount: number;
  userTurns: number;
  toolCalls: number;
  payloadBytes: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  requestDurationMs: number;
  requestDurationCount: number;
  turnDurationMs: number;
  turnDurationCount: number;
  compactions: number;
  requests: AuditRequestRecord[];
  usages: Map<number, UsageRecord>;
  toolDurations: number[];
  /** Observed tool invocations by tool name; used to flag unused schemas. */
  toolCallsByName: Map<string, number>;
}

export interface AuditExport {
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  session: {
    sessionId: string;
    userTurns: number;
    requestCount: number;
    toolCalls: number;
    compactions: number;
  };
  requests: Array<
    Pick<
      AuditRequestRecord,
      | "requestSequence"
      | "userTurn"
      | "provider"
      | "model"
      | "api"
      | "analysis"
      | "contextAddedBytes"
      | "followedCompaction"
      | "cumulativeToolCalls"
    > & { usage?: NormalizedUsage; timing?: RequestTiming }
  >;
}

export interface EfficiencyWarning {
  id: string;
  message: string;
  evidence: string;
}
