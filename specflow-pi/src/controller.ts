/**
 * controller.ts — session-scoped state for the specflow panel: discovery
 * polling, pinned selection, change/diagnostic dedup, and shutdown
 * invalidation. Declared fork of speclet-tui/src/controller.ts (AC7);
 * filesystem-free except through discoverSpecflows.
 */

import { discoverSpecflows, type SpecflowSpec } from "./parse.js";
import { selectActive } from "./render.js";

export interface ControllerHooks {
	/** The rendered content of the active spec changed (or appeared/disappeared). */
	onUpdate(): void;
	/** A deduplicated diagnostic to surface (directory or read failure). */
	onDiagnostic(message: string): void;
}

export class SpecflowController {
	specs: SpecflowSpec[] = [];
	/** Spec directory pinned via /specflow; cleared automatically when it disappears. */
	pinned: string | undefined;
	/** Panel visibility, toggled from the /specflow picker. Session-scoped. */
	hidden = false;

	private timer: ReturnType<typeof setTimeout> | undefined;
	private generation = 0;
	private lastSignature: string | undefined;
	private lastDiagnostic: string | undefined;

	constructor(
		private readonly specflowDir: string,
		private readonly hooks: ControllerHooks,
		private readonly intervalMs = 500,
	) {}

	active(): SpecflowSpec | undefined {
		return selectActive(this.specs, this.pinned);
	}

	pin(dir: string | undefined): void {
		this.pinned = dir;
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
		const { specs, dirError } = await discoverSpecflows(this.specflowDir);
		if (gen !== this.generation) return; // stale scan after shutdown

		if (this.pinned !== undefined && !specs.some((s) => s.dir === this.pinned)) {
			this.pinned = undefined; // pinned spec disappeared — back to ranking (AC1)
		}
		this.specs = specs;

		const diagnostic =
			dirError ?? (specs.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`).join("; ") || undefined);
		if (diagnostic !== this.lastDiagnostic) {
			this.lastDiagnostic = diagnostic;
			if (diagnostic) this.hooks.onDiagnostic(diagnostic);
		}
		this.refreshSnapshot();
	}

	/** Start the non-overlapping poll loop (AC6). */
	start(): void {
		void this.loop();
	}

	stop(): void {
		this.generation++; // invalidates in-flight scans and scheduled ticks
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.specs = [];
		this.pinned = undefined;
		this.hidden = false;
	}

	private async loop(): Promise<void> {
		const gen = this.generation;
		await this.scan();
		if (gen !== this.generation) return;
		this.timer = setTimeout(() => void this.loop(), this.intervalMs);
	}

	/** Fire onUpdate only when the rendered content of the active spec changed. */
	private refreshSnapshot(): void {
		const active = this.active();
		const signature = JSON.stringify([
			this.hidden,
			active
				? [
						active.dir,
						active.name,
						active.status,
						active.phase,
						active.done,
						active.total,
						active.gate,
						active.error ?? null,
					]
				: null,
		]);
		if (signature !== this.lastSignature) {
			this.lastSignature = signature;
			this.hooks.onUpdate();
		}
	}
}
