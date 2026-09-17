import { appendFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { AuditConfig, AuditRecord, JsonValue } from "./types.ts";

const safeName = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "unknown-session";

export class AuditLogger {
  readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();
  private failures: string[] = [];

  constructor(
    private readonly config: AuditConfig,
    sessionId: string,
  ) {
    this.filePath = join(
      resolve(config.logDirectory),
      `${safeName(sessionId)}.jsonl`,
    );
  }

  write(record: AuditRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    this.queue = this.queue.then(async () => {
      try {
        await mkdir(this.config.logDirectory, { recursive: true, mode: 0o700 });
        await appendFile(this.filePath, line, {
          encoding: "utf8",
          mode: 0o600,
          flag: "a",
        });
      } catch (error) {
        this.failures.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    });
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  getFailures(): readonly string[] {
    return this.failures;
  }

  async cleanExpired(): Promise<number> {
    const root = resolve(this.config.logDirectory);
    // retentionDays 0 disables expiry cleanup (the settings panel and docs
    // promise this); without the guard, the cutoff would be "now" and every
    // log would expire immediately.
    if (this.config.retentionDays <= 0) return 0;
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const candidate = resolve(root, entry.name);
        if (
          !candidate.startsWith(`${root}/`) ||
          basename(candidate) !== entry.name
        )
          continue;
        if ((await stat(candidate)).mtimeMs < cutoff) {
          await rm(candidate, { force: true });
          deleted++;
        }
      }
    } catch (error) {
      this.failures.push(
        error instanceof Error ? error.message : String(error),
      );
    }
    return deleted;
  }
}

export function recordJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
