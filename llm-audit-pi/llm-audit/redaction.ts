import type { AuditConfig, JsonObject, JsonValue } from "./types.ts";

const SECRET_KEY =
  /(?:^|[_-])(api[_-]?key|secret|token|password|passwd|authorization|cookie|set-cookie|private[_-]?key|credential|database[_-]?url|connection[_-]?string)(?:$|[_-])/i;
const SECRET_TEXT = [
  /(?:bearer\s+)[a-z0-9._~+\/=:-]{12,}/gi,
  /\b(?:sk|rk|pk|AIza|ghp|github_pat|xox[baprs])[-_a-zA-Z0-9]{12,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/gi,
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*[^\s]+/g,
];
const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";

export interface SafeCloneResult {
  value: JsonValue;
  truncated: boolean;
  redacted: boolean;
}

function bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function truncateText(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (bytes(text) <= maxBytes) return { text, truncated: false };
  let end = Math.max(
    0,
    Math.floor(text.length * (maxBytes / Math.max(bytes(text), 1))),
  );
  while (end > 0 && bytes(text.slice(0, end) + TRUNCATED) > maxBytes) end--;
  return { text: text.slice(0, end) + TRUNCATED, truncated: true };
}

function compilePatterns(config: AuditConfig): RegExp[] {
  const patterns = [...SECRET_TEXT];
  for (const source of config.redactPatterns) {
    try {
      patterns.push(new RegExp(source, "gi"));
    } catch {
      // Invalid user patterns are ignored; startup remains safe.
    }
  }
  return patterns;
}

export function isSensitiveField(name: string, config: AuditConfig): boolean {
  return (
    SECRET_KEY.test(name) ||
    config.redactFieldNames.some(
      (field) => field.toLowerCase() === name.toLowerCase(),
    )
  );
}

export function redactHeaders(
  headers: Record<string, unknown>,
  config: AuditConfig,
): JsonObject {
  const result: JsonObject = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name] = isSensitiveField(name, config)
      ? REDACTED
      : redactValue(value, config, true).value;
  }
  return result;
}

export function redactValue(
  value: unknown,
  config: AuditConfig,
  redactText = true,
): SafeCloneResult {
  const patterns = compilePatterns(config);
  const seen = new WeakSet<object>();
  let budget = config.maxPayloadBytes;
  let wasTruncated = false;
  let wasRedacted = false;

  const visit = (input: unknown, key = "", depth = 0): JsonValue => {
    if (isSensitiveField(key, config)) {
      wasRedacted = true;
      return REDACTED;
    }
    if (input === null) return null;
    if (typeof input === "string") {
      let text = input;
      if (redactText) {
        for (const pattern of patterns) {
          const next = text.replace(pattern, REDACTED);
          if (next !== text) wasRedacted = true;
          text = next;
        }
      }
      const clipped = truncateText(
        text,
        Math.min(config.maxFieldBytes, Math.max(64, budget)),
      );
      budget -= bytes(clipped.text);
      wasTruncated ||= clipped.truncated || budget < 0;
      return clipped.text;
    }
    if (typeof input === "number")
      return Number.isFinite(input) ? input : String(input);
    if (typeof input === "boolean") return input;
    if (typeof input === "bigint") return input.toString();
    if (typeof input === "undefined") return "[undefined]";
    if (typeof input === "function" || typeof input === "symbol")
      return `[${typeof input}]`;
    if (input instanceof Date) return input.toISOString();
    if (depth >= 30) {
      wasTruncated = true;
      return TRUNCATED;
    }
    if (typeof input === "object") {
      if (seen.has(input)) return "[Circular]";
      seen.add(input);
      if (Array.isArray(input)) {
        const result: JsonValue[] = [];
        for (
          let index = 0;
          index < input.length && index < 10_000 && budget > 0;
          index++
        )
          result.push(visit(input[index], "", depth + 1));
        if (input.length > result.length) {
          wasTruncated = true;
          result.push(TRUNCATED);
        }
        return result;
      }
      const result: JsonObject = {};
      for (const [childKey, child] of Object.entries(
        input as Record<string, unknown>,
      )) {
        if (budget <= 0) {
          wasTruncated = true;
          result[TRUNCATED] = true;
          break;
        }
        result[childKey] = visit(child, childKey, depth + 1);
      }
      return result;
    }
    return String(input);
  };

  return {
    value: visit(value),
    truncated: wasTruncated,
    redacted: wasRedacted,
  };
}

export function safeJsonBytes(
  value: unknown,
  config: AuditConfig,
): { bytes: number; truncated: boolean } {
  const clone = redactValue(value, config, false);
  return {
    bytes: bytes(JSON.stringify(clone.value)),
    truncated: clone.truncated,
  };
}
