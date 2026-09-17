/**
 * Minimal Markdown → HTML for report content.
 *
 * Rendered at generation time (Node side) rather than in the browser, so the
 * report stays script-free: opening it still cannot contact anything. The input
 * is untrusted — it is captured prompt text, source code and tool output — so
 * every line is HTML-escaped first and only then has inline patterns applied to
 * the escaped text. Nothing here can reintroduce a tag.
 *
 * Deliberately a subset: headings, fenced code, lists, blockquotes, rules, inline
 * code, bold, italics and links. Enough to read a prompt or a diff comfortably,
 * small enough to audit.
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Only these schemes may become links; anything else stays visible text. */
const SAFE_URL = /^(https?:\/\/|mailto:|#|\/)/i;

function inline(escaped: string): string {
  return (
    escaped
      // `code` first: its contents must not have emphasis or links applied.
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) =>
        SAFE_URL.test(url)
          ? `<a href="${url}" rel="noreferrer noopener">${label}</a>`
          : match,
      )
  );
}

export function renderMarkdown(input: string): string {
  const lines = input.split("\n");
  const out: string[] = [];
  let index = 0;
  let listType: "ul" | "ol" | undefined;
  let inCode = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = undefined;
    }
  };
  const flushCode = (): void => {
    const language = codeLanguage
      ? `<div class="code-lang">${escapeHtml(codeLanguage)}</div>`
      : "";
    out.push(
      `<pre class="md-code">${language}<code>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
    );
    codeLines = [];
    codeLanguage = "";
  };

  for (; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        closeList();
        inCode = true;
        codeLanguage = fence[1] ?? "";
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(6, (heading[1] ?? "#").length + 1); // below the report's own h2/h3
      out.push(`<h${level} class="md">${inline(escapeHtml(heading[2] ?? ""))}</h${level}>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      closeList();
      out.push("<hr />");
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const wanted = bullet ? "ul" : "ol";
      if (listType !== wanted) {
        closeList();
        listType = wanted;
        out.push(`<${wanted}>`);
      }
      out.push(`<li>${inline(escapeHtml((bullet ?? ordered)?.[1] ?? ""))}</li>`);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      closeList();
      out.push(
        `<blockquote>${inline(escapeHtml(quote[1] ?? ""))}</blockquote>`,
      );
      continue;
    }
    closeList();
    out.push(`<p>${inline(escapeHtml(line))}</p>`);
  }

  if (inCode) flushCode();
  closeList();
  return out.join("\n");
}
