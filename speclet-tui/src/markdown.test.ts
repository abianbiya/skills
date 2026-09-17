import { describe, test, expect } from "bun:test";
import { createMarkdownBody } from "./markdown.js";

/** A stand-in for the fork's renderer: same crash, same message. */
function forkLikeRenderer(): { render: (width: number) => string[] } {
	const theme: { symbols?: unknown } = {};
	return {
		render() {
			// `@oh-my-pi`'s markdown reads theme.symbols while styling inline code.
			return `${String(theme.symbols!.valueOf())}`.split("\n");
		},
	};
}

describe("createMarkdownBody", () => {
	test("uses the host renderer when it works", () => {
		const body = createMarkdownBody("hello", () => ({ render: () => ["styled"] }), (l) => [l]);
		expect(body.lines(40)).toEqual(["styled"]);
		expect(body.failed()).toBe(false);
	});

	test("falls back to plain wrapped text instead of throwing", () => {
		const body = createMarkdownBody("a\nb", () => forkLikeRenderer(), (line) => [line, `${line}!`]);
		// The fork throws on render; the panel must still draw something.
		expect(() => body.lines(40)).not.toThrow();
		expect(body.lines(40)).toEqual(["a", "a!", "b", "b!"]);
		expect(body.failed()).toBe(true);
	});

	test("stops calling a renderer that failed", () => {
		let calls = 0;
		const body = createMarkdownBody(
			"x",
			() => ({
				render: () => {
					calls++;
					throw new Error("boom");
				},
			}),
			(line) => [line],
		);
		body.lines(20);
		body.lines(30);
		body.lines(20);
		expect(calls).toBe(1);
		expect(body.lines(30)).toEqual(["x"]);
	});

	test("rebuilds the component when the width changes", () => {
		let builds = 0;
		const rendered: number[] = [];
		const body = createMarkdownBody(
			"x",
			() => {
				builds++;
				return { render: (w: number) => (rendered.push(w), [`w${w}`]) };
			},
			(line) => [line],
		);
		expect(body.lines(10)).toEqual(["w10"]);
		expect(body.lines(10)).toEqual(["w10"]);
		expect(body.lines(20)).toEqual(["w20"]);
		// One component per width (its layout is width-dependent), but every call
		// renders, so the caller never holds stale lines.
		expect(builds).toBe(2);
		expect(rendered).toEqual([10, 10, 20]);
	});

	test("tolerates a renderer that returns no lines", () => {
		const body = createMarkdownBody("x", () => ({ render: () => [] }), (line) => [line]);
		expect(body.lines(10)).toEqual([]);
		expect(body.failed()).toBe(false);
	});
});
