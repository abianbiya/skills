/**
 * shared.ts — generic text/terminal primitives with no domain types and no
 * imports. This file is kept byte-identical between speclet-tui and
 * specflow-pi (the package's prepublish check enforces it), so it must stay
 * free of speclet-specific concepts: `StyleKind`/`Styler` belong to each
 * extension's render module, not here.
 */

/** Remove ANSI escape sequences and other control characters. */
export function stripControlSequences(text: string): string {
	return text
		// CSI sequences (incl. SGR), OSC sequences, and two-char C1 escapes
		.replace(/\x1b(?:\[[0-9;:?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g, "")
		// remaining C0 controls except tab (collapsed below), plus DEL
		.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
		.replace(/\t/g, " ");
}

/** Visible length of a line: ANSI escapes stripped, code points counted as one column. */
export function visibleLen(line: string): number {
	return [...line.replace(/\x1b\[[0-9;:?]*[ -/]*[@-~]/g, "")].length;
}

/** Right-pad a (possibly styled) line with spaces to the visible width. */
export function padVisible(line: string, width: number): string {
	return line + " ".repeat(Math.max(0, width - visibleLen(line)));
}

/**
 * Word-wrap a line to the visible width: continuation lines get two-space
 * indent (original leading indent preserved on the first line), overlong
 * words are hard-broken. ANSI escapes survive inside their chunk; styled
 * spans broken across lines lose styling on the continuation (accepted).
 */
export function wrapText(line: string, width: number): string[] {
	if (width <= 0 || visibleLen(line) <= width) return [line];
	const firstIndent = (line.match(/^\s*/) ?? [""])[0];
	const contIndent = firstIndent + "  ";
	const usable = Math.max(1, width - contIndent.length);
	const out: string[] = [];
	let cur = firstIndent;
	let curLen = visibleLen(cur);
	let empty = cur.trim() === "";
	const newline = () => {
		cur = contIndent;
		curLen = visibleLen(cur);
		empty = true;
	};
	const emit = (s: string) => {
		out.push(s);
		newline();
	};
	for (const rawWord of line.slice(firstIndent.length).split(" ")) {
		if (rawWord === "") continue;
		let word = rawWord;
		while (visibleLen(word) > usable) {
			if (!empty) emit(cur);
			let cut = "";
			let w = 0;
			for (const ch of word) {
				const cw = visibleLen(ch);
				if (w + cw > usable) break;
				cut += ch;
				w += cw;
			}
			emit(cur + cut);
			word = word.slice(cut.length);
		}
		if (word === "") continue;
		const sep = empty ? 0 : 1;
		if (curLen + sep + visibleLen(word) <= width) {
			cur = empty ? cur + word : `${cur} ${word}`;
			curLen += sep + visibleLen(word);
			empty = false;
		} else {
			if (!empty) emit(cur);
			emit(cur + word);
		}
	}
	if (!empty) out.push(cur);
	else if (out.length === 0) out.push(cur);
	return out;
}

/** One scrollbar track character per visible row: proportional thumb over a dim track. */
export function renderScrollbar(total: number, visible: number, offset: number): string[] {
	if (total <= 0 || visible <= 0) return [];
	if (total <= visible) return Array.from({ length: visible }, () => " ");
	const thumbSize = Math.max(1, Math.round((visible * visible) / total));
	const denom = total - visible;
	const thumbStart = Math.round((denom > 0 ? offset / denom : 0) * (visible - thumbSize));
	return Array.from({ length: visible }, (_, i) => (i >= thumbStart && i < thumbStart + thumbSize ? "█" : "░"));
}
