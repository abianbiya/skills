/**
 * controller.ts — session-scoped state for the speclet panel: discovery
 * polling, pinned selection, change/diagnostic dedup, and shutdown
 * invalidation. Filesystem-free except through discoverSpeclets.
 */

import { discoverSpeclets, type SpecletFile } from "./speclet.js";
import { selectActive } from "./render.js";

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
		return selectActive(this.files, this.pinned);
	}

	pin(filename: string | undefined): void {
		this.pinned = filename;
		this.refreshSnapshot();
	}

	hide(): void {
		this.hidden = true;
		this.refreshSnapshot();
	}

	show(): void {
		this.hidden = false;
		this.refreshSnapshot();
	}

	/** Scan once now; safe to call directly (used by tests and start()). */
	async scan(): Promise<void> {
		const gen = this.generation;
		const { files, dirError } = await discoverSpeclets(this.dir);
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
			? JSON.stringify([this.hidden, active.filename, active.name, active.status, active.tasks, active.error ?? null])
			: JSON.stringify([this.hidden]);
		if (signature !== this.lastSignature) {
			this.lastSignature = signature;
			this.hooks.onUpdate();
		}
	}
}
