/**
 * controller.ts — session-scoped state for the speclet panel: discovery
 * polling, pinned selection, change/diagnostic dedup, and shutdown
 * invalidation. Filesystem-free except through discoverSpeclets.
 */

import { discoverSpeclets, type SpecletFile } from "./speclet.js";
import { allSpecletsFinished, isFinished, selectActive, visibleFiles } from "./render.js";

export interface ControllerHooks {
	/** The rendered content of the active speclet changed (or appeared/disappeared). */
	onUpdate(): void;
	/** A deduplicated diagnostic to surface (directory or file read failure). */
	onDiagnostic(message: string): void;
}

export class SpecletController {
	files: SpecletFile[] = [];
	/** Filename pinned via /speclet; cleared automatically when it disappears. */
	pinned: string | undefined;
	/** Panel visibility, toggled from the /speclet picker. Session-scoped. */
	hidden = false;
	/**
	 * The user explicitly asked for the panel (picked a speclet, or "Show panel").
	 * This is what overrides the all-finished auto-hide, so an explicit choice
	 * always wins over the automatic rule. Cleared by hide() and stop().
	 */
	revealed = false;
	/**
	 * Picker's "Show finished" toggle: also lists retired speclets, including the
	 * archived ones in `.speclet/archive`, and reveals them in the panel. Session
	 * scope only — cleared by stop(), never persisted.
	 */
	showFinished = false;

	private timer: ReturnType<typeof setTimeout> | undefined;
	private generation = 0;
	private lastSignature: string | undefined;
	private lastDiagnostic: string | undefined;
	private scanning = false;
	private rescanRequested = false;

	constructor(
		private readonly dir: string,
		private readonly hooks: ControllerHooks,
		private readonly intervalMs = 500,
	) {}

	active(): SpecletFile | undefined {
		return selectActive(this.candidates(), this.pinned);
	}

	/** Specs the panel may show: without the toggle, retired ones are excluded. */
	private candidates(): SpecletFile[] {
		return visibleFiles(this.files, this.showFinished);
	}

	pin(filename: string | undefined): void {
		this.pinned = filename;
		this.refreshSnapshot();
	}

	hide(): void {
		this.hidden = true;
		this.revealed = false;
		this.refreshSnapshot();
	}

	show(): void {
		this.hidden = false;
		this.refreshSnapshot();
	}

	/** Explicit user intent (picker "Show panel" / picking a speclet): also
	 * overrides the all-finished auto-hide until the panel is hidden again. */
	reveal(): void {
		this.hidden = false;
		this.revealed = true;
		this.refreshSnapshot();
	}

	/**
	 * Picker "Show finished": retired specs become listable and selectable again.
	 * Turning it off drops a pin that points at a retired spec — the pin cannot
	 * outlive the view that made it selectable. Archived specs arrive on the next
	 * scan(), which reads `.speclet/archive` while this flag is on.
	 */
	setShowFinished(on: boolean): void {
		this.showFinished = on;
		if (!on && this.pinned !== undefined) {
			const pinned = this.files.find((f) => f.filename === this.pinned);
			if (pinned && isFinished(pinned)) this.pinned = undefined;
		}
		this.refreshSnapshot();
	}

	/**
	 * Whether the panel should render right now: there is a speclet to show, the
	 * user has not hidden it, and — once every speclet is retired — only if the
	 * user asked for it explicitly ("Show panel" or "Show finished").
	 */
	panelVisible(): boolean {
		if (this.hidden) return false;
		if (!this.active()) return false;
		return this.revealed || this.showFinished || !allSpecletsFinished(this.files);
	}

	/** Scan once now; safe to call directly (used by tests and start()). */
	async scan(): Promise<void> {
		const gen = this.generation;
		const { files, dirError } = await discoverSpeclets(this.dir, { includeArchive: this.showFinished });
		if (gen !== this.generation) return; // stale scan after shutdown

		if (this.pinned !== undefined && !files.some((f) => f.filename === this.pinned)) {
			this.pinned = undefined; // pinned file disappeared — back to ranking (AC3)
		}
		this.files = files;

		const diagnostic =
			dirError ?? (files.filter((f) => f.error).map((f) => `${f.filename}: ${f.error}`).join("; ") || undefined);
		if (diagnostic !== this.lastDiagnostic) {
			this.lastDiagnostic = diagnostic;
			if (diagnostic) this.hooks.onDiagnostic(diagnostic);
		}
		this.refreshSnapshot();
	}

	/** Start the non-overlapping poll loop. */
	start(): void {
		void this.loop();
	}

	stop(): void {
		this.generation++; // invalidates in-flight scans and scheduled ticks
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.files = [];
		this.pinned = undefined;
		this.hidden = false;
		this.revealed = false;
		this.showFinished = false;
	}

	private async loop(): Promise<void> {
		const gen = this.generation;
		await this.scan();
		if (gen !== this.generation) return;
		this.timer = setTimeout(() => void this.loop(), this.intervalMs);
	}

	/** Fire onUpdate only when the rendered content of the active speclet changed. */
	private refreshSnapshot(): void {
		const active = this.active();
		const signature = active
			? JSON.stringify([
					this.hidden,
					this.revealed,
					this.showFinished,
					active.filename,
					active.name,
					active.status,
					active.tasks,
					active.error ?? null,
				])
			: JSON.stringify([this.hidden, this.revealed, this.showFinished]);
		if (signature !== this.lastSignature) {
			this.lastSignature = signature;
			this.hooks.onUpdate();
		}
	}
}
