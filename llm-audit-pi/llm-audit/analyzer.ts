import { redactValue, safeJsonBytes } from "./redaction.ts";
import type {
  AuditConfig,
  JsonObject,
  JsonValue,
  LargestComponent,
  NormalizedUsage,
  PayloadAnalysis,
  SizeBreakdown,
  ToolSchemaSize,
} from "./types.ts";

/** Per-tool attribution is display-oriented; bound how many are recorded. */
const MAX_TOOL_SCHEMAS = 20;

const SYSTEM_FIELDS = new Set([
  "system",
  "instructions",
  "systeminstruction",
  "system_instruction",
]);
const CONVERSATION_FIELDS = new Set([
  "messages",
  "input",
  "contents",
  "conversation",
]);
const TOOL_FIELDS = new Set([
  "tools",
  "functions",
  "function_declarations",
  "functiondeclarations",
]);
const TOOL_RESULT_TYPES = new Set([
  "tool_result",
  "function_response",
  "toolresult",
  "functionresult",
]);
const TOOL_CALL_TYPES = new Set([
  "tool_use",
  "function_call",
  "toolcall",
  "functioncall",
]);

type Kind = keyof SizeBreakdown;
type UnknownObject = Record<string, unknown>;

const emptyBreakdown = (): SizeBreakdown => ({
  systemBytes: 0,
  developerBytes: 0,
  userBytes: 0,
  assistantBytes: 0,
  toolDefinitionBytes: 0,
  toolResultBytes: 0,
  reasoningBytes: 0,
  multimodalBytes: 0,
  otherBytes: 0,
});

const isObject = (value: unknown): value is UnknownObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const lower = (value: unknown): string =>
  typeof value === "string" ? value.toLowerCase() : "";

function byteSize(value: unknown, config: AuditConfig): number {
  return safeJsonBytes(value, config).bytes;
}

function messageKind(value: unknown): Kind {
  if (!isObject(value)) return "otherBytes";
  const role = lower(value.role);
  const type = lower(value.type);
  const content = value.content;
  if (
    TOOL_RESULT_TYPES.has(type) ||
    containsBlockType(content, TOOL_RESULT_TYPES) ||
    role === "tool" ||
    role === "toolresult" ||
    "tool_call_id" in value ||
    "toolCallId" in value
  )
    return "toolResultBytes";
  if (
    TOOL_CALL_TYPES.has(type) ||
    containsBlockType(content, TOOL_CALL_TYPES) ||
    "tool_calls" in value ||
    "toolCalls" in value
  )
    return "assistantBytes";
  if (
    type.includes("reasoning") ||
    type.includes("thinking") ||
    "thinking" in value ||
    "reasoning" in value
  )
    return "reasoningBytes";
  if (
    type.includes("image") ||
    type.includes("audio") ||
    type.includes("video") ||
    hasMultimodal(content)
  )
    return "multimodalBytes";
  if (role === "system") return "systemBytes";
  if (role === "developer") return "developerBytes";
  if (role === "user") return "userBytes";
  if (role === "assistant" || role === "model") return "assistantBytes";
  return "otherBytes";
}

function hasMultimodal(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasMultimodal);
  if (!isObject(value)) return false;
  const type = lower(value.type);
  return (
    type.includes("image") ||
    type.includes("audio") ||
    type.includes("video") ||
    "inline_data" in value ||
    "image_url" in value
  );
}

function containsBlockType(value: unknown, types: Set<string>): boolean {
  if (Array.isArray(value))
    return value.some((item) => containsBlockType(item, types));
  return isObject(value) && types.has(lower(value.type));
}

function addComponent(
  list: LargestComponent[],
  path: string,
  kind: Kind,
  value: unknown,
  config: AuditConfig,
  role?: string,
): void {
  list.push({
    path,
    kind,
    bytes: byteSize(value, config),
    ...(role === undefined ? {} : { role }),
  });
}

function inspectConversation(
  value: unknown,
  path: string,
  sections: SizeBreakdown,
  components: LargestComponent[],
  config: AuditConfig,
): number {
  const messages = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.messages)
      ? value.messages
      : [value];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const kind = messageKind(message);
    sections[kind] += byteSize(message, config);
    addComponent(
      components,
      `${path}[${index}]`,
      kind,
      message,
      config,
      isObject(message) && typeof message.role === "string"
        ? message.role
        : undefined,
    );
  }
  return messages.length;
}

function toolName(entry: unknown): string {
  if (!isObject(entry)) return "(unnamed)";
  if (typeof entry.name === "string" && entry.name) return entry.name;
  if (isObject(entry.function) && typeof entry.function.name === "string")
    return entry.function.name;
  return "(unnamed)";
}

/**
 * Sizes individual tool definitions so the largest fixed context cost can be
 * attributed to a named tool. Covers OpenAI (`tools[].function.name`), Anthropic
 * (`tools[].name`), and Gemini (`tools[].functionDeclarations[].name`).
 */
export function describeToolSchemas(
  payload: unknown,
  config: AuditConfig,
): ToolSchemaSize[] {
  if (!isObject(payload)) return [];
  const tools: ToolSchemaSize[] = [];
  for (const [field, raw] of Object.entries(payload)) {
    if (!TOOL_FIELDS.has(field.toLowerCase())) continue;
    for (const entry of Array.isArray(raw) ? raw : [raw]) {
      const declarations =
        isObject(entry) && Array.isArray(entry.functionDeclarations)
          ? entry.functionDeclarations
          : [entry];
      for (const declaration of declarations)
        tools.push({
          name: toolName(declaration),
          bytes: byteSize(declaration, config),
        });
    }
  }
  return tools.sort((a, b) => b.bytes - a.bytes).slice(0, MAX_TOOL_SCHEMAS);
}

export function detectProviderShape(
  payload: unknown,
): PayloadAnalysis["providerShape"] {
  if (!isObject(payload)) return "unknown";
  if ("contents" in payload || "systemInstruction" in payload) return "gemini";
  if ("messages" in payload && "anthropic_version" in payload)
    return "anthropic-messages";
  if ("messages" in payload && "model" in payload) return "openai-chat";
  if (
    "input" in payload &&
    ("instructions" in payload ||
      "previous_response_id" in payload ||
      "reasoning" in payload)
  )
    return "openai-responses";
  return "unknown";
}

export function analyzePayload(
  payload: unknown,
  config: AuditConfig,
): PayloadAnalysis {
  const sections = emptyBreakdown();
  const components: LargestComponent[] = [];
  const topLevelFields: PayloadAnalysis["topLevelFields"] = [];
  let messageCount = 0;
  let toolDefinitionCount = 0;
  const clone = redactValue(payload, config, false);
  const normalized = clone.value;
  const payloadBytes = Buffer.byteLength(JSON.stringify(normalized), "utf8");

  if (isObject(normalized)) {
    for (const [field, value] of Object.entries(normalized)) {
      const key = field.toLowerCase();
      const bytes = byteSize(value, config);
      let kind: Kind = "otherBytes";
      if (SYSTEM_FIELDS.has(key)) {
        kind = "systemBytes";
        sections[kind] += bytes;
        addComponent(components, field, kind, value, config);
      } else if (TOOL_FIELDS.has(key)) {
        kind = "toolDefinitionBytes";
        sections[kind] += bytes;
        toolDefinitionCount += Array.isArray(value) ? value.length : 1;
        addComponent(components, field, kind, value, config);
      } else if (CONVERSATION_FIELDS.has(key)) {
        kind = "otherBytes";
        messageCount += inspectConversation(
          value,
          field,
          sections,
          components,
          config,
        );
      } else {
        sections.otherBytes += bytes;
        addComponent(components, field, kind, value, config);
      }
      topLevelFields.push({ field, bytes, classification: kind });
    }
  } else {
    sections.otherBytes = payloadBytes;
    addComponent(components, "$", "otherBytes", normalized, config);
  }

  return {
    payloadBytes,
    payloadTruncated: clone.truncated,
    approximateTokens: Math.ceil(
      JSON.stringify(normalized).length / config.roughCharactersPerToken,
    ),
    tokenEstimate: "rough_characters",
    messageCount,
    toolDefinitionCount,
    tools: describeToolSchemas(normalized, config),
    topLevelFields: topLevelFields.sort((a, b) => b.bytes - a.bytes),
    sections,
    largestComponents: components
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 12),
    providerShape: detectProviderShape(normalized),
    promptCachingDetected: detectPromptCaching(normalized),
  };
}

export function detectPromptCaching(value: unknown): boolean | null {
  const encoded = JSON.stringify(value).toLowerCase();
  if (
    encoded.includes("cache_control") ||
    encoded.includes("cached_content") ||
    encoded.includes("prompt_cache") ||
    encoded.includes("cache_key")
  )
    return true;
  return null;
}

function numberAt(value: unknown, paths: string[][]): number | undefined {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path)
      current = isObject(current) ? current[key] : undefined;
    if (typeof current === "number" && Number.isFinite(current)) return current;
  }
  return undefined;
}

export function normalizeUsage(raw: unknown): NormalizedUsage {
  const inputTokens = numberAt(raw, [
    ["input"],
    ["input_tokens"],
    ["inputTokens"],
    ["prompt_tokens"],
  ]);
  const outputTokens = numberAt(raw, [
    ["output"],
    ["output_tokens"],
    ["outputTokens"],
    ["completion_tokens"],
  ]);
  const reasoningTokens = numberAt(raw, [
    ["reasoning"],
    ["reasoning_tokens"],
    ["reasoningTokens"],
    ["completion_tokens_details", "reasoning_tokens"],
  ]);
  const cacheReadTokens = numberAt(raw, [
    ["cacheRead"],
    ["cache_read_input_tokens"],
    ["cacheReadTokens"],
    ["prompt_tokens_details", "cached_tokens"],
  ]);
  const cacheWriteBase = numberAt(raw, [
    ["cacheWrite"],
    ["cache_creation_input_tokens"],
    ["cacheWriteTokens"],
  ]);
  const cacheWriteOneHour = numberAt(raw, [["cacheWrite1h"]]);
  const cacheWriteTokens =
    cacheWriteBase === undefined && cacheWriteOneHour === undefined
      ? undefined
      : (cacheWriteBase ?? 0) + (cacheWriteOneHour ?? 0);
  const totalTokens = numberAt(raw, [["totalTokens"], ["total_tokens"]]);
  const inputCost = numberAt(raw, [["cost", "input"], ["input_cost"]]);
  const outputCost = numberAt(raw, [["cost", "output"], ["output_cost"]]);
  const cacheReadCost = numberAt(raw, [
    ["cost", "cacheRead"],
    ["cache_read_cost"],
  ]);
  const cacheWriteCost = numberAt(raw, [
    ["cost", "cacheWrite"],
    ["cache_write_cost"],
  ]);
  const totalCost = numberAt(raw, [["cost", "total"], ["total_cost"]]);
  const currency =
    isObject(raw) && typeof raw.currency === "string"
      ? raw.currency
      : undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(inputCost === undefined ? {} : { inputCost }),
    ...(outputCost === undefined ? {} : { outputCost }),
    ...(cacheReadCost === undefined && cacheWriteCost === undefined
      ? {}
      : { cacheCost: (cacheReadCost ?? 0) + (cacheWriteCost ?? 0) }),
    ...(totalCost === undefined ? {} : { totalCost }),
    ...(currency === undefined ? {} : { currency }),
  };
}

export function asJsonObject(value: unknown): JsonObject | undefined {
  return isObject(value) ? (value as JsonObject) : undefined;
}
