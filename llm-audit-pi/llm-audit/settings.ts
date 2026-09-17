import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AuditController } from "./commands.ts";
import { expandHome } from "./config.ts";
import type { AuditConfig, AuditMode } from "./types.ts";

/**
 * Interactive settings panel built from pi's dialog API (`select` / `confirm` /
 * `input`) rather than a custom TUI component: a handful of dialogs is the
 * smallest thing that makes these settings discoverable, and it needs no
 * rendering code of its own.
 *
 * Edits apply to the running session immediately. Writing them to disk is a
 * separate, explicit action — a one-keystroke switch to `full` capture must not
 * silently make every future session record prompt text and source code. Closing
 * the panel with unsaved edits asks once whether to save them, so the choice is
 * never made silently in either direction.
 */

/** Fields the panel can change, in display order. */
export const SETTING_IDS = [
  "enabled",
  "mode",
  "showStatus",
  "showTurnSummary",
  "retentionDays",
  "logDirectory",
  "excludeProviders",
  "excludeModels",
] as const;

export type SettingId = (typeof SETTING_IDS)[number];

const MODES: AuditMode[] = ["metrics", "redacted", "full"];

/** Pure label builder, so the panel's contents can be asserted in tests. */
export function settingLabel(id: SettingId, config: AuditConfig): string {
  switch (id) {
    case "enabled":
      return `Capture: ${config.enabled ? "enabled" : "disabled"}`;
    case "mode":
      return `Content mode: ${config.mode} (payload ${config.capturePayload ? "stored" : "not stored"})`;
    case "showStatus":
      return `Status line after turns: ${config.showStatus ? "on" : "off"}`;
    case "showTurnSummary":
      return `Turn summary in status line: ${config.showTurnSummary ? "on" : "off"}`;
    case "retentionDays":
      return `Log retention: ${config.retentionDays} day(s)`;
    case "logDirectory":
      return `Log directory: ${config.logDirectory}`;
    case "excludeProviders":
      return `Excluded providers: ${config.excludeProviders.length ? config.excludeProviders.join(", ") : "(none)"}`;
    case "excludeModels":
      return `Excluded models: ${config.excludeModels.length ? config.excludeModels.join(", ") : "(none)"}`;
  }
}

export function configItems(config: AuditConfig): string[] {
  return SETTING_IDS.map((id) => settingLabel(id, config));
}

const SAVE = "Save to config file";
const CLOSE = "Close (keep session changes)";

/** Comma/space separated list entry; empty input clears the list. */
export function parseList(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseRetention(input: string): number | undefined {
  const value = Number(input.trim());
  return Number.isInteger(value) && value >= 0 && value <= 3650
    ? value
    : undefined;
}

async function editSetting(
  id: SettingId,
  controller: AuditController,
  config: AuditConfig,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const patch = (values: Partial<AuditConfig>): void => {
    controller.patchConfig(values);
    // Keep the footer in step while the panel is still open.
    controller.refreshStatus(ctx);
  };
  switch (id) {
    case "enabled": {
      // confirm() answers the question that was asked, so a "yes" to
      // "Disable capture?" must set false — not re-assert the current value.
      const desired = !config.enabled;
      const ok = await ctx.ui.confirm(
        "LLM audit capture",
        desired
          ? "Enable capture for this session?"
          : "Disable capture for this session?",
      );
      if (ok) patch({ enabled: desired });
      return;
    }
    case "mode": {
      const choice = await ctx.ui.select(
        "Content mode",
        MODES.map((mode) =>
          mode === "metrics"
            ? "metrics — sizes and timing only, no content"
            : `${mode} — stores payload content (secrets still redacted)`,
        ),
      );
      const index = MODES.findIndex((mode) => choice?.startsWith(mode));
      if (index === -1) return;
      const mode = MODES[index]!;
      if (mode !== "metrics") {
        const ok = await ctx.ui.confirm(
          `Switch to ${mode}?`,
          "From the next request onward this stores prompt text, source code and tool output in the audit log. Secrets and authentication-like values are still redacted. It is applied to this session now; use Save to make it the default.",
        );
        if (!ok) return;
      }
      patch({ mode, capturePayload: mode !== "metrics" });
      return;
    }
    case "showStatus":
    case "showTurnSummary": {
      const key = id;
      const desired = !config[key];
      const ok = await ctx.ui.confirm(
        key === "showStatus" ? "Status line" : "Turn summary",
        desired ? "Turn this on?" : "Turn this off?",
      );
      if (ok) patch({ [key]: desired } as Partial<AuditConfig>);
      return;
    }
    case "retentionDays": {
      const value = await ctx.ui.input(
        "Log retention in days (0 disables expiry cleanup)",
        String(config.retentionDays),
      );
      if (value === undefined) return;
      const days = parseRetention(value);
      if (days === undefined)
        return ctx.ui.notify(
          `Not a whole number of days between 0 and 3650: ${value}`,
          "warning",
        );
      patch({ retentionDays: days });
      return;
    }
    case "logDirectory": {
      const value = await ctx.ui.input(
        "Log directory",
        config.logDirectory,
      );
      if (value === undefined) return;
      if (!value.trim()) {
        ctx.ui.notify("Log directory cannot be empty.", "warning");
        return;
      }
      patch({ logDirectory: expandHome(value.trim()) });
      return;
    }
    case "excludeProviders":
    case "excludeModels": {
      const key = id;
      const value = await ctx.ui.input(
        key === "excludeProviders"
          ? "Providers to exclude (comma separated, empty to clear)"
          : "Models to exclude (comma separated, empty to clear)",
        config[key].join(", "),
      );
      if (value === undefined) return;
      patch({ [key]: parseList(value) } as Partial<AuditConfig>);
      return;
    }
  }
}

/**
 * The one thing worth warning about: making content capture the default changes
 * what every future session writes to disk.
 */
function captureWarning(config: AuditConfig): string | undefined {
  return config.capturePayload && config.mode !== "metrics"
    ? `Every future session will store payload content (prompt text, source code, tool output) in ${config.logDirectory} until you change this again.`
    : undefined;
}

async function persist(
  controller: AuditController,
  ctx: ExtensionCommandContext,
): Promise<boolean> {
  const result = await controller.saveConfig();
  ctx.ui.notify(
    result.error
      ? `Config not saved: ${result.error}`
      : `Config saved: ${result.path}`,
    result.error ? "error" : "info",
  );
  return result.error === undefined;
}

/** Save from the menu row, which asks about capture separately. */
async function saveFromMenu(
  controller: AuditController,
  ctx: ExtensionCommandContext,
): Promise<boolean> {
  const config = controller.getConfig();
  const warning = captureWarning(config);
  if (warning && !(await ctx.ui.confirm(`Save ${config.mode} capture as the default?`, warning)))
    return false;
  return persist(controller, ctx);
}

export async function runConfigPanel(
  controller: AuditController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  let unsaved = false;
  for (;;) {
    const config = controller.getConfig();
    const items = configItems(config);
    const choice = await ctx.ui.select("llm-audit settings", [
      ...items,
      SAVE,
      CLOSE,
    ]);
    if (choice === undefined || choice === CLOSE) {
      // Closing used to drop edits behind a single notification, which reads as
      // "the setting did not stick": the mode went back to metrics in the next
      // session. Ask instead — with the capture warning folded into this one
      // dialog, so saving never takes more than one answer.
      if (!unsaved) {
        ctx.ui.notify("llm-audit settings closed (nothing changed).", "info");
        return;
      }
      const warning = captureWarning(config);
      const save = await ctx.ui.confirm(
        "Save these settings?",
        `${warning ? `${warning} ` : ""}They already apply to this session. Saving makes them the default for every future session; skipping keeps them for this session only and writes nothing to disk.`,
      );
      if (save && (await persist(controller, ctx))) return;
      ctx.ui.notify(
        "llm-audit settings closed: session only, nothing written to disk. Reopen the panel with /llm-audit config and choose Save to keep them.",
        save ? "warning" : "info",
      );
      return;
    }
    if (choice === SAVE) {
      if (await saveFromMenu(controller, ctx)) unsaved = false;
      continue;
    }
    const index = items.indexOf(choice);
    const id = index === -1 ? undefined : SETTING_IDS[index];
    if (!id) continue;
    const before = JSON.stringify(controller.getConfig());
    await editSetting(id, controller, config, ctx);
    if (JSON.stringify(controller.getConfig()) !== before) unsaved = true;
  }
}
