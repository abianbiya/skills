import type { AuditLog, LogRequest, StoredMessage } from "./logs.ts";
import { metricsFromLog, readAuditLog } from "./logs.ts";
import { renderMarkdown } from "./markdown.ts";
import { analyzeProvenance, type ProvenanceReport } from "./provenance.ts";
import { renderTreemapSvg, type TreemapItem } from "./treemap.ts";import { efficiencyWarnings } from "./reporter.ts";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { SessionMetrics, ToolSchemaSize } from "./types.ts";

/**
 * Analysis model + single-file HTML rendering for an audit log.
 *
 * Design constraints that came out of measuring real logs (up to 139 MiB, 196
 * captured payloads): messages are embedded once and referenced by hash, since
 * 99.0% of message instances are re-sends of a prefix (41,896 instances were
 * 413 unique messages); the output is one self-contained file with inline CSS,
 * no JavaScript dependencies and no network requests, because the file can
 * contain prompt text and source code.
 */

const KiB = 1024;
const MiB = KiB * KiB;

/**
 * Rough token estimate for a byte count. The analyzer's own estimate uses the
 * configured characters-per-token (default 4); individual messages only carry
 * their serialized bytes, so every per-item number here is bytes ÷ 4 and is
 * labelled as an estimate rather than a tokenizer count.
 */
const roughTokens = (value: number): number => Math.ceil(value / 4);

const bytes = (value: number): string =>
  value >= MiB
    ? `${(value / MiB).toFixed(2)} MiB`
    : value >= KiB
      ? `${(value / KiB).toFixed(1)} KiB`
      : `${value} B`;
const number = (value: number): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const ms = (value: number): string => `${(value / 1000).toFixed(2)}s`;
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export interface DeltaRow {
  requestSequence: number;
  userTurn: number;
  added: StoredMessage[];
  addedBytes: number;
  removedCount: number;
  removedBytes: number;
  /** True when the first message changed: this invalidates prompt caching. */
  prefixChanged: boolean;
  afterCompaction: boolean;
}

export interface DuplicateRow {
  message: StoredMessage;
  instances: number;
  wastedBytes: number;
}

export interface ToolRow {
  name: string;
  bytes: number;
  calls: number;
  verdict: "used" | "never called";
}

export interface ReportTotals {
  payloadBytes: number;
  fixedBytes: number;
  variableBytes: number;
  uniqueMessageBytes: number;
  requestsWithPayload: number;
  requestsWithoutPayload: number;
  duplicateWastedBytes: number;
  duplicateMessages: number;
  unusedToolBytes: number;
  compactionEvents: number;
  cacheInvalidatingEvents: number;
  truncatedMessages: number;
  omittedMessages: number;
  skippedLines: number;
  hitLimit: boolean;
}

export interface ReportModel {
  sessionId: string;
  logPath: string;
  generatedAt: string;
  startedAt: string | null;
  providers: string[];
  models: string[];
  metrics: SessionMetrics;
  warnings: ReturnType<typeof efficiencyWarnings>;
  requests: LogRequest[];
  messages: StoredMessage[];
  deltas: DeltaRow[];
  duplicates: DuplicateRow[];
  tools: ToolRow[];
  /** Where the system prompt's bytes came from, when a payload was captured. */
  provenance?: ProvenanceReport;
  totals: ReportTotals;
  embedBodies: boolean;
}

const sections = (request: LogRequest) => request.record.analysis?.sections;

/** Fixed context is what every request pays regardless of conversation. */
function fixedBytes(request: LogRequest): number {
  const breakdown = sections(request);
  if (!breakdown) return 0;
  return (
    breakdown.systemBytes +
    breakdown.developerBytes +
    breakdown.toolDefinitionBytes
  );
}

/**
 * Provenance for a log's latest captured system message, or undefined when no
 * payload was stored (metrics mode has no text to attribute).
 *
 * Exported so `/llm-audit sources` reports exactly what the HTML report shows.
 */
export function provenanceForLog(
  log: AuditLog,
  messages: StoredMessage[],
): ProvenanceReport | undefined {
  const systemHash = [...log.requests]
    .reverse()
    .find((request) => request.messageHashes?.[0])?.messageHashes?.[0];
  const systemMessage = systemHash ? log.messages.get(systemHash) : undefined;
  // Only the first message is the system prompt when it actually is one: a
  // payload that starts with a user/tool message has no system prompt to
  // attribute, and treating it as one would double-embed that content.
  if (!systemMessage?.text || systemMessage.role !== "system") return undefined;
  return analyzeProvenance({
    systemText: systemMessage.text,
    conversationText: messages
      .filter((message) => message.hash !== systemHash)
      .map((message) => message.text)
      .filter(Boolean),
    ...(process.env.PI_CODING_AGENT_DIR
      ? { agentDir: process.env.PI_CODING_AGENT_DIR }
      : {}),
    ...(log.requests[0]?.record.cwd ? { cwd: log.requests[0].record.cwd } : {}),
  });
}

export function buildReportModel(
  log: AuditLog,
  options: { embedBodies?: boolean; generatedAt?: string } = {},
): ReportModel {
  const metrics = metricsFromLog(log);
  const messages = [...log.messages.values()].sort((a, b) => b.bytes - a.bytes);
  const withPayload = log.requests.filter((request) => request.messageHashes);

  // Deltas are set differences, not prefix-derived: a prompt change or a
  // compaction re-orders the context without meaning the content was "added".
  const deltas: DeltaRow[] = [];
  for (let index = 1; index < withPayload.length; index++) {
    const current = withPayload[index];
    const previous = withPayload[index - 1];
    if (!current?.messageHashes || !previous?.messageHashes) continue;
    const previousSet = new Set(previous.messageHashes);
    const currentSet = new Set(current.messageHashes);
    const added: StoredMessage[] = [];
    let addedBytes = 0;
    for (const hash of currentSet)
      if (!previousSet.has(hash)) {
        const message = log.messages.get(hash);
        if (message) {
          added.push(message);
          addedBytes += message.bytes;
        }
      }
    let removedCount = 0;
    let removedBytes = 0;
    for (const hash of previousSet)
      if (!currentSet.has(hash)) {
        removedCount++;
        removedBytes += log.messages.get(hash)?.bytes ?? 0;
      }
    deltas.push({
      requestSequence: current.record.requestSequence,
      userTurn: current.record.userTurn ?? 0,
      added: added.sort((a, b) => b.bytes - a.bytes),
      addedBytes,
      removedCount,
      removedBytes,
      prefixChanged:
        current.messageHashes[0] !== previous.messageHashes[0] &&
        current.messageHashes[0] !== undefined,
      afterCompaction: current.record.followedCompaction === true,
    });
  }

  const duplicates: DuplicateRow[] = log.messages.size
    ? [...log.messages.values()]
        .filter((message) => message.duplicateInstances > 1)
        .map((message) => ({
          message,
          instances: message.duplicateInstances,
          wastedBytes: (message.duplicateInstances - 1) * message.bytes,
        }))
        .sort((a, b) => b.wastedBytes - a.wastedBytes)
    : [];

  const latestTools: ToolSchemaSize[] =
    log.requests.at(-1)?.record.analysis?.tools ?? [];  const tools: ToolRow[] = latestTools.map((tool) => {
    const calls = log.toolCallsByName.get(tool.name) ?? 0;
    return {
      name: tool.name,
      bytes: tool.bytes,
      calls,
      verdict: calls > 0 ? "used" : "never called",
    };
  });
  const unusedToolBytes = tools
    .filter((tool) => tool.calls === 0)
    .reduce((total, tool) => total + tool.bytes, 0);

  const latest = log.requests.at(-1);
  const latestFixed = latest ? fixedBytes(latest) : 0;
  const payloadBytes = metrics.payloadBytes;
  const uniqueMessageBytes = messages.reduce(
    (total, message) => total + message.bytes,
    0,
  );

  const provenance = provenanceForLog(log, messages);

  return {
    sessionId: log.sessionId,
    logPath: log.path,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    startedAt: log.startedAt,
    providers: [
      ...new Set(
        log.requests.flatMap((request) =>
          request.record.provider ? [request.record.provider] : [],
        ),
      ),
    ],
    models: [
      ...new Set(
        log.requests.flatMap((request) =>
          request.record.model ? [request.record.model] : [],
        ),
      ),
    ],
    metrics,
    warnings: efficiencyWarnings(metrics),
    requests: log.requests,
    messages,
    ...(provenance ? { provenance } : {}),
    deltas,
    duplicates,
    tools,
    totals: {
      payloadBytes,
      fixedBytes: latestFixed,
      variableBytes: latest
        ? Math.max(0, (latest.record.analysis?.payloadBytes ?? 0) - latestFixed)
        : 0,
      uniqueMessageBytes,
      requestsWithPayload: withPayload.length,
      requestsWithoutPayload: log.requestsWithoutPayload,
      duplicateWastedBytes: duplicates.reduce(
        (total, row) => total + row.wastedBytes,
        0,
      ),
      duplicateMessages: duplicates.length,
      unusedToolBytes,
      compactionEvents: log.compactions,
      cacheInvalidatingEvents:
        deltas.filter((delta) => delta.prefixChanged || delta.afterCompaction)
          .length + log.compactions,
      truncatedMessages: messages.filter(
        (message) => message.omitReason === "limit",
      ).length,
      omittedMessages: messages.filter(
        (message) => message.omitReason === "budget",
      ).length,
      skippedLines: log.skippedLines,
      hitLimit: log.hitLimit,
    },
    embedBodies: options.embedBodies === true,
  };
}

const styles = `
:root {
  --bg: #0f1115; --panel: #171a21; --panel-2: #1d2129; --line: #272c36;
  --text: #e6e9ef; --muted: #9aa3b2; --accent: #6ea8fe; --warn: #f0b849;
  --bad: #f2777a; --good: #7ec699; --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f6f7f9; --panel: #fff; --panel-2: #f0f2f5; --line: #dfe3e8;
    --text: #1b1f26; --muted: #5d6672; --accent: #1f6feb; --warn: #9a6700;
    --bad: #b42318; --good: #1a7f37;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 32px 20px 64px; background: var(--bg); color: var(--text);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 1180px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 17px; margin: 40px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
h3 { font-size: 14px; margin: 20px 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
p, li { color: var(--text); }
.sub { color: var(--muted); font-size: 13px; margin: 0 0 24px; }
.mono { font-family: var(--mono); font-size: 12.5px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(178px, 1fr)); gap: 12px; margin: 20px 0 8px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.card .k { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; }
.card .v { font-size: 21px; font-weight: 600; margin-top: 6px; font-variant-numeric: tabular-nums; }
.card .n { color: var(--muted); font-size: 12px; margin-top: 4px; }
.banner { border: 1px solid var(--warn); background: color-mix(in srgb, var(--warn) 12%, transparent); border-radius: 10px; padding: 14px 16px; margin: 0 0 20px; font-size: 13.5px; }
.banner.safe { border-color: var(--line); background: var(--panel); color: var(--muted); }
table { width: 100%; border-collapse: collapse; margin: 10px 0 4px; font-size: 13.5px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr:hover td { background: var(--panel-2); }
.bar { display: block; height: 7px; border-radius: 4px; background: var(--accent); min-width: 1px; }
.bar.warn { background: var(--warn); }
.bar.bad { background: var(--bad); }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; border: 1px solid var(--line); background: var(--panel-2); color: var(--muted); }
.pill.good { color: var(--good); border-color: color-mix(in srgb, var(--good) 45%, var(--line)); }
.pill.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); }
.pill.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, var(--line)); }
details { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; margin: 10px 0; }
details > summary { cursor: pointer; font-weight: 600; font-size: 13.5px; }
details[open] > summary { margin-bottom: 10px; }
details.body { background: transparent; border: 0; border-radius: 0; padding: 0; margin: 0; }
details.body > summary { font-weight: 400; list-style: none; }
details.body > summary::-webkit-details-marker { display: none; }
details.body > summary:hover .pill.good { border-color: var(--accent); color: var(--accent); }
details.body[open] > summary { margin-bottom: 6px; }
details.body pre { max-height: 560px; }
.hint { color: var(--muted); font-size: 11.5px; margin-top: 4px; }
pre { background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow-x: auto; font-family: var(--mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 420px; }
.warnlist { margin: 8px 0 0; padding-left: 18px; }
.warnlist li { margin: 6px 0; }
.warnlist strong { color: var(--warn); }
.muted { color: var(--muted); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 860px) { .grid2 { grid-template-columns: 1fr; } }
.rows { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 4px; }
details.row { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 0; margin: 0; overflow: hidden; }
details.row > summary { display: flex; align-items: baseline; gap: 12px; padding: 9px 14px; font-weight: 400; list-style: none; flex-wrap: wrap; }
details.row > summary::-webkit-details-marker { display: none; }
details.row > summary::marker { content: ""; }
details.row > summary:hover { background: var(--panel-2); }
details.row[open] > summary { border-bottom: 1px solid var(--line); background: var(--panel-2); }
.row-label { font-weight: 600; font-size: 13.5px; }
.row-metric { color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.row-body { padding: 12px 14px; }
.delta-row { display: flex; align-items: baseline; gap: 10px; padding: 6px 10px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.delta-preview { flex: 1 1 320px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.row-body pre { margin: 0; max-height: 640px; }
.md { font-size: 13.5px; }
.row-body h2.md, .row-body h3.md, .row-body h4.md, .row-body h5.md { margin: 14px 0 6px; text-transform: none; letter-spacing: 0; color: var(--text); font-size: 14.5px; padding: 0; border: 0; }
.row-body p { margin: 6px 0; }
.row-body ul, .row-body ol { margin: 6px 0; padding-left: 22px; }
.row-body blockquote { margin: 6px 0; padding: 4px 12px; border-left: 3px solid var(--line); color: var(--muted); }
.row-body code { font-family: var(--mono); font-size: 12.5px; background: var(--panel-2); padding: 1px 5px; border-radius: 4px; }
.row-body hr { border: 0; border-top: 1px solid var(--line); margin: 12px 0; }
pre.md-code { background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow-x: auto; max-height: 560px; }
pre.md-code code { background: none; padding: 0; font-size: 12px; white-space: pre; }
.code-lang { color: var(--muted); font-family: var(--mono); font-size: 11px; margin-bottom: 6px; text-transform: lowercase; }
.treemap { margin: 14px 0 0; }
.treemap svg { display: block; border-radius: 8px; }
.tile rect { transition: fill-opacity 90ms ease; }
.tile:hover rect { fill-opacity: 1; }
.tile-label { fill: #10131a; font-size: 11.5px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.tile-detail { fill: #10131a; fill-opacity: 0.72; font-size: 10.5px; font-family: var(--mono); }
.legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
.swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
`;

const KIND_LABEL: Record<string, string> = {
  harness: "harness boilerplate",
  project: "project context wrapper",
  agents: "AGENTS.md",
  skill: "skill catalog",
  memory: "memory",
  other: "unlabelled",
};

/**
 * The point of the report: what the fixed part of every request is made of, and
 * which file each byte came from. Rendered before any session-trend section.
 */
function messageCard(message: StoredMessage, model: ReportModel): string {
  const metrics = `<span class="row-metric">${escapeHtml(bytes(message.bytes))}</span><span class="row-metric">~${escapeHtml(number(roughTokens(message.bytes)))} tok</span><span class="row-metric">re-sent in ${message.sends} request(s)</span>`;
  const head = `<span class="pill">${escapeHtml(message.role)}</span><span class="row-label">${escapeHtml(message.preview.slice(0, 110))}</span>`;
  if (!model.embedBodies)
    return `<details class="row"><summary>${head}${metrics}<span class="row-metric">body not embedded — regenerate without <span class="mono">--no-body</span></span></summary></details>`;
  if (message.omitReason === "budget")
    return `<details class="row"><summary>${head}${metrics}<span class="row-metric">not embedded: report body budget spent</span></summary></details>`;
  if (!message.text)
    return `<details class="row"><summary>${head}${metrics}<span class="row-metric">nothing to expand: ${escapeHtml(bytes(message.bytes))} of non-text content</span></summary></details>`;
  return `<details class="row" id="m-${escapeHtml(message.hash)}"><summary>${head}${metrics}<span class="pill good">show message</span></summary><div class="row-body">${renderMarkdown(message.text)}${
    message.omitReason === "limit"
      ? '<p class="muted">[cut at the per-message safety ceiling]</p>'
      : ""
  }${
    message.bytes > message.text.length * 4 + 512
      ? `<p class="hint">most of this message is non-text content (${escapeHtml(bytes(message.bytes))} raw), so the text above is not the whole message</p>`
      : ""
  }</div></details>`;
}

function provenanceSection(model: ReportModel): string {
  const provenance = model.provenance;
  if (!provenance)
    return `<h2>Where your context comes from</h2>
<p class="muted">No system prompt was captured for this session, so its bytes cannot be attributed. Payload capture was off (metrics mode) or the request predates it. Re-run with <span class="mono">/llm-audit capture full</span> — or open a log whose requests stored a payload.</p>`;
  const total = provenance.totalBytes || 1;
  const unusedSkills = provenance.blocks.filter(
    (block) => block.kind === "skill" && block.used === false,
  );
  const unusedSkillBytes = unusedSkills.reduce((sum, block) => sum + block.bytes, 0);
  const unusedSkillNames = unusedSkills.filter((block) => block.skillName);
  const groups = provenance.groups
    .map(
      (group) =>
        `<tr><td>${escapeHtml(KIND_LABEL[group.kind] ?? group.kind)}</td><td class="num">${escapeHtml(bytes(group.bytes))}</td><td class="num">${escapeHtml(number(roughTokens(group.bytes)))}</td><td><span class="bar" style="width:${(group.share * 100).toFixed(1)}%"></span> <span class="muted mono">${escapeHtml(percent(group.share))}</span></td></tr>`,
    )
    .join("\n");
  const rows = provenance.blocks
    .map((block) => {
      const confidence =
        block.matchedLines === undefined
          ? ""
          : `<span class="row-metric">${block.matchedLines}/${block.totalLines} lines matched</span>`;
      const flag =
        block.kind === "skill" && block.used === false
          ? '<span class="pill bad">not loaded</span>'
          : block.kind === "memory"
            ? '<span class="pill warn">every request</span>'
            : "";
      const source = block.source
        ? `<span class="row-metric mono">${escapeHtml(block.source.replace(/^\/Users\/[^/]+/, "~"))}</span>`
        : "";
      const head = `<span class="row-label">${escapeHtml(block.label)}</span>${flag}<span class="row-metric">${escapeHtml(bytes(block.bytes))}</span><span class="row-metric">~${escapeHtml(number(roughTokens(block.bytes)))} tok</span><span class="row-metric">${escapeHtml(percent(block.bytes / total))} of system</span>${confidence}${source}`;
      const body = block.text
        ? `<div class="row-body">${renderMarkdown(block.text)}${
            block.textOmitted === "limit"
              ? '<p class="muted">[block text cut at the per-block limit]</p>'
              : ""
          }</div>`
        : `<div class="row-body"><p class="muted">no text captured for this block${
            block.textOmitted === "budget" ? " (report text budget spent)" : ""
          }</p></div>`;
      return `<details class="row"><summary>${head}<span class="pill good">show block</span></summary>${body}</details>`;
    })
    .join("\n");
  return `<h2>Where your context comes from</h2>
<p class="muted">System prompt: <strong>${escapeHtml(bytes(provenance.totalBytes))}</strong> (~${escapeHtml(number(roughTokens(provenance.totalBytes)))} tokens), attributed to named files: <strong>${escapeHtml(bytes(provenance.attributedBytes))}</strong> (${escapeHtml(percent(provenance.attributedBytes / total))}). Everything else is harness boilerplate or unlabelled prompt text.</p>
<table>
<thead><tr><th>Origin</th><th class="num">Bytes</th><th class="num">~Tokens</th><th>Share of system prompt</th></tr></thead>
<tbody>
${groups}
</tbody>
</table>
${
  unusedSkillNames.length
    ? `<div class="banner"><strong>${escapeHtml(bytes(unusedSkillBytes))} of skill metadata was not loaded in this session.</strong> ${unusedSkillNames.length} skill(s) were listed in the prompt but never pulled in: ${escapeHtml(unusedSkillNames.map((block) => block.skillName).join(", "))}. Filtering skills per profile (<span class="mono">skills: []</span> on a package entry) removes them from every request, not just this one.</div>`
    : ""
}
<h3>Every block, in prompt order</h3>
<p class="muted">Expand any block to read exactly what the model received in it.</p>
<div class="rows">
${rows}
</div>
<p class="muted">${escapeHtml(provenance.method)}</p>`;
}

/** Leaves for the context-window treemap: categories, each subdivided. */
function treemapItems(model: ReportModel): TreemapItem[] {
  const latest = model.requests.at(-1);
  const sections = latest?.record.analysis?.sections;
  if (!sections) return [];
  const items: TreemapItem[] = [];
  const provenance = model.provenance;
  if (provenance) {
    for (const block of provenance.blocks)
      items.push({
        label: block.skillName ? `skill: ${block.skillName}` : block.label.replace(/^#+\s*/, ""),
        bytes: block.bytes,
        group: "system",
      });
  } else if (sections.systemBytes + sections.developerBytes > 0) {
    items.push({
      label: "system + developer prompt",
      bytes: sections.systemBytes + sections.developerBytes,
      group: "system",
    });
  }
  for (const tool of model.tools)
    items.push({ label: tool.name, bytes: tool.bytes, group: "tools" });
  const components = latest?.record.analysis?.largestComponents ?? [];
  const historyKinds = new Set(["userBytes", "assistantBytes", "reasoningBytes", "multimodalBytes"]);
  let historySeen = 0;
  for (const component of components) {
    if (!historyKinds.has(component.kind)) continue;
    if (historySeen++ >= 5) break;
    items.push({ label: `${component.role ?? component.kind} ${component.path}`, bytes: component.bytes, group: "history" });
  }
  const knownHistory = items.filter((item) => item.group === "history").reduce((sum, item) => sum + item.bytes, 0);
  const historyTotal =
    sections.userBytes + sections.assistantBytes + sections.reasoningBytes + sections.multimodalBytes;
  if (historyTotal - knownHistory > 0)
    items.push({ label: "rest of the conversation", bytes: historyTotal - knownHistory, group: "history" });
  let resultSeen = 0;
  for (const component of components) {
    if (component.kind !== "toolResultBytes") continue;
    if (resultSeen++ >= 4) break;
    items.push({ label: `result ${component.path}`, bytes: component.bytes, group: "tool results" });
  }
  const knownResults = items.filter((item) => item.group === "tool results").reduce((sum, item) => sum + item.bytes, 0);
  if (sections.toolResultBytes - knownResults > 0)
    items.push({ label: "other tool results", bytes: sections.toolResultBytes - knownResults, group: "tool results" });
  if (sections.otherBytes > 0)
    items.push({ label: "unclassified payload fields", bytes: sections.otherBytes, group: "other" });
  return items.filter((item) => item.bytes > 0);
}

function contextWindowSection(model: ReportModel): string {
  const latest = model.requests.at(-1);
  if (!latest) return "";
  const items = treemapItems(model);
  const svg = renderTreemapSvg(items);
  if (!svg)
    return `<h2>How the context window is filled</h2><p class="muted">No section breakdown was recorded for this session.</p>`;
  const payload = latest.record.analysis?.payloadBytes ?? 0;
  return `<h2>How the context window is filled</h2>
<p class="muted">Latest request: <strong>${escapeHtml(bytes(payload))}</strong> (~${escapeHtml(number(roughTokens(payload)))} tokens) across ${items.length} contributors. Area is bytes; hover any tile for exact figures.</p>
${svg}`;
}

/**
 * Compact row for the per-request deltas. Bodies are never duplicated here: a
 * message in the largest-messages list is linked by anchor instead.
 */
function deltaRow(
  message: StoredMessage,
  model: ReportModel,
  linkable: boolean,
): string {
  const metrics = `<span class="row-metric">${escapeHtml(bytes(message.bytes))}</span><span class="row-metric">~${escapeHtml(number(roughTokens(message.bytes)))} tok</span>`;
  const link =
    model.embedBodies && linkable && message.text
      ? `<a class="pill good" href="#m-${escapeHtml(message.hash)}">show message</a>`
      : "";
  return `<div class="delta-row"><span class="pill">${escapeHtml(message.role)}</span>${metrics}<span class="delta-preview muted">${escapeHtml(message.preview)}</span>${link}</div>`;
}

function growthChart(model: ReportModel): string {
  const points = model.requests.map((request, index) => ({
    x: index,
    payload: request.record.analysis?.payloadBytes ?? 0,
    fixed: fixedBytes(request),
    compaction: request.record.followedCompaction === true,
  }));
  if (points.length < 2) return "";
  const max = Math.max(...points.map((point) => point.payload));
  const width = 1080;
  const height = 190;
  const pad = 6;
  const scale = (value: number): number =>
    height - pad - (value / (max || 1)) * (height - 2 * pad);
  const line = (pick: (point: (typeof points)[number]) => number): string =>
    points
      .map(
        (point, index) =>
          `${((index / (points.length - 1)) * width).toFixed(1)},${scale(pick(point)).toFixed(1)}`,
      )
      .join(" ");
  const markers = points
    .map((point, index) =>
      point.compaction
        ? `<line x1="${((index / (points.length - 1)) * width).toFixed(1)}" y1="0" x2="${((index / (points.length - 1)) * width).toFixed(1)}" y2="${height}" stroke="var(--warn)" stroke-dasharray="4 3" stroke-width="1" />`
        : "",
    )
    .join("");
  return `<figure style="margin:12px 0 0">
<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Payload size per request, max ${escapeHtml(bytes(max))}">
  <polyline fill="none" stroke="var(--line)" stroke-width="1.5" points="${line((point) => point.fixed)}" />
  <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${line((point) => point.payload)}" />
  ${markers}
</svg>
<figcaption class="muted" style="font-size:12px">Payload per request (<span style="color:var(--accent)">blue</span>) vs fixed overhead — system + tool schemas (<span style="color:var(--muted)">grey</span>). Dashed lines mark requests that followed a compaction. Max ${escapeHtml(bytes(max))}.</figcaption>
</figure>`;
}

function requestRows(model: ReportModel): string {
  return model.requests
    .map((request, index) => {
      const analysis = request.record.analysis;
      const usage = request.usage;
      const delta = model.deltas.find(
        (row) => row.requestSequence === request.record.requestSequence,
      );
      const payload = analysis?.payloadBytes ?? 0;
      const fixed = fixedBytes(request);
      const share = payload ? fixed / payload : 0;
      const total = request.timing?.totalRequestMs;
      return `<tr>
  <td class="num">${request.record.requestSequence}${request.record.followedCompaction ? ' <span class="pill warn">post-compaction</span>' : ""}</td>
  <td class="num">${payload ? escapeHtml(bytes(payload)) : "—"}</td>
  <td><span class="bar${share > 0.5 ? " warn" : ""}" style="width:${(share * 100).toFixed(1)}%"></span><span class="muted mono">${payload ? escapeHtml(percent(share)) : ""}</span></td>
  <td class="num">${fixed ? escapeHtml(bytes(fixed)) : "—"}</td>
  <td class="num">${delta ? `+${escapeHtml(bytes(delta.addedBytes))}${delta.removedCount ? ` / −${escapeHtml(bytes(delta.removedBytes))}` : ""}` : "—"}</td>
  <td class="num">${usage?.inputTokens !== undefined ? escapeHtml(number(usage.inputTokens ?? 0)) : "—"}</td>
  <td class="num">${usage?.cacheReadTokens !== undefined ? escapeHtml(number(usage.cacheReadTokens ?? 0)) : "—"}</td>
  <td class="num">${typeof total === "number" ? escapeHtml(ms(total)) : "—"}</td>
  <td>${request.payloadStored ? '<span class="pill good">captured</span>' : '<span class="pill">metrics only</span>'}</td>
</tr>`;
    })
    .join("\n");
}

export function renderHtml(model: ReportModel): string {
  const { metrics, totals } = model;
  // Bodies live in this table only; other sections link here by hash.
  const messageCap = 10;
  const tableMessages = model.messages.slice(0, messageCap);
  const bodyHashes = new Set(tableMessages.map((message) => message.hash));
  const cacheRatio =
    metrics.inputTokens + metrics.cacheReadTokens > 0
      ? metrics.cacheReadTokens / (metrics.inputTokens + metrics.cacheReadTokens)
      : null;
  const latest = model.requests.at(-1);
  const latestPayload = latest?.record.analysis?.payloadBytes ?? 0;
  const schemaBytes = latest?.record.analysis?.sections.toolDefinitionBytes ?? 0;
  const systemBytes = latest?.record.analysis?.sections.systemBytes ?? 0;
  const topSections = latest?.record.analysis?.sections
    ? Object.entries(latest.record.analysis.sections)
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1])
    : [];

  const cards = [
    { k: "Requests", v: number(metrics.requestCount), n: `${totals.requestsWithPayload} with captured payload` },
    { k: "Latest payload", v: bytes(latestPayload), n: `~${number(latest?.record.analysis?.approximateTokens ?? 0)} rough tokens` },
    { k: "Fixed overhead", v: bytes(totals.fixedBytes), n: `${percent(latestPayload ? totals.fixedBytes / latestPayload : 0)} of latest — system + tool schemas` },
    { k: "Tool schemas", v: bytes(schemaBytes), n: `${bytes(totals.unusedToolBytes)} never called` },
    { k: "Fresh vs cached", v: `${number(metrics.inputTokens)} / ${number(metrics.cacheReadTokens)}`, n: cacheRatio === null ? "no usage reported" : `${percent(cacheRatio)} of prompt tokens cached` },
    { k: "Duplicate content", v: bytes(totals.duplicateWastedBytes), n: `${totals.duplicateMessages} message(s) present twice in one request` },
    { k: "Unique messages", v: number(model.messages.length), n: `${bytes(totals.uniqueMessageBytes)} embedded once, not per request` },
    { k: "Compactions", v: number(totals.compactionEvents), n: `${totals.cacheInvalidatingEvents} cache-invalidating event(s)` },
  ]
    .map(
      (card) =>
        `<div class="card"><div class="k">${escapeHtml(card.k)}</div><div class="v">${escapeHtml(card.v)}</div><div class="n">${escapeHtml(card.n)}</div></div>`,
    )
    .join("\n");

  const contentBanner = model.embedBodies
    ? `<div class="banner"><strong>This file contains captured payload content.</strong> Message bodies are embedded (truncated per the report limit), so it may include prompt text, source code, tool output and file paths. Nothing here was fetched over the network — the file is self-contained. Store and share it accordingly.</div>`
    : `<div class="banner safe">Message bodies are <strong>not</strong> embedded — previews only, computed from the captured payload. Re-run with full bodies to include readable content.</div>`;

  const missing: string[] = [];
  if (totals.requestsWithoutPayload > 0)
    missing.push(
      `${totals.requestsWithoutPayload} request(s) had no captured payload, so their per-message detail is unavailable (sizes still come from analysis).`,
    );
  if (totals.truncatedMessages > 0)
    missing.push(
      `${totals.truncatedMessages} message(s) exceeded the per-message safety ceiling and are cut, with a note where they are cut.`,
    );
  if (totals.omittedMessages > 0)
    missing.push(
      `${totals.omittedMessages} message(s) were not embedded because the total body budget was spent.`,
    );
  if (!model.embedBodies && model.messages.length > 0)
    missing.push(
      "Message bodies were not embedded at all: rows show previews only. Regenerate without --no-body to expand them.",
    );
  if (totals.hitLimit)
    missing.push("The reader stopped indexing new unique messages at its cap; older content is summarized, not listed.");
  if (totals.skippedLines > 0)
    missing.push(`${totals.skippedLines} log line(s) were not valid JSON and were skipped.`);
  if (totals.duplicateMessages === 0)
    missing.push("No message was found twice inside a single request, so no duplication waste is reported. Prefix re-sends between requests are normal and are not counted as duplication.");
  if (missing.length === 0) missing.push("Nothing was omitted: every request's payload was captured and fully indexed.");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LLM audit — ${escapeHtml(model.sessionId)}</title>
<style>${styles}</style>
</head>
<body>
<main>
<h1>LLM audit report</h1>
<p class="sub">
  Session <span class="mono">${escapeHtml(model.sessionId)}</span>
  ${model.startedAt ? `· started ${escapeHtml(model.startedAt)}` : ""}
  · generated ${escapeHtml(model.generatedAt)}<br />
  <span class="mono">${escapeHtml(model.logPath)}</span><br />
  ${escapeHtml(model.providers.join(", ") || "provider unknown")} · ${escapeHtml(model.models.join(", ") || "model unknown")}
</p>
${contentBanner}
<div class="cards">
${cards}
</div>

${contextWindowSection(model)}

${provenanceSection(model)}

<h2>Tool schema cost</h2>
${
  model.tools.length
    ? `<table><thead><tr><th>Tool</th><th class="num">Schema bytes</th><th class="num">~Tokens</th><th class="num">Calls this session</th><th>Verdict</th></tr></thead><tbody>
${model.tools
  .map(
    (tool) =>
      `<tr><td class="mono">${escapeHtml(tool.name)}</td><td class="num">${escapeHtml(bytes(tool.bytes))}</td><td class="num">${escapeHtml(number(roughTokens(tool.bytes)))}</td><td class="num">${tool.calls}</td><td><span class="pill ${tool.calls ? "good" : "bad"}">${escapeHtml(tool.verdict)}</span></td></tr>`,
  )
  .join("\n")}
<tr><td><strong>total</strong></td><td class="num"><strong>${escapeHtml(bytes(schemaBytes))}</strong></td><td class="num"><strong>${escapeHtml(number(roughTokens(schemaBytes)))}</strong></td><td class="num"></td><td>${escapeHtml(percent(schemaBytes / (latestPayload || 1)))} of the payload</td></tr>
<tr><td>never called</td><td class="num">${escapeHtml(bytes(totals.unusedToolBytes))}</td><td class="num">${escapeHtml(number(roughTokens(totals.unusedToolBytes)))}</td><td class="num">0</td><td>re-sent on every request</td></tr>
</tbody></table>
<p class="muted">Tool schemas are the other half of the fixed per-request cost. Schemas are captured for the latest request only (largest ${model.tools.length}). The never-called row is what per-profile tool pruning would remove.</p>`
    : '<p class="muted">No tool schemas were captured.</p>'
}

<h2>Largest messages</h2>
<p class="muted">The ${number(messageCap)} largest of ${number(model.messages.length)} unique messages, each embedded once. “Re-sent in” is how many requests carried it — every request re-sends the whole conversation, so it is a multiplier on that message's cost, not a count of new content. Tokens are the rough bytes ÷ 4 estimate.</p>
<div class="rows">
${tableMessages.map((message) => messageCard(message, model)).join("\n")}
</div>
${model.messages.length > messageCap ? `<p class="muted">Showing the ${number(messageCap)} largest; the rest are listed per request under Session trends and in full in the JSONL.</p>` : ""}

<h2>Session trends</h2>
<p class="muted">Composition over time. Collapsed because the per-request budget above is usually the actionable part.</p>
<details>
<summary>Growth: payload per request</summary>
${growthChart(model) || '<p class="muted">Not enough requests to plot growth.</p>'}
</details>
<details>
<summary>Every request (${number(metrics.requestCount)})</summary>
<table>
<thead><tr>
  <th class="num">#</th><th class="num">Payload</th><th>Fixed share</th><th class="num">Fixed</th>
  <th class="num">Context delta</th><th class="num">Fresh in</th><th class="num">Cached</th><th class="num">Total</th><th>Content</th>
</tr></thead>
<tbody>
${requestRows(model)}
</tbody>
</table>
</details>
<details>
<summary>What each round-trip added (${model.deltas.length} deltas)</summary>
${
  model.deltas.length
    ? model.deltas
        .filter((delta) => delta.added.length || delta.removedCount)
        .map(
          (delta) => `<details>
<summary>Request #${delta.requestSequence} — +${escapeHtml(bytes(delta.addedBytes))} across ${delta.added.length} message(s)${delta.removedCount ? `, −${escapeHtml(bytes(delta.removedBytes))} (${delta.removedCount} dropped)` : ""}${delta.prefixChanged ? ' <span class="pill bad">prefix changed — cache invalidated</span>' : ""}${delta.afterCompaction ? ' <span class="pill warn">after compaction</span>' : ""}</summary>
<div class="rows">
${delta.added.slice(0, 25).map((message) => deltaRow(message, model, bodyHashes.has(message.hash))).join("\n")}
</div>
${delta.added.length > 25 ? `<p class="muted">…and ${delta.added.length - 25} more, ${escapeHtml(bytes(delta.added.slice(25).reduce((total, message) => total + message.bytes, 0)))}</p>` : ""}
</details>`,
        )
        .join("\n")
    : '<p class="muted">No captured payloads to diff between requests.</p>'
}
</details>
<details>
<summary>Duplicate content</summary>
${
  model.duplicates.length
    ? `<table><thead><tr><th>Role</th><th class="num">Bytes each</th><th class="num">Copies in one request</th><th class="num">Wasted</th><th>Preview</th></tr></thead><tbody>
${model.duplicates
  .map(
    (row) =>
      `<tr><td><span class="pill bad">${escapeHtml(row.message.role)}</span></td><td class="num">${escapeHtml(bytes(row.message.bytes))}</td><td class="num">${row.instances}</td><td class="num">${escapeHtml(bytes(row.wastedBytes))}</td><td class="muted">${escapeHtml(row.message.preview)}</td></tr>`,
  )
  .join("\n")}
</tbody></table>`
    : '<p class="muted">No message appeared twice inside a single request. Prefix re-sends between requests are normal and are not counted as duplication.</p>'
}
</details>

<h2>Composition of the latest request</h2>
<table>
<thead><tr><th>Section</th><th class="num">Bytes</th><th>Share of payload</th></tr></thead>
<tbody>
${
  topSections.length
    ? topSections
        .map(
          ([name, value]) =>
            `<tr><td>${escapeHtml(name)}</td><td class="num">${escapeHtml(bytes(value))}</td><td><span class="bar" style="width:${((value / (latestPayload || 1)) * 100).toFixed(1)}%"></span> <span class="muted mono">${escapeHtml(percent(value / (latestPayload || 1)))}</span></td></tr>`,
        )
        .join("\n")
    : `<tr><td colspan="3" class="muted">No request analysis available.</td></tr>`
}
</tbody>
</table>
<p class="muted">System is ${escapeHtml(bytes(systemBytes))} of fixed context; tool schemas ${escapeHtml(bytes(schemaBytes))} are re-sent on every request. Fixed overhead is ${escapeHtml(bytes(totals.fixedBytes))} and conversation is ${escapeHtml(bytes(totals.variableBytes))}.</p>

<h2>What this report does not show</h2>
<ul class="warnlist">
${missing.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n")}
<li>No raw HTTP response body, request IDs or provider wire chunks exist to read: correlation in the log is FIFO best effort.</li>
<li>Rough token counts use a characters-per-token estimate and are not a provider tokenizer.</li>
</ul>

<footer>
Generated by <span class="mono">llm-audit</span> from <span class="mono">${escapeHtml(model.logPath.split("/").pop() ?? "")}</span>. Self-contained: inline CSS, no scripts, no external requests.
</footer>
</main>
</body>
</html>
`;
}

/**
 * Read a log, analyse it, and write a single self-contained HTML file. Written
 * 0600 because the report quotes prompt text and source code when bodies are
 * embedded.
 */
export async function writeHtmlReport(
  inputPath: string,
  outputPath: string,
  options: { embedBodies?: boolean } = {},
): Promise<{ output: string; bytes: number; model: ReportModel }> {
  const embedBodies = options.embedBodies === true;
  const log = await readAuditLog(inputPath, { embedBodies });
  const model = buildReportModel(log, { embedBodies });
  const html = renderHtml(model);
  await mkdir(join(outputPath, ".."), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, html, { encoding: "utf8", mode: 0o600 });
  return { output: outputPath, bytes: Buffer.byteLength(html), model };
}

/** Default report path for a log: `<session>.report.html` beside the log. */
export function reportPathFor(logPath: string): string {
  return join(
    logPath.replace(/\/[^/]*$/, ""),
    `${basename(logPath).replace(/\.jsonl$/, "")}.report.html`,
  );
}

/**
 * Open a report in the default browser. Best effort: a headless box, a
 * container, or a missing `xdg-open` must not turn a written report into an
 * error, so this reports failure instead of throwing.
 */
export async function openInBrowser(
  path: string,
  options: {
    platform?: NodeJS.Platform;
    run?: (command: string, args: string[]) => Promise<unknown>;
  } = {},
): Promise<{ opened: boolean; detail: string }> {
  const { command, args } =
    (options.platform ?? process.platform) === "darwin"
      ? { command: "open", args: [path] }
      : (options.platform ?? process.platform) === "win32"
        ? { command: "cmd", args: ["/c", "start", "", path] }
        : { command: "xdg-open", args: [path] };
  const run =
    options.run ??
    ((cmd: string, argv: string[]) =>
      promisify(execFile)(cmd, argv, { timeout: 5_000 }));
  try {
    await run(command, args);
    return { opened: true, detail: `opened with ${command}` };
  } catch (error) {
    return {
      opened: false,
      detail: `could not open a browser (${command}: ${error instanceof Error ? error.message : String(error)}) — the file is still written`,
    };
  }
}
