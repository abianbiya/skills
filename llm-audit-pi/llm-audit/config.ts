import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { AuditConfig, AuditMode } from "./types.ts";

export const DEFAULT_CONFIG: AuditConfig = {
  enabled: true,
  mode: "metrics",
  logDirectory: "~/.pi/agent/logs/llm-audit",
  capturePayload: false,
  captureHeaders: false,
  showStatus: true,
  showTurnSummary: true,
  roughCharactersPerToken: 4,
  maxPayloadBytes: 10 * 1024 * 1024,
  maxFieldBytes: 1024 * 1024,
  retentionDays: 30,
  redactFieldNames: [],
  redactPatterns: [],
  excludeModels: [],
  excludeProviders: [],
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function stringList(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function mode(value: unknown): AuditMode {
  return value === "metrics" || value === "redacted" || value === "full"
    ? value
    : DEFAULT_CONFIG.mode;
}

export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/")
    ? resolve(homedir(), path.slice(2))
    : resolve(path);
}

export function validateConfig(value: unknown): AuditConfig {
  if (!isObject(value))
    return {
      ...DEFAULT_CONFIG,
      logDirectory: expandHome(DEFAULT_CONFIG.logDirectory),
    };
  const candidate = value;
  const config: AuditConfig = {
    enabled: bool(candidate.enabled, DEFAULT_CONFIG.enabled),
    mode: mode(candidate.mode),
    logDirectory:
      typeof candidate.logDirectory === "string" &&
      candidate.logDirectory.trim()
        ? expandHome(candidate.logDirectory)
        : expandHome(DEFAULT_CONFIG.logDirectory),
    capturePayload: bool(
      candidate.capturePayload,
      DEFAULT_CONFIG.capturePayload,
    ),
    captureHeaders: bool(
      candidate.captureHeaders,
      DEFAULT_CONFIG.captureHeaders,
    ),
    showStatus: bool(candidate.showStatus, DEFAULT_CONFIG.showStatus),
    showTurnSummary: bool(
      candidate.showTurnSummary,
      DEFAULT_CONFIG.showTurnSummary,
    ),
    roughCharactersPerToken: numberInRange(
      candidate.roughCharactersPerToken,
      DEFAULT_CONFIG.roughCharactersPerToken,
      1,
      32,
    ),
    maxPayloadBytes: numberInRange(
      candidate.maxPayloadBytes,
      DEFAULT_CONFIG.maxPayloadBytes,
      1024,
      100 * 1024 * 1024,
    ),
    maxFieldBytes: numberInRange(
      candidate.maxFieldBytes,
      DEFAULT_CONFIG.maxFieldBytes,
      256,
      10 * 1024 * 1024,
    ),
    retentionDays: numberInRange(
      candidate.retentionDays,
      DEFAULT_CONFIG.retentionDays,
      0,
      3650,
    ),
    redactFieldNames: stringList(candidate.redactFieldNames, []),
    redactPatterns: stringList(candidate.redactPatterns, []),
    excludeModels: stringList(candidate.excludeModels, []),
    excludeProviders: stringList(candidate.excludeProviders, []),
  };
  config.maxFieldBytes = Math.min(config.maxFieldBytes, config.maxPayloadBytes);
  return config;
}

/**
 * Profile-aware default. The active profile's own `llm-audit.json` wins when it
 * exists, otherwise the shared `~/.pi/agent/llm-audit.json` is used. Without
 * this, per-profile mode/logDirectory settings never took effect, because the
 * path was always the global one.
 */
export function defaultConfigPath(): string {
  const global = expandHome("~/.pi/agent/llm-audit.json");
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  if (!agentDir) return global;
  // Expand `~` here as well as below: an unexpanded env var would resolve
  // against the cwd, so the scoped file would never be found and every load
  // would silently fall back to the shared global config.
  const scoped = resolve(expandHome(agentDir), "llm-audit.json");
  return existsSync(scoped) ? scoped : global;
}

export function loadConfig(path = defaultConfigPath()): {
  config: AuditConfig;
  error?: string;
} {
  try {
    if (!existsSync(path)) return { config: validateConfig({}) };
    return {
      config: validateConfig(JSON.parse(readFileSync(path, "utf8")) as unknown),
    };
  } catch (error) {
    return {
      config: validateConfig({}),
      error: `Invalid llm-audit configuration: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Where a save should go. Unlike {@link defaultConfigPath}, which prefers an
 * existing file, this prefers the active profile so saving from a profile never
 * silently rewrites the shared global config.
 */
export function configPathForSave(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  return agentDir
    ? resolve(expandHome(agentDir), "llm-audit.json")
    : expandHome("~/.pi/agent/llm-audit.json");
}

export interface SaveConfigResult {
  path: string;
  error?: string;
}

/** Every field this extension owns, so a save is deterministic. */
function ownFields(config: AuditConfig): AuditConfig {
  return {
    enabled: config.enabled,
    mode: config.mode,
    logDirectory: config.logDirectory,
    capturePayload: config.capturePayload,
    captureHeaders: config.captureHeaders,
    showStatus: config.showStatus,
    showTurnSummary: config.showTurnSummary,
    roughCharactersPerToken: config.roughCharactersPerToken,
    maxPayloadBytes: config.maxPayloadBytes,
    maxFieldBytes: config.maxFieldBytes,
    retentionDays: config.retentionDays,
    redactFieldNames: config.redactFieldNames,
    redactPatterns: config.redactPatterns,
    excludeModels: config.excludeModels,
    excludeProviders: config.excludeProviders,
  };
}

/**
 * Persist settings, merging over whatever else the file holds.
 *
 * Two safety rules, because this file decides whether prompt text and source code
 * get written to disk: a file we cannot parse is never overwritten (that would
 * silently discard someone's edits), and the result is written 0600 in a 0700
 * directory.
 */
export async function saveConfig(
  patch: Partial<AuditConfig>,
  path = configPathForSave(),
): Promise<SaveConfigResult> {
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      return {
        path,
        error: `could not read the existing config (${error instanceof Error ? error.message : String(error)}); not overwriting`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        path,
        error: `existing config is not valid JSON (${error instanceof Error ? error.message : String(error)}); not overwriting`,
      };
    }
    if (!isObject(parsed))
      return {
        path,
        error: "existing config is not a JSON object; not overwriting",
      };
    existing = parsed;
  }

  const merged = validateConfig({ ...existing, ...patch } as unknown);
  const output = {
    ...existing,
    ...ownFields(merged),
    // keep the user's own spelling (e.g. "~/logs") instead of the expanded path
    ...(typeof patch.logDirectory === "string"
      ? { logDirectory: patch.logDirectory }
      : {}),
  };
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `${JSON.stringify(output, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    return {
      path,
      error: `could not write config: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { path };
}
