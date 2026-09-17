/**
 * Host markdown rendering, with a floor under it.
 *
 * `Markdown` comes from the host's pi-tui, and the host is not always stock:
 * `@oh-my-pi/pi-coding-agent` is a pi fork whose markdown renderer reads
 * `theme.symbols.colorSwatch` while rendering inline code. Upstream pi-tui never
 * touches `symbols` (its `MarkdownTheme` is fourteen style functions), so the
 * `MarkdownTheme` this extension builds is correct for pi — and still crashes the
 * fork with `undefined is not an object (evaluating 'this.#r.symbols.colorSwatch')`.
 *
 * A theme-shape difference must not be fatal: an exception inside a widget or
 * dialog render escapes to the host's render loop, which reports an uncaught
 * exception and drops the user into recovery. So markdown is attempted once and
 * then abandoned in favour of plain wrapped text for the life of that view.
 */

export interface RenderableMarkdown {
	render(width: number): string[];
}

/**
 * Returns a width→lines renderer that uses the host component until it throws.
 *
 * `build` is called lazily so the component is constructed at the first known
 * width, and re-built when the width changes (its layout is width-dependent).
 */
export function createMarkdownBody(
	text: string,
	build: () => RenderableMarkdown,
	wrap: (line: string, width: number) => string[],
): { lines: (width: number) => string[]; failed: () => boolean } {
	let instance: RenderableMarkdown | undefined;
	let builtWidth = -1;
	let plain = false;
	const plainLines = (width: number) =>
		text.split("\n").flatMap((line) => wrap(line, width));

	return {
		failed: () => plain,
		lines: (width: number): string[] => {
			if (plain) return plainLines(width);
			try {
				if (!instance || builtWidth !== width) {
					instance = build();
					builtWidth = width;
				}
				const lines = instance.render(width);
				if (lines.length > 0) return lines;
				// Empty output is not an error, but there is nothing to fall back to.
				return lines;
			} catch {
				plain = true;
				return plainLines(width);
			}
		},
	};
}
