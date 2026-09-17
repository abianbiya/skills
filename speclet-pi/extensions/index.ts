/**
 * speclet-tui — Pi extension. Shows the active speclet's checklist as a live
 * widget above the editor and registers the /speclet picker command.
 *
 * State is always read from `<cwd>/.speclet/*.md`; this extension never writes
 * to speclet files. A 500 ms non-overlapping poll keeps the panel current.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Markdown, truncateToWidth, type KeyId, type MarkdownTheme } from "@earendil-works/pi-tui";
import { SpecletController } from "../src/controller.js";
import { createMarkdownBody } from "../src/markdown.js";
import {
	loadSpecletConfig,
	parseShortcutInput,
	saveShortcut,
	specletConfigPath,
} from "../src/config.js";
import {
	parseSections,
	criteriaIds,
	resolveCriteria,
	discoverSpeclets,
	stripControlSequences,
	type SpecletFile,
	type SpecletTask,
} from "../src/speclet.js";
import {
	listText,
	pickerOptions,
	renderWidgetLines,
	renderDetailsLines,
	renderScrollbar,
	wrapText,
	type Styler,
} from "../src/render.js";

const WIDGET_KEY = "speclet-tui";
const MAX_LINES = 12;
const DETAILS_LABEL = "View details";

// Set once when the host theme turned out to be incompatible, so a degraded render
// reports itself a single time instead of on every frame.
let unstyledWarned = false;
const INDENT = "  ";

function popupColors() {
	return {
		heading: "accent",
		meta: "muted",
		doneGlyph: "success",
		openGlyph: "dim",
		taskDone: "muted",
		taskOpen: "text",
		more: "dim",
		rule: "borderMuted",
	} as const;
}

function makeStyler(theme: any): Styler {
	const colors = popupColors();
	return (text, kind) => {
		if (kind === "taskDone") return theme.strikethrough(theme.fg(colors.taskDone, text));
		return theme.fg(colors[kind], text);
	};
}

function markdownThemeFrom(theme: any): MarkdownTheme {
	return {
		heading: (t) => theme.fg("accent", theme.bold(t)),
		link: (t) => theme.fg("accent", t),
		linkUrl: (t) => theme.fg("dim", t),
		code: (t) => theme.fg("warning", t),
		codeBlock: (t) => theme.fg("dim", t),
		codeBlockBorder: (t) => theme.fg("borderMuted", t),
		quote: (t) => theme.fg("dim", t),
		quoteBorder: (t) => theme.fg("borderMuted", t),
		hr: (t) => theme.fg("borderMuted", t),
		listBullet: (t) => theme.fg("accent", t),
		bold: (t) => theme.bold(t),
		italic: (t) => theme.italic(t),
		strikethrough: (t) => theme.strikethrough(t),
		underline: (t) => theme.underline(t),
	};
}

function taskGlyph(task: SpecletTask, styler: Styler): string {
	return styler(task.done ? "●" : "○", task.done ? "doneGlyph" : "openGlyph");
}

/**
 * `/speclet shortcut [key]` — the only writable setting this extension has.
 *
 * A shortcut is bound at load time and cannot be re-bound in place, so a change
 * here always ends with "run /reload": saying that is better than leaving the user
 * to wonder why the new key does nothing.
 */
async function editShortcut(
	value: string,
	ctx: PopupCtx & {
		hasUI?: boolean;
		mode?: string;
		ui: { input: (title: string, placeholder?: string) => Promise<string | undefined> };
	},
): Promise<void> {
	const path = specletConfigPath();
	const current = loadSpecletConfig(path).config.shortcut;
	const shown = current === "" ? "none" : current;
	// Same convention as the rest of this file: text modes have no dialog layer.
	const say = (message: string, type: "info" | "warning" | "error" = "info") => {
		if (ctx.hasUI) ctx.ui.notify(message, type);
		else console.log(stripControlSequences(message));
	};

	let answer = value;
	if (answer === "") {
		const summary = `Inspector shortcut: ${shown}\nConfig: ${path}\nSet it with /speclet shortcut <key> (e.g. shift+up, ctrl+alt+i, none).`;
		if (ctx.mode !== "tui") {
			say(summary);
			return;
		}
		const typed = await ctx.ui.input(
			'Inspector shortcut (e.g. shift+up, ctrl+alt+i) — "none" removes it',
			shown,
		);
		if (typed === undefined) return;
		answer = typed;
	}

	const parsed = parseShortcutInput(answer);
	if ("error" in parsed) {
		say(parsed.error, "warning");
		return;
	}
	const result = await saveShortcut(parsed.shortcut, path);
	if (result.error) {
		say(`speclet-tui: ${result.error}`, "error");
		return;
	}
	say(
		`Inspector shortcut: ${parsed.shortcut === "" ? "none" : parsed.shortcut} → ${result.path}\nRun /reload to apply it.`,
	);
}

interface PopupCtx {
	ui: {
		custom: (factory: unknown, options?: unknown) => Promise<void>;
		notify: (message: string, type?: string) => void;
	};
}

/** Open the details overlay: markdown body, padded box, scrollbar, esc/q closes. */
async function openDetailsPopup(popupCtx: PopupCtx, spec: SpecletFile): Promise<void> {
	let content: string;
	try {
		content = await readFile(spec.path, "utf8");
	} catch (e) {
		popupCtx.ui.notify(`speclet-tui: cannot read ${spec.filename}: ${String(e)}`, "error");
		return;
	}
	const sections = parseSections(content);
	const bodyText = [
		"## Requirements",
		...(sections.requirements.length > 0 ? sections.requirements : ["(none)"]),
		"",
		"## Design Notes",
		...(sections.design.length > 0 ? sections.design : ["(none)"]),
	].join("\n");
	const done = spec.tasks.filter((t) => t.done).length;
	const header = `Speclet: ${spec.name} · ${spec.status} · ${done}/${spec.tasks.length}`;

	await popupCtx.ui.custom(
		(tui: any, theme: any, _keybindings: unknown, close: () => void) => {
			let offset = 0;
			const styler = makeStyler(theme);
			const notify = popupCtx.ui.notify;
			const body = createMarkdownBody(
				bodyText,
				() => new Markdown(bodyText, 0, 0, markdownThemeFrom(theme)),
				wrapText,
			);
			let mdBodyLines: string[] = [];
			let mdWidth = -1;
			const height = () => Math.max(8, Math.floor(tui.terminal.rows * 0.7));
			return {
				render(width: number): string[] {
					// true inner width: border(4) + indent(2) + scrollbar column(2)
					const contentWidth = Math.max(10, width - 8);
					if (mdWidth !== contentWidth) {
						mdBodyLines = body.lines(contentWidth);
						mdWidth = contentWidth;
						offset = Math.max(0, Math.min(offset, Math.max(0, mdBodyLines.length - 1)));
						// Tell the user once if the host's markdown refused to render, so
						// "the popup lost its formatting" is explainable rather than a riddle.
						if (body.failed() && !unstyledWarned) {
							unstyledWarned = true;
							notify(
								"speclet-tui: host markdown renderer is incompatible with this theme; showing plain text",
								"warning",
							);
						}
					}
					const h = height();
					const visibleRows = Math.max(1, h - 3);
					const bar = renderScrollbar(mdBodyLines.length, visibleRows, offset).map((c) =>
						c === "█" ? theme.fg("accent", "█") : theme.fg("borderMuted", "░"),
					);
					return renderDetailsLines(header, mdBodyLines, width, h, offset, truncateToWidth, styler, {
						indent: INDENT,
						scrollbar: bar,
						plainBody: true,
						border: true,
					});
				},
				handleInput(data: string): void {
					if (matchesKey(data, "escape") || data === "q") {
						close();
						return;
					}
					const page = Math.max(1, height() - 4);
					const delta = matchesKey(data, "down")
						? 1
						: matchesKey(data, "up")
							? -1
							: matchesKey(data, "pageDown")
								? page
								: matchesKey(data, "pageUp")
									? -page
									: matchesKey(data, "home")
										? -Infinity
										: matchesKey(data, "end")
											? Infinity
											: 0;
					if (delta === 0) return;
					const visibleRows = Math.max(1, height() - 3);
					offset = Math.max(0, Math.min(offset + delta, Math.max(0, mdBodyLines.length - visibleRows)));
					tui.requestRender();
				},
				invalidate(): void {
					mdWidth = -1; // force a fresh render on the next frame
				},
			};
		},
		{ overlay: true, overlayOptions: { width: "80%", margin: 2 } },
	);
}

/** Open the task detail popup for one task (title, description, resolved criteria). */
async function openTaskPopup(
	popupCtx: PopupCtx,
	spec: SpecletFile,
	task: SpecletTask,
	requirements: string[],
): Promise<void> {
	await popupCtx.ui.custom(
		(tui: any, theme: any, _keybindings: unknown, close: () => void) => {
			let detailOffset = 0;
			let wrapped: string[] = [];
			let wrapWidth = -1;
			const wrappedBody = (width: number) => {
				const inner = Math.max(10, width - 8); // border(4) + indent(2) + scrollbar(2)
				if (wrapWidth !== inner) {
					wrapped = body.flatMap((l) => wrapText(l, inner));
					wrapWidth = inner;
					detailOffset = Math.max(0, Math.min(detailOffset, Math.max(0, wrapped.length - 1)));
				}
				return wrapped;
			};
			const styler = makeStyler(theme);
			const height = () => Math.max(6, Math.floor(tui.terminal.rows * 0.7));
			const body = (() => {
				const details = task.details ?? [];
				const desc = details.filter((d) => !/^criteria:/i.test(d.replace(/^-/, "").trim()));
				const lines = [...(desc.length > 0 ? desc : ["(no description)"]), ""];
				lines.push(styler("Criteria:", "meta"));
				const resolved = resolveCriteria(criteriaIds(details), requirements);
				if (resolved.length === 0) lines.push("  (none)");
				for (const r of resolved) lines.push(r.text ? `  ${r.id}: ${r.text}` : `  ${r.id}`);
				return lines;
			})();
			const title = task.done ? styler(task.title, "taskDone") : styler(task.title, "taskOpen");
			const styledHeader = `${taskGlyph(task, styler)} ${task.id} ${title}`;
			return {
				render(width: number): string[] {
					const h = height();
					const shown = wrappedBody(width);
					const visibleRows = Math.max(1, h - 3);
					const bar = renderScrollbar(shown.length, visibleRows, detailOffset).map((c) =>
						c === "█" ? theme.fg("accent", "█") : theme.fg("borderMuted", "░"),
					);
					return renderDetailsLines(styledHeader, shown, width, h, detailOffset, truncateToWidth, styler, {
						indent: INDENT,
						scrollbar: bar,
						plainBody: true,
						headerPreStyled: true,
						border: true,
					});
				},
				handleInput(data: string): void {
					if (matchesKey(data, "escape") || data === "q") {
						close();
						return;
					}
					const page = Math.max(1, height() - 4);
					const delta = matchesKey(data, "down")
						? 1
						: matchesKey(data, "up")
							? -1
							: matchesKey(data, "pageDown")
								? page
								: matchesKey(data, "pageUp")
									? -page
									: matchesKey(data, "home")
										? -Infinity
										: matchesKey(data, "end")
											? Infinity
											: 0;
					if (delta === 0) return;
					const visibleRows = Math.max(1, height() - 3);
					detailOffset = Math.max(0, Math.min(detailOffset + delta, Math.max(0, wrapped.length - visibleRows)));
					tui.requestRender();
				},
				invalidate(): void {},
			};
		},
		{ overlay: true, overlayOptions: { width: "80%", margin: 2 } },
	);
}

/**
 * Task inspector: prompt-bar navigation via ctx.ui.select (AC9). Enter opens
 * the task popup; closing the popup re-shows the list; cancelling exits.
 */
async function openInspector(dialogCtx: PopupCtx & { ui: { select: (t: string, o: string[]) => Promise<string | undefined> } }, spec: SpecletFile): Promise<void> {
	let requirements: string[] = [];
	try {
		requirements = parseSections(await readFile(spec.path, "utf8")).requirements;
	} catch {
		// criteria resolution is best-effort; raw IDs remain visible (AC3 fallback)
	}
	const done = spec.tasks.filter((t) => t.done).length;
	const title = `Speclet: ${spec.name} · ${spec.status} · ${done}/${spec.tasks.length}`;
	if (spec.tasks.length === 0) {
		dialogCtx.ui.notify("This speclet has no tasks.", "info");
		return;
	}
	for (;;) {
		const options = spec.tasks.map((t) => `${t.done ? "●" : "○"} ${t.id} ${t.title}`);
		const choice = await dialogCtx.ui.select(title, options);
		if (choice === undefined) return; // cancelled — close the inspector
		const idx = options.indexOf(choice);
		if (idx === -1) return;
		await openTaskPopup(dialogCtx, spec, spec.tasks[idx], requirements);
		// popup closed — loop re-shows the list
	}
}

export default function specletTui(pi: ExtensionAPI) {
	let controller: SpecletController | undefined;

	// Re-register the widget from current controller state. setWidget with a
	// factory triggers a repaint; the component re-reads state on each render so
	// resize always reflows.
	function repaint(ctx: ExtensionContext) {
		if (!controller) return;
		const spec = controller.active();
		if (!spec || !controller.panelVisible()) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
			render(width: number): string[] {
				const current = controller?.active();
				if (!current) return [];
				// A theme-shape difference in the host (see src/markdown.ts) must not
				// escape into the host render loop, which reports an uncaught exception.
				try {
					return renderWidgetLines(current, width, MAX_LINES, truncateToWidth, makeStyler(theme));
				} catch (e) {
					if (!unstyledWarned) {
						unstyledWarned = true;
						ctx.ui.notify(
							`speclet-tui: host theme is incompatible (${String(e)}); showing the panel unstyled`,
							"warning",
						);
					}
					return renderWidgetLines(
						current,
						width,
						MAX_LINES,
						truncateToWidth,
						(text) => text,
					);
				}
			},
			invalidate(): void {
				// Nothing is cached between frames: every render re-reads the controller.
			},
		}));
	}

	pi.on("session_start", (_event, ctx) => {
		// Interactive-only: no timer or widget in rpc/json/print modes (AC8).
		if (ctx.mode !== "tui") return;
		const sessionCtx = ctx;
		controller = new SpecletController(join(ctx.cwd, ".speclet"), {
			onUpdate: () => repaint(sessionCtx),
			onDiagnostic: (msg) => sessionCtx.ui.notify(`speclet-tui: ${msg}`, "warning"),
		});
		repaint(sessionCtx);
		controller.start();

	});

	// Task inspector shortcut (AC1); fall back if the host rejects the binding.
	// Registered in the factory body: registering inside session_start throws
	// "stale extension ctx" when pi rebinds extensions mid-startup (trust flow).
	// The key comes from `<agent dir>/speclet.json`, because pi's own
	// keybindings.json only remaps pi's built-in actions, not extension ones.
	const loadedShortcut = loadSpecletConfig();
	const inspectorShortcut = (shortcutKey: string) => {
		pi.registerShortcut(shortcutKey as KeyId, {
			description: "Open the speclet task inspector",
			handler: async (shortcutCtx) => {
				if (shortcutCtx.mode !== "tui" || !controller) return;
				const spec = controller.active();
				if (!spec) {
					shortcutCtx.ui.notify("No speclet selected.", "info");
					return;
				}
				// the dialog repeats the panel's list — hide it until done (AC11)
				const wasHidden = controller.hidden;
				controller.hide();
				try {
					await openInspector(shortcutCtx, spec);
				} finally {
					if (!wasHidden) controller.show();
					else repaint(shortcutCtx);
				}
			},
		});
	};
	const warn = (message: string) => {
		pi.on("session_start", (_event, ctx) => {
			ctx.ui.notify(`speclet-tui: ${message}`, "warning");
		});
	};
	if (loadedShortcut.config.shortcut === "") {
		if (loadedShortcut.error) warn(loadedShortcut.error);
	} else {
		try {
			inspectorShortcut(loadedShortcut.config.shortcut);
		} catch (error) {
			// A configured key is the user's choice, so it is never swapped for
			// another one; only an unconfigured default still has a fallback.
			if (loadedShortcut.explicit) {
				warn(
					`could not register shortcut "${loadedShortcut.config.shortcut}" (${String(error)}). Edit ${loadedShortcut.path} or run /speclet shortcut <key>.`,
				);
			} else {
				try {
					inspectorShortcut("alt+up");
				} catch {
					warn(`could not register inspector shortcut: ${String(error)}`);
				}
			}
		}
	}

	pi.on("session_shutdown", () => {
		// Stop polling and drop session state (incl. pinned selection) — AC2.
		controller?.stop();
		controller = undefined;
	});

	pi.registerCommand("speclet", {
		description:
			"List speclets and choose which one the panel shows; /speclet shortcut [key] sets the inspector key",
		handler: async (args, ctx) => {
			const dir = join(ctx.cwd, ".speclet");

			if (args.trim().split(/\s+/)[0] === "shortcut") {
				await editShortcut(args.trim().slice("shortcut".length).trim(), ctx);
				return;
			}

			// Non-interactive modes: textual list, never a dialog (AC3, AC8).
			if (ctx.mode !== "tui" || !controller) {
				const { files, dirError } = await discoverSpeclets(dir);
				const text = stripControlSequences(
					dirError ?? (files.length > 0 ? listText(files) : "No speclets found."),
				);
				if (ctx.hasUI) {
					ctx.ui.notify(text, "info");
				} else {
					console.log(text);
				}
				return;
			}

			if (controller.files.length === 0) {
				ctx.ui.notify("No speclets found.", "info");
				return;
			}

			const options = pickerOptions(controller.files);
			const toggleLabel = controller.panelVisible() ? "Hide panel" : "Show panel";
			const choice = await ctx.ui.select("Speclet:", [...options.map((o) => o.label), toggleLabel, DETAILS_LABEL]);
			if (choice === undefined) return; // cancelled — keep current selection (AC3)
			if (choice === toggleLabel) {
				controller.panelVisible() ? controller.hide() : controller.reveal();
				return;
			}
			if (choice === DETAILS_LABEL) {
				const active = controller.active();
				if (!active) {
					ctx.ui.notify("No speclet selected.", "info");
					return;
				}
				await openDetailsPopup(ctx, active);
				return;
			}
			const picked = options.find((o) => o.label === choice);
			if (picked) {
				controller.pin(picked.filename);
				controller.reveal(); // picking a speclet also reveals the panel
			}
		},
	});
}
