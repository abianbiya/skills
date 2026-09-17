import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  buildReportModel,
  openInBrowser,
  provenanceForLog,
  renderHtml,
  reportPathFor,
  writeHtmlReport,
} from "./html.ts";
import { listSessions, readAuditLog } from "./logs.ts";
import { formatProvenance } from "./provenance.ts";
import {
  buildExport,
  formatComparison,
  lastRequestSummary,
  markdownReport,
  sessionStatus,
  summarizeExport,
  toolSchemaSummary,
} from "./reporter.ts";
import { runConfigPanel } from "./settings.ts";
import type { AuditConfig, AuditExport, SessionMetrics } from "./types.ts";

/**
 * One command with subcommands, rather than a command per action.
 *
 * The flat surface this replaces had 14 registrations, including a `mode` and a
 * `capture` that overlapped confusingly (`mode full` stored nothing, because
 * content capture is a second switch). Everything is reachable as
 * `/llm-audit <subcommand>`, with tab completion per position.
 */

export interface AuditController {
  getMetrics(): SessionMetrics;
  /** Effective config, including the live session `enabled` flag. */
  getConfig(): AuditConfig;
  /** Apply settings to this session only; nothing is written to disk. */
  patchConfig(patch: Partial<AuditConfig>): void;
  /** Re-render the status-line entry from current state. */
  refreshStatus(ctx: ExtensionContext): void;
  saveConfig(): Promise<{ path: string; error?: string }>;
  getLogPath(): string;
  getLogDirectory(): string;
  getSessionId(): string;
  clean(): Promise<number>;
}

const MODES = ["metrics", "redacted", "full"] as const;
const HTML_FLAGS = ["--no-body", "--no-open"];

export const SUBCOMMANDS: Record<string, string> = {
  status: "session state and metrics (default)",
  sessions: "list recent session logs with request and payload counts",
  sources: "where the system prompt's bytes come from: sources <session>|latest",
  on: "enable capture for this session",
  off: "disable capture for this session",
  toggle: "flip capture for this session",
  capture: "set content mode: capture <metrics|redacted|full>",
  config: "interactive settings panel",
  tools: "per-tool schema cost with call counts",
  last: "breakdown of the last request",
  html: "write and open an HTML report: html <session|path> [--no-body] [--no-open]",
  report: "write a Markdown report",
  export: "write normalized JSON and CSV exports",
  baseline: "save this session as the comparison baseline",
  compare: "compare against the baseline: compare [file]",
  clean: "delete expired logs",
  help: "this list",
};

const usage = (): string =>
  Object.entries(SUBCOMMANDS)
    .map(([name, description]) => `  ${name} — ${description}`)
    .join("\n");

function notify(
  ctx: ExtensionCommandContext,
  message: string,
  type: "info" | "warning" | "error" = "info",
): void {
  if (ctx.hasUI) ctx.ui.notify(message, type);
  else console.log(message);
}

const baselinePath = (directory: string): string =>
  join(directory, "baseline.export.json");

/**
 * `/llm-audit compare` reads a path the caller supplies, so validate the shape
 * before summarizing it; a JSON file of the wrong shape must not throw.
 */
function isAuditExport(value: unknown): value is AuditExport {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { session?: unknown; requests?: unknown };
  return (
    Array.isArray(candidate.requests) &&
    typeof candidate.session === "object" &&
    candidate.session !== null
  );
}

/**
 * Resolve which log a subcommand should read. There is deliberately no
 * "newest file in the directory" fallback: silently reporting a different
 * session than the one asked for is worse than an error that points at
 * `/llm-audit sessions`.
 */
async function resolveLogPath(
  directory: string,
  target: string,
  sessionId: string,
): Promise<string | undefined> {
  if (target && target !== "latest") {
    const direct = target.startsWith("/") ? target : join(directory, target);
    const candidate = direct.endsWith(".jsonl") ? direct : `${direct}.jsonl`;
    return existsSync(candidate) ? candidate : undefined;
  }
  const own = join(directory, `${sessionId}.jsonl`);
  return existsSync(own) ? own : undefined;
}

function csv(metrics: SessionMetrics): string {
  const header = [
    "requestSequence",
    "userTurn",
    "provider",
    "model",
    "payloadBytes",
    "roughTokens",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "totalCost",
    "requestDurationMs",
  ].join(",");
  const rows = metrics.requests.map((request) => {
    const usage = metrics.usages.get(request.requestSequence);
    return [
      request.requestSequence,
      request.userTurn,
      request.provider ?? "",
      request.model ?? "",
      request.analysis.payloadBytes,
      request.analysis.approximateTokens,
      usage?.usage.inputTokens ?? "",
      usage?.usage.outputTokens ?? "",
      usage?.usage.cacheReadTokens ?? "",
      usage?.usage.totalCost ?? "",
      usage?.timing.totalRequestMs ?? "",
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(",");
  });
  return `${header}\n${rows.join("\n")}\n`;
}

type Subcommand = (
  args: string,
  ctx: ExtensionCommandContext,
) => Promise<void> | void;

function buildSubcommands(
  controller: AuditController,
): Record<string, Subcommand> {
  const writeOutput = async (
    ctx: ExtensionCommandContext,
    extension: string,
    content: string,
    label: string,
  ): Promise<void> => {
    const directory = controller.getLogDirectory();
    const base = controller
      .getMetrics()
      .sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const output = join(directory, `${base}.${extension}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(output, content, { encoding: "utf8", mode: 0o600 });
    notify(ctx, `${label}: ${output}`);
  };

  const capture = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const value = args.trim();
    if (!value)
      return notify(
        ctx,
        `Capture: ${controller.getConfig().enabled ? "enabled" : "disabled"}, mode ${controller.getConfig().mode}.\nusage: /llm-audit capture ${MODES.join("|")}`,
      );
    if (!MODES.includes(value as (typeof MODES)[number]))
      return notify(
        ctx,
        `Usage: /llm-audit capture ${MODES.join("|")}`,
        "warning",
      );
    const mode = value as (typeof MODES)[number];
    controller.patchConfig({ mode, capturePayload: mode !== "metrics" });
    return notify(
      ctx,
      mode === "metrics"
        ? "llm-audit: metrics mode, payload capture off — no content is stored."
        : `llm-audit: ${mode} mode from the next request onward. This stores prompt text, source code and tool output (secrets are still redacted) in ${controller.getLogDirectory()}. Generate a report with /llm-audit html. Session-only: use /llm-audit config to save it as the default.`,
      mode === "metrics" ? "info" : "warning",
    );
  };

  const html = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    // Bodies are embedded by default: the log already holds this content, and a
    // report you cannot expand is not worth opening. --no-body keeps a
    // size-only report for sharing.
    const embedBodies = !parts.includes("--no-body");
    const shouldOpen = !parts.includes("--no-open");
    const target = parts.find((part) => !part.startsWith("--")) ?? "latest";
    const path = await resolveLogPath(
      controller.getLogDirectory(),
      target,
      controller.getSessionId(),
    );
    if (!path)
      return notify(
        ctx,
        `No audit log for ${target === "latest" ? "this session" : `"${target}"`} in ${controller.getLogDirectory()}.\nThis session has not written a log yet, or the id is wrong. List candidates with /llm-audit sessions.`,
        "warning",
      );
    let report: { output: string; bytes: number };
    try {
      report = await writeHtmlReport(path, reportPathFor(path), {
        embedBodies,
      });
    } catch (error) {
      return notify(
        ctx,
        `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
    const size = `${Math.round(report.bytes / 1024)} KiB${embedBodies ? ", full message bodies" : ", previews only"}`;
    if (!shouldOpen)
      return notify(ctx, `LLM audit HTML report (${size}): ${report.output}`);
    const opened = await openInBrowser(report.output);
    return notify(
      ctx,
      opened.opened
        ? `LLM audit HTML report (${size}) — ${opened.detail}: ${report.output}`
        : `LLM audit HTML report (${size}): ${report.output}\n${opened.detail}`,
    );
  };

  const compare = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const directory = controller.getLogDirectory();
    const file = args.trim() || baselinePath(directory);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      return notify(
        ctx,
        `No baseline export at ${file}. Run /llm-audit baseline first, or pass a path.`,
        "warning",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return notify(ctx, `Not valid JSON: ${file}`, "error");
    }
    if (!isAuditExport(parsed))
      return notify(
        ctx,
        `${file} is not an llm-audit export (expected session and requests).`,
        "error",
      );
    notify(
      ctx,
      formatComparison(
        summarizeExport(parsed),
        summarizeExport(buildExport(controller.getMetrics())),
      ),
    );
  };

  return {
    status: (_args, ctx) =>
      notify(
        ctx,
        `llm-audit ${controller.getConfig().enabled ? "on" : "off"} | ${controller.getConfig().mode} | ${controller.getLogPath()}\n${sessionStatus(controller.getMetrics())}`,
      ),
    on: (_args, ctx) => {
      controller.patchConfig({ enabled: true });
      notify(ctx, "llm-audit enabled for this session");
    },
    off: (_args, ctx) => {
      controller.patchConfig({ enabled: false });
      notify(ctx, "llm-audit disabled for this session");
    },
    toggle: (_args, ctx) => {
      const enabled = !controller.getConfig().enabled;
      controller.patchConfig({ enabled });
      notify(ctx, `llm-audit ${enabled ? "enabled" : "disabled"} for this session`);
    },
    capture,
    config: (_args, ctx) => runConfigPanel(controller, ctx),
    sessions: async (_args, ctx) => {
      const directory = controller.getLogDirectory();
      const sessions = await listSessions(directory);
      if (sessions.length === 0)
        return notify(ctx, `No session logs in ${directory}.`, "warning");
      const lines = sessions.map((session) => {
        const when = (session.startedAt ?? new Date(session.mtimeMs).toISOString()).slice(0, 16).replace("T", " ");
        const size = `${(session.bytes / 1024 / 1024).toFixed(1)} MiB`;
        const payload = session.payloads > 0 ? `${session.payloads} payloads` : "no payloads";
        const project = session.cwd ? ` ${session.cwd.split("/").slice(-1)[0]}/` : "";
        return `  ${session.id}  ${when}  ${String(session.requests).padStart(4)}${session.complete ? "" : "+"} req  ${payload}  ${size}${project}`;
      });
      return notify(
        ctx,
        `sessions in ${directory} (newest first; + means the scan budget cut the count):\n${lines.join("\n")}\n\nreport one with: /llm-audit html <id>   |   attribute it with: /llm-audit sources <id>`,
      );
    },
    sources: async (args, ctx) => {
      const target = args.trim().split(/\s+/).filter(Boolean)[0] ?? "latest";
      const path = await resolveLogPath(controller.getLogDirectory(), target, controller.getSessionId());
      if (!path)
        return notify(
          ctx,
          `No audit log for ${target === "latest" ? "this session" : `"${target}"`}. List candidates with /llm-audit sessions.`,
          "warning",
        );
      try {
        const log = await readAuditLog(path, { embedBodies: true });
        const provenance = provenanceForLog(log, [...log.messages.values()]);
        if (!provenance)
          return notify(
            ctx,
            `No system prompt captured in ${path.split("/").pop()} — payload capture was off, so there is nothing to attribute. Enable it with /llm-audit capture full.`,
            "warning",
          );
        return notify(ctx, formatProvenance(provenance));
      } catch (error) {
        return notify(ctx, `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
    tools: (_args, ctx) => notify(ctx, toolSchemaSummary(controller.getMetrics())),
    last: (_args, ctx) => {
      const request = controller.getMetrics().requests.at(-1);
      notify(
        ctx,
        request
          ? lastRequestSummary(request, controller.getMetrics())
          : "No LLM request captured yet.",
      );
    },
    html,
    report: (_args, ctx) =>
      writeOutput(
        ctx,
        "report.md",
        markdownReport(controller.getMetrics()),
        "LLM audit report",
      ),
    export: async (_args, ctx) => {
      await writeOutput(
        ctx,
        "export.json",
        `${JSON.stringify(buildExport(controller.getMetrics()), null, 2)}\n`,
        "Exported JSON",
      );
      await writeOutput(
        ctx,
        "export.csv",
        csv(controller.getMetrics()),
        "Exported CSV",
      );
    },
    baseline: async (_args, ctx) => {
      // Fixed path: `compare` looks here without an argument.
      const directory = controller.getLogDirectory();
      const output = baselinePath(directory);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        output,
        `${JSON.stringify(buildExport(controller.getMetrics()), null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      notify(ctx, `llm-audit baseline saved: ${output}`);
    },
    compare,
    clean: async (_args, ctx) =>
      notify(
        ctx,
        `Removed ${await controller.clean()} expired audit log file(s).`,
      ),
    help: (_args, ctx) =>
      notify(ctx, `llm-audit subcommands:\n${usage()}`),
  };
}

/** Split a typed line into its subcommand and the rest. */
export function splitInvocation(args: string): {
  name: string;
  rest: string;
} {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  return { name: parts[0] ?? "status", rest: parts.slice(1).join(" ") };
}

export function registerCommands(
  pi: ExtensionAPI,
  controller: AuditController,
): void {
  const subcommands = buildSubcommands(controller);
  pi.registerCommand("llm-audit", {
    description:
      "LLM context audit: status, on|off, capture <mode>, config, tools, last, html, report, export, baseline, compare, clean",
    getArgumentCompletions: (prefix) => {
      const text = prefix.trimStart();
      const space = text.indexOf(" ");
      if (space === -1) {
        const names = Object.keys(subcommands).filter((name) =>
          name.startsWith(text),
        );
        return names.length === 0
          ? null
          : names.map((name) => ({
              value: name,
              label: `${name} — ${SUBCOMMANDS[name] ?? ""}`,
            }));
      }
      const name = text.slice(0, space);
      const rest = text.slice(space + 1).trimStart();
      const values =
        name === "capture"
          ? [...MODES]
          : name === "html"
            ? ["latest", ...HTML_FLAGS]
            : name === "sources"
              ? ["latest"]
              : [];
      const matches = values.filter((value) => value.startsWith(rest));
      return matches.length === 0
        ? null
        : matches.map((value) => ({
            value: `${name} ${value}`,
            label: value,
          }));
    },
    handler: async (args, ctx) => {
      const { name, rest } = splitInvocation(args);
      const subcommand = subcommands[name];
      if (!subcommand) {
        notify(ctx, `Unknown subcommand "${name}".\n${usage()}`, "warning");
        return;
      }
      await subcommand(rest, ctx);
      // The footer reflects mode/state immediately rather than after the next
      // completed turn (the commands above can change both).
      controller.refreshStatus(ctx);
    },
  });
}
