import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Attributes the *system* part of a captured payload back to its origins:
 * harness boilerplate, project AGENTS.md, skill metadata, memory files.
 *
 * Why this is tractable: the assembled prompt labels its own blocks. Sections
 * appear as tags or markdown headers (`<project_context>`, `# Agentic profile`,
 * `<available_skills>`, `## MEMORY.md (long-term)`, `## Daily log: …`), the
 * `<available_skills>` block declares each skill's `<location>`, and the memory
 * headers name the files they came from. Measured on a real 24,203-byte system
 * prompt these markers give exact block boundaries, and content matching places
 * every AGENTS.md and memory byte in a named file.
 *
 * What it is not: exact. Content matching is line-based, so attribution carries
 * `matchedLines`/`totalLines` as a confidence signal, and everything unmatched is
 * reported as harness/other rather than quietly spread over the rest.
 */

export type ProvenanceKind =
  | "harness"
  | "project"
  | "agents"
  | "skill"
  | "memory"
  | "other";

export interface ProvenanceBlock {
  label: string;
  kind: ProvenanceKind;
  bytes: number;
  /** The block's own text, so the report can show what it actually says. */
  text?: string;
  /** Set when `text` is not the complete block. */
  textOmitted?: "limit" | "budget";
  /** File this block's content was matched to, when known. */
  source?: string;
  skillName?: string;
  matchedLines?: number;
  totalLines?: number;
  used?: boolean;
  note?: string;
}

export interface ProvenanceGroup {
  kind: ProvenanceKind;
  bytes: number;
  share: number;
}

export interface ProvenanceReport {
  totalBytes: number;
  blocks: ProvenanceBlock[];
  groups: ProvenanceGroup[];
  attributedBytes: number;
  unattributedBytes: number;
  method: string;
}

export interface ProvenanceInput {
  systemText: string;
  /** Non-system message text, used to judge whether a skill was ever loaded. */
  conversationText?: string[];
  agentDir?: string;
  cwd?: string;
  memoryDir?: string;
  /** Extra files to consider when matching prose blocks (AGENTS.md and friends). */
  candidates?: string[];
}

const MIN_LINE = 20;
const MAX_FILE_BYTES = 200_000;
/** Bound how much block text is carried into a report. */
const MAX_BLOCK_TEXT = 32 * 1024;
const MAX_TOTAL_BLOCK_TEXT = 256 * 1024;

const normalize = (text: string): string => text.replace(/\s+/g, " ");

export function formatProvenance(report: ProvenanceReport): string {
  const total = report.totalBytes || 1;
  const bar = (share: number): string => {
    const width = Math.round(share * 18);
    return "▍".repeat(Math.max(share > 0 ? 1 : 0, width)).padEnd(18, " ");
  };
  const lines = [
    `system prompt ${report.totalBytes.toLocaleString()} B | attributed ${report.attributedBytes.toLocaleString()} B (${Math.round((report.attributedBytes / total) * 100)}%)`,
    "",
  ];
  for (const group of report.groups)
    lines.push(
      `  ${bar(group.share)} ${(group.share * 100).toFixed(1).padStart(5)}%  ${group.bytes.toLocaleString().padStart(8)} B  ${group.kind}`,
    );
  lines.push("", "blocks:");
  for (const block of report.blocks) {
    const conf =
      block.matchedLines === undefined
        ? ""
        : ` (${block.matchedLines}/${block.totalLines} lines)`;
    const flag =
      block.kind === "skill" && block.used === false
        ? "  [not loaded]"
        : block.kind === "memory"
          ? "  [every request]"
          : "";
    lines.push(
      `  ${String(block.bytes).padStart(8)} B  ${block.label.slice(0, 40).padEnd(42)}${flag}${conf}`,
    );
    if (block.source) lines.push(`            ${block.source}`);
  }
  const unused = report.blocks.filter(
    (block) => block.kind === "skill" && block.used === false,
  );
  if (unused.length)
    lines.push(
      "",
      `${unused.reduce((sum, block) => sum + block.bytes, 0).toLocaleString()} B of skill metadata was not loaded in this session.`,
    );
  return lines.join("\n");
}

interface Marker {
  offset: number;
  label: string;
}

/**
 * Lines that start a labelled block. The label keeps its original `#`s so the
 * header text alone identifies the source (a plain word like "Memory" is far too
 * ambiguous to classify on).
 */
const MARKER = /^(?:<[a-z][a-z0-9_]*>|#{1,3} \S.*)$/;

function findMarkers(text: string): Marker[] {
  const markers: Marker[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (MARKER.test(trimmed)) markers.push({ offset, label: trimmed });
    offset += line.length + 1;
  }
  return markers;
}

function candidatesFor(input: ProvenanceInput): string[] {
  const paths: string[] = [];
  const add = (path: string | undefined): void => {
    if (path && existsSync(path) && !paths.includes(path)) paths.push(path);
  };
  for (const path of input.candidates ?? []) add(path);
  add(input.agentDir ? join(input.agentDir, "AGENTS.md") : undefined);
  let dir = input.cwd ? resolve(input.cwd) : undefined;
  for (let depth = 0; dir && depth < 4; depth++) {
    add(join(dir, "AGENTS.md"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return paths;
}

interface MatchResult {
  source: string;
  matchedLines: number;
  totalLines: number;
}

function readLines(path: string): string[] | undefined {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return undefined;
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length >= MIN_LINE);
  } catch {
    return undefined;
  }
}

/** Line-based match of text against a file: robust to whitespace reflow. */
function matchFile(text: string, path: string): MatchResult | undefined {
  const lines = readLines(path);
  if (!lines || lines.length === 0) return undefined;
  const haystack = normalize(text);
  let matched = 0;
  for (const line of lines) if (haystack.includes(normalize(line).trim())) matched++;
  if (matched === 0) return undefined;
  // One incidental line is noise; require a meaningful share of the file.
  if (matched < 2 && lines.length > 2) return undefined;
  return { source: path, matchedLines: matched, totalLines: lines.length };
}

function bestMatch(text: string, candidates: string[]): MatchResult | undefined {
  let best: MatchResult | undefined;
  for (const path of candidates) {
    const match = matchFile(text, path);
    if (match && (!best || match.matchedLines > best.matchedLines)) best = match;
  }
  return best;
}

function classify(label: string): ProvenanceKind {
  if (label.startsWith("<available_skills")) return "skill";
  if (label.startsWith("<project_context")) return "project";
  if (/^#{1,3} (Memory|Scratchpad)$/i.test(label)) return "memory";
  if (/^#{1,3} (MEMORY|SCRATCHPAD)\.md/i.test(label)) return "memory";
  if (/^#{1,3} Daily log/i.test(label)) return "memory";
  return "other";
}

/** Map a memory block header to the file it came from. */
function memorySource(label: string, memoryDir: string): string | undefined {
  const daily = label.match(/^#{1,3} Daily log: (\d{4}-\d{2}-\d{2})/);
  if (daily) return join(memoryDir, "daily", `${daily[1]}.md`);
  if (/^#{1,3} MEMORY\.md/i.test(label)) return join(memoryDir, "MEMORY.md");
  if (/^#{1,3} SCRATCHPAD\.md/i.test(label))
    return join(memoryDir, "SCRATCHPAD.md");
  return undefined;
}

/**
 * A skill counts as loaded only when the session actually pulled the file in —
 * matching its name against the conversation reports every skill as used, since
 * names appear in conversation for many unrelated reasons.
 */
function skillWasLoaded(location: string | undefined, conversation: string): boolean {
  if (!location) return false;
  if (conversation.includes(normalize(location))) return true;
  const lines = readLines(location);
  if (!lines || lines.length === 0) return false;
  let matched = 0;
  for (const line of lines) {
    if (conversation.includes(normalize(line).trim())) {
      matched++;
      if (matched >= 2) return true;
    }
  }
  return false;
}

interface SkillsBlock {
  blocks: ProvenanceBlock[];
  texts: Map<ProvenanceBlock, string>;
  start: number;
  end: number;
}

function skillBlocks(
  text: string,
  conversation: string,
): SkillsBlock | undefined {
  const open = text.indexOf("<available_skills>");
  if (open === -1) return undefined;
  const close = text.indexOf("</available_skills>");
  const end = close === -1 ? text.length : close + "</available_skills>".length;
  const block = text.slice(open, end);
  const blocks: ProvenanceBlock[] = [];
  const texts = new Map<ProvenanceBlock, string>();
  for (const entry of block.matchAll(/<skill>([\s\S]*?)<\/skill>/g)) {
    const body = entry[1] ?? "";
    const name = body.match(/<name>([^<]*)<\/name>/)?.[1]?.trim() ?? "unnamed";
    const location = body.match(/<location>([^<]*)<\/location>/)?.[1]?.trim();
    const used = skillWasLoaded(location, conversation);
    const item: ProvenanceBlock = {
      label: `skill: ${name}`,
      kind: "skill",
      bytes: Buffer.byteLength(entry[0], "utf8"),
      text: entry[0],
      skillName: name,
      ...(location ? { source: location } : {}),
      used,
      ...(used ? {} : { note: "not loaded in this session" }),
    };
    blocks.push(item);
    texts.set(item, entry[0]);
  }
  const covered = blocks.reduce((total, item) => total + item.bytes, 0);
  if (block.length - covered > 100) {
    const wrapperText = block.slice(0, Math.max(0, block.length - covered));
    const wrapper: ProvenanceBlock = {
      label: "<available_skills> wrapper",
      kind: "skill",
      bytes: block.length - covered,
      text: wrapperText,
    };
    blocks.push(wrapper);
    texts.set(wrapper, wrapperText);
  }
  return { blocks, texts, start: open, end };
}

export function analyzeProvenance(input: ProvenanceInput): ProvenanceReport {
  const text = input.systemText;
  const totalBytes = Buffer.byteLength(text, "utf8");
  const candidates = candidatesFor(input);
  const memoryDir = input.memoryDir ?? join(homedir(), ".pi", "agent", "memory");
  const conversation = normalize((input.conversationText ?? []).join("\n"));
  // Block text is what makes the report readable ("show me what this block says"),
  // so it is kept but bounded: a pathological prompt must not balloon the file.
  let textBudget = MAX_TOTAL_BLOCK_TEXT;
  const attachText = (block: ProvenanceBlock, body: string): void => {
    if (textBudget <= 0) {
      block.textOmitted = "budget";
      return;
    }
    if (body.length > MAX_BLOCK_TEXT) {
      block.text = body.slice(0, MAX_BLOCK_TEXT);
      block.textOmitted = "limit";
      textBudget -= MAX_BLOCK_TEXT;
      return;
    }
    block.text = body;
    textBudget -= body.length;
  };

  const skills = skillBlocks(text, conversation);
  const blocks: ProvenanceBlock[] = [];
  /** Block text, kept so confidence can be recomputed per source at the end. */
  const texts = new Map<ProvenanceBlock, string>();
  const markers = findMarkers(text);

  const head = text.slice(0, markers[0]?.offset ?? text.length);
  if (head.trim()) {
    const block: ProvenanceBlock = {
      label: "harness base prompt",
      kind: "harness",
      bytes: Buffer.byteLength(head, "utf8"),
    };
    attachText(block, head);
    blocks.push(block);
    texts.set(block, head);
  }

  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index]!;
    const end = markers[index + 1]?.offset ?? text.length;
    // Inside <available_skills> every <skill> line is a marker; those entries are
    // already emitted per skill, so skip anything in that range.
    if (skills && marker.offset >= skills.start && marker.offset < skills.end) {
      if (marker.offset === skills.start)
        for (const item of skills.blocks) {
          blocks.push(item);
          texts.set(item, skills.texts.get(item) ?? item.label);
        }
      continue;
    }
    const body = text.slice(marker.offset, end);
    const kind = classify(marker.label);
    const block: ProvenanceBlock = {
      label: marker.label,
      kind,
      bytes: Buffer.byteLength(body, "utf8"),
    };
    attachText(block, body);
    if (kind === "memory") {
      const source = memorySource(marker.label, memoryDir);
      if (source) {
        block.source = source;
        block.note = "re-injected into every request";
      }
    }
    blocks.push(block);
    texts.set(block, body);
  }

  // Confidence per source, not per block: a file's lines are spread across
  // several blocks (AGENTS.md contributes three sections), so matching each block
  // in isolation under-reports how much of the file is present.
  const bySource = new Map<string, ProvenanceBlock[]>();
  for (const block of blocks)
    if (block.source)
      bySource.set(block.source, [...(bySource.get(block.source) ?? []), block]);
  for (const [source, group] of bySource) {
    const combined = group.map((block) => texts.get(block) ?? "").join("\n");
    const match = matchFile(combined, source) ?? bestMatch(combined, candidates);
    if (!match) {
      // A skill's location is declared by the prompt itself, so keep it: that is
      // stated provenance, not an inference. Anything else must be substantiated
      // before we attribute bytes to a file.
      const declared = group.every((block) => block.kind === "skill");
      if (!declared)
        for (const block of group) delete block.source;
      continue;
    }
    for (const block of group) {
      block.matchedLines = match.matchedLines;
      block.totalLines = match.totalLines;
    }
  }
  // Unlabelled prose (no header, no path) is still worth attributing if it is
  // verbatim from AGENTS.md.
  for (const block of blocks) {
    if (block.source || block.kind === "skill" || block.kind === "memory") continue;
    const match = bestMatch(texts.get(block) ?? "", candidates);
    if (match) {
      block.source = match.source;
      block.matchedLines = match.matchedLines;
      block.totalLines = match.totalLines;
      if (block.kind === "other" || block.kind === "harness")
        block.kind = "agents";
    }
  }

  const attributedBytes = blocks
    .filter((block) => block.source !== undefined)
    .reduce((total, block) => total + block.bytes, 0);
  const byKind = new Map<ProvenanceKind, number>();
  for (const block of blocks)
    byKind.set(block.kind, (byKind.get(block.kind) ?? 0) + block.bytes);
  const groups: ProvenanceGroup[] = [...byKind.entries()]
    .map(([kind, bytes]) => ({ kind, bytes, share: bytes / (totalBytes || 1) }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    totalBytes,
    blocks,
    groups,
    attributedBytes,
    unattributedBytes: totalBytes - attributedBytes,
    method:
      "Block boundaries come from the prompt's own tags and headers; file attribution is line-based content matching, so matched/total lines is a confidence signal, not proof.",
  };
}
