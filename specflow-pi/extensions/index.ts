/**
 * specflow-pi — Pi extension. Shows the active specflow's phase as a live
 * widget above the editor and registers the /specflow picker command, which
 * also opens requirements.md / design.md / tasks.md / project.md in a
 * scrollable markdown popup.
 *
 * State is always read from `<cwd>/.specflow/`; this extension never writes
 * there (the skill owns gate metadata). A 500 ms non-overlapping poll keeps
 * the panel current.
 *
 * Declared fork of speclet-tui/index.ts (AC7). Deliberately absent: the
 * speclet task inspector and its `shift+up` registration — dropping the only
 * global shortcut is what lets both extensions coexist in one session.
 */

import { join } from "node:path";
import { lstat, readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Markdown, truncateToWidth, type MarkdownTheme } from "@earendil-works/pi-tui";
import { SpecflowController } from "../src/controller.js";
import { createMarkdownBody } from "../src/markdown.js";
import { discoverSpecflows, type SpecflowSpec } from "../src/parse.js";
import { renderScrollbar, stripControlSequences, wrapText } from "../src/shared.js";
import {
	actionOptions,
	documentOptions,
	listText,
	pickerOptions,
	renderWidgetLines,
	renderDetailsLines,
	taskOptions,
	visibleSpecs,
	type CockpitAction,
	type Styler,
} from "../src/render.js";

const WIDGET_KEY = "specflow";
const MAX_LINES = 6;
const INDENT = "  ";
/** Viewer ceiling: larger or binary documents are reported, never rendered (F5). */
const MAX_DOC_BYTES = 512 * 1024;

function popupColors() {
	return {
		heading: "accent",
		meta: "muted",
		phase: "text",
		gate: "warning",
		next: "text",
		warn: "warning",
		body: "text",
		more: "dim",
		rule: "borderMuted",
	} as const;
}

function makeStyler(theme: any): Styler {
	const colors = popupColors();
	return (text, kind) => theme.fg(colors[kind], text);
}

// Set once when the host theme turned out to be incompatible, so a degraded render
// reports itself a single time instead of on every frame.
let unstyledWarned = false;

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

interface PopupCtx {
	ui: {
		custom: (factory: unknown, options?: unknown) => Promise<void>;
		notify: (message: string, type?: string) => void;
	};
}

/**
 * Open one document overlay: themed markdown, padded box, scrollbar, esc/q
 * closes (AC4). A missing or unreadable file reports the file name and opens
 * nothing.
 */
async function openDocumentPopup(
	popupCtx: PopupCtx,
	spec: SpecflowSpec,
	doc: { label: string; path: string },
): Promise<void> {
	let content: string;
	try {
		const stats = await lstat(doc.path);
		if (stats.size > MAX_DOC_BYTES) {
			popupCtx.ui.notify(
				`specflow: cannot display ${doc.label}: ${Math.round(stats.size / 1024)} kB exceeds the ${MAX_DOC_BYTES / 1024} kB viewer limit`,
				"error",
			);
			return;
		}
		content = await readFile(doc.path, "utf8");
	} catch (e) {
		popupCtx.ui.notify(`specflow: cannot read ${doc.label}: ${String(e)}`, "error");
		return;
	}
	if (content.includes("\u0000")) {
		popupCtx.ui.notify(`specflow: cannot display ${doc.label}: binary file`, "error");
		return;
	}
	const header = `${spec.name} · ${doc.label}`;

	await popupCtx.ui.custom(
		(tui: any, theme: any, _keybindings: unknown, close: () => void) => {
			let offset = 0;
			const styler = makeStyler(theme);
			const notify = popupCtx.ui.notify;
			const body = createMarkdownBody(
				content,
				() => new Markdown(content, 0, 0, markdownThemeFrom(theme)),
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
						if (body.failed() && !unstyledWarned) {
							unstyledWarned = true;
							notify(
								"specflow: host markdown renderer is incompatible with this theme; showing plain text",
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

/**
 * Run one cockpit action (AC6). Every action reaches the agent as an explicit
 * user message via pi.sendUserMessage — this extension never writes to
 * `.specflow/` itself, so the skill/agent stays the only writer. Cancelling a
 * chooser performs nothing (AC7).
 */
async function runCockpitAction(
	pi: ExtensionAPI,
	ctx: { ui: { select: (title: string, options: string[]) => Promise<string | undefined>; notify: (m: string, t?: string) => void } },
	spec: SpecflowSpec,
	action: CockpitAction,
	projectFile: string,
): Promise<void> {
	const confirm = (message: string) => {
		pi.sendUserMessage(message);
		ctx.ui.notify(`Sent: ${message}`, "info");
	};

	switch (action) {
		case "execute": {
			const tasks = taskOptions(spec);
			if (tasks.length === 0) {
				ctx.ui.notify(`No unfinished task in ${spec.name}.`, "info");
				return;
			}
			const choice = await ctx.ui.select(`Execute which task of ${spec.name}?`, tasks.map((t) => t.label));
			if (choice === undefined) return;
			const picked = tasks.find((t) => t.label === choice);
			if (!picked) return;
			confirm(`Execute task ${picked.task.id} of the ${spec.name} spec.`);
			return;
		}
		case "approve":
			confirm(`Approve and resume the ${spec.name} spec.`);
			return;
		case "validate":
			confirm(`Validate the ${spec.name} spec implementation.`);
			return;
		case "document": {
			const docs = documentOptions(spec, projectFile);
			const picked = await ctx.ui.select(`Document: ${spec.name}`, docs.map((d) => d.label));
			if (picked === undefined) return;
			const doc = docs.find((d) => d.label === picked);
			if (doc) await openDocumentPopup(ctx, spec, doc);
			return;
		}
		case "toggle":
			return; // handled by the caller, which owns the controller
	}
}

export default function specflowTui(pi: ExtensionAPI) {
	let controller: SpecflowController | undefined;

	// Re-register the widget from current controller state. setWidget with a
	// factory triggers a repaint; the component re-reads state on each render so
	// resize always reflows. No specflow widget when the panel has no content.
	function repaint(ctx: ExtensionContext) {
		if (!controller) return;
		const spec = controller.active();
		if (!spec || controller.hidden) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}

		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
			render(width: number): string[] {
				const current = controller?.active();
				if (!current) return [];
				// A theme-shape difference in the host must not escape into the host
				// render loop, which reports an uncaught exception.
				try {
					return renderWidgetLines(current, width, MAX_LINES, truncateToWidth, makeStyler(theme));
				} catch (e) {
					if (!unstyledWarned) {
						unstyledWarned = true;
						ctx.ui.notify(
							`specflow: host theme is incompatible (${String(e)}); showing the panel unstyled`,
							"warning",
						);
					}
					return renderWidgetLines(current, width, MAX_LINES, truncateToWidth, (text) => text);
				}
			},
			invalidate(): void {
				// Nothing is cached between frames: every render re-reads the controller.
			},
		}));
	}

	pi.on("session_start", (_event, ctx) => {
		// Interactive-only: no timer or widget in rpc/json/print modes (AC6).
		if (ctx.mode !== "tui") return;
		const sessionCtx = ctx;
		controller = new SpecflowController(join(ctx.cwd, ".specflow"), {
			onUpdate: () => repaint(sessionCtx),
			onDiagnostic: (msg) => sessionCtx.ui.notify(`specflow: ${msg}`, "warning"),
		});
		repaint(sessionCtx);
		controller.start();
	});

	pi.on("session_shutdown", () => {
		// Stop polling and drop session state (incl. pinned selection) — AC6.
		controller?.stop();
		controller = undefined;
	});

	pi.registerCommand("specflow", {
		description: "Act on the active specflow: execute a task, approve a gate, validate, or read a document",
		handler: async (_args, ctx) => {
			const specflowDir = join(ctx.cwd, ".specflow");

			// Non-interactive modes: textual listing, never a dialog (AC3, AC8).
			// A partial discovery failure must not hide the specs that did resolve (F4).
			if (ctx.mode !== "tui" || !controller) {
				const { specs, dirError } = await discoverSpecflows(specflowDir);
				const listing = specs.length > 0 ? listText(specs) : "No specflows found.";
				const text = stripControlSequences(dirError ? `${dirError}\n${listing}` : listing);
				if (ctx.hasUI) {
					ctx.ui.notify(text, "info");
				} else {
					console.log(text);
				}
				return;
			}

			if (controller.specs.length === 0) {
				ctx.ui.notify("No specflows found.", "info");
				return;
			}

			const active = controller.active();
			// Retired specs are hidden from this list; "Show finished" is what brings
			// them back, so an empty list still gets that entry below.
			const options = pickerOptions(visibleSpecs(controller.specs, controller.showFinished));
			const actions = active ? actionOptions(active, controller.hidden) : [];
			const finishedLabel = controller.showFinished ? "Hide finished" : "Show finished";
			const choice = await ctx.ui.select(active ? `Specflow: ${active.name}` : "Specflow:", [
				...actions.map((a) => a.label),
				finishedLabel,
				...options.map((o) => o.label),
			]);
			if (choice === undefined) return; // cancelled — keep current selection (AC3, AC7)

			if (choice === finishedLabel) {
				controller.setShowFinished(!controller.showFinished);
				return;
			}

			const action = actions.find((a) => a.label === choice);
			if (action && active) {
				if (action.action === "toggle") {
					controller.hidden ? controller.show() : controller.hide();
					return;
				}
				await runCockpitAction(pi, ctx, active, action.action, join(specflowDir, "project.md"));
				return;
			}

			const picked = options.find((o) => o.label === choice);
			if (picked) {
				controller.pin(picked.dir);
				controller.show(); // picking a specflow also reveals the panel
			}
		},
	});
}
