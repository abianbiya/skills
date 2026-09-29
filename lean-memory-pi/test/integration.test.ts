import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import leanMemory from "../index.ts";
import { startPreview } from "../preview.ts";
import { identifyProject, MemoryStore, reviewIsDue, SnapshotCache, today, type Project } from "../store.ts";

const exec = promisify(execFile);
let temp: string;
let a: Project;
let b: Project;
let store: MemoryStore;
let nonGit: string;

before(async () => {
	temp = await fs.mkdtemp(join(tmpdir(), "scoped-memory-test-"));
	for (const name of ["one/api", "two/api"]) {
		await fs.mkdir(join(temp, name), { recursive: true });
		await exec("git", ["init", "--quiet", join(temp, name)]);
	}
	a = (await identifyProject(join(temp, "one/api")))!;
	b = (await identifyProject(join(temp, "two/api")))!;
	store = new MemoryStore(join(temp, "memory"));
	nonGit = join(temp, "no-project");
	await fs.mkdir(nonGit);
});
after(async () => { await fs.rm(temp, { recursive: true, force: true }); });

function harness(cwd: string, memoryStore = store) {
	const old = process.env.LEAN_MEMORY_DIR;
	process.env.LEAN_MEMORY_DIR = memoryStore.root;
	const hooks = new Map<string, ((event: any, ctx: ExtensionContext) => any)[]>();
	const tools = new Map<string, ToolDefinition<any, any>>();
	const commands = new Map<string, { description?: string; handler: (args: string, ctx: any) => any }>();
	const sentMessages: { content: unknown; options?: unknown }[] = [];
	let activeTools = ["memory_write", "memory_read", "scratchpad", "memory_search", "memory_forget", "memory_restore", "memory_status", "bash", "edit", "write"];
	try {
		leanMemory({
			on(name, fn) { hooks.set(name, [...(hooks.get(name) ?? []), fn]); },
			registerTool(tool) { tools.set(tool.name, tool); },
			registerCommand(name, options) { commands.set(name, options); },
			sendUserMessage(content, options) { sentMessages.push({ content, options }); },
			getActiveTools() { return [...activeTools]; },
			setActiveTools(names) { activeTools = [...names]; },
		} as ExtensionAPI);
	} finally {
		if (old === undefined) delete process.env.LEAN_MEMORY_DIR;
		else process.env.LEAN_MEMORY_DIR = old;
	}
	const ctx = { cwd, hasUI: false, waitForIdle: async () => {} } as unknown as ExtensionContext;
	return {
		ctx, hooks, tools, commands, sentMessages,
		activeToolNames: () => [...activeTools],
		async emit(name: string, event: any = {}, target: ExtensionContext = ctx) {
			let result;
			for (const fn of hooks.get(name) ?? []) result = await fn(event, target);
			return result;
		},
		async call(name: string, params: any, target: ExtensionContext = ctx) {
			return tools.get(name)!.execute("test", params, undefined, undefined, target);
		},
		async prompt(target: ExtensionContext = ctx) {
			let result;
			for (const fn of hooks.get("before_agent_start")!) result = await fn({ systemPrompt: "BASE", prompt: "task" }, target);
			return result.systemPrompt as string;
		},
	};
}

const text = (result: any) => JSON.stringify(result.content);

test("identity: canonical repo root, nested cwd, symlink alias and same-name repositories", async () => {
	assert.ok(a && b);
	assert.notEqual(a.id, b.id);
	await fs.mkdir(join(a.root, "nested"));
	await fs.symlink(a.root, join(temp, "alias"), "dir");
	assert.deepEqual(await identifyProject(join(a.root, "nested")), a);
	assert.deepEqual(await identifyProject(join(temp, "alias")), a);
});

test("review metadata is scoped, validated, and excluded from memory content", async () => {
	const isolated = new MemoryStore(join(temp, "review-memory"));
	const project: Project = { root: join(temp, "future-project"), id: "1".repeat(64) };
	const location = isolated.location("project", project);
	const reviewedAt = "2026-09-01T12:00:00.000Z";
	assert.equal(await isolated.hasReviewableContent(location), false);
	assert.equal(await isolated.lastReviewedAt(location), undefined);
	await isolated.write(location, "long_term", "REVIEWABLE_FACT");
	assert.equal(await isolated.hasReviewableContent(location), true);
	assert.ok(!(await isolated.files(location)).files.includes("REVIEW.json"));
	assert.deepEqual((await isolated.search([location], "lastReviewedAt")).results, []);
	await isolated.markReviewed(location, reviewedAt);
	assert.equal(await isolated.lastReviewedAt(location), reviewedAt);
	assert.ok(!(await isolated.snapshot(project)).includes("REVIEW.json"));
	assert.ok(!(await isolated.snapshot(project)).includes(reviewedAt));
	assert.equal(reviewIsDue(undefined, Date.parse(reviewedAt)), true);
	assert.equal(reviewIsDue(reviewedAt, Date.parse(reviewedAt) + 30 * 24 * 60 * 60 * 1000 - 1), false);
	assert.equal(reviewIsDue(reviewedAt, Date.parse(reviewedAt) + 30 * 24 * 60 * 60 * 1000), true);
	const global = isolated.location("global");
	assert.equal(await isolated.lastReviewedAt(global), undefined, "project review does not mark global reviewed");
	await fs.writeFile(join(location.dir, "REVIEW.json"), "{ malformed");
	await assert.rejects(isolated.lastReviewedAt(location), /Invalid review metadata/);
	await assert.rejects(isolated.markReviewed(location, "2026-09-02T12:00:00.000Z"), /Invalid review metadata/);
	assert.equal(await fs.readFile(join(location.dir, "REVIEW.json"), "utf8"), "{ malformed", "malformed metadata is preserved");
	const linkedProject: Project = { root: join(temp, "linked-project"), id: "2".repeat(64) };
	const linkedLocation = isolated.location("project", linkedProject);
	await fs.mkdir(linkedLocation.dir, { recursive: true });
	await fs.writeFile(join(temp, "outside-review.json"), JSON.stringify({ version: 1, lastReviewedAt: reviewedAt }));
	await fs.symlink(join(temp, "outside-review.json"), join(linkedLocation.dir, "REVIEW.json"));
	await assert.rejects(isolated.lastReviewedAt(linkedLocation), /symlink/);
	await assert.rejects(isolated.markReviewed(linkedLocation, reviewedAt), /symlink/);
	const blockedLocation = isolated.location("project", { root: join(temp, "blocked-project"), id: "3".repeat(64) });
	await fs.mkdir(join(blockedLocation.dir, "REVIEW.json"), { recursive: true });
	await assert.rejects(isolated.markReviewed(blockedLocation, reviewedAt), /not a regular file/);
	assert.equal((await fs.stat(join(blockedLocation.dir, "REVIEW.json"))).isDirectory(), true, "failed metadata writes preserve the blocking entry");
});

test("project inventory includes only real hash-named folders and safe Markdown files", async () => {
	const isolated = new MemoryStore(join(temp, "inventory-memory"));
	const id = "a".repeat(64);
	const projects = join(isolated.root, "projects");
	const directory = join(projects, id);
	await fs.mkdir(join(directory, "daily"), { recursive: true });
	await fs.mkdir(join(directory, "topics"), { recursive: true });
	await fs.mkdir(join(directory, "recovery"), { recursive: true });
	await fs.writeFile(join(directory, "MEMORY.md"), "VISIBLE_FACT");
	await fs.writeFile(join(directory, "daily", "2026-09-28.md"), "VISIBLE_DAILY");
	await fs.writeFile(join(directory, "topics", "guide.md"), "VISIBLE_TOPIC");
	await fs.writeFile(join(directory, "recovery", "backup.md"), "HIDDEN_RECOVERY");
	await fs.writeFile(join(directory, ".hidden.md"), "HIDDEN_FILE");
	await fs.writeFile(join(directory, "ignored.txt"), "NOT_MARKDOWN");
	await fs.symlink(join(directory, "MEMORY.md"), join(directory, "topics", "linked.md"));
	await fs.mkdir(join(projects, "not-a-project"));
	await fs.symlink(directory, join(projects, "b".repeat(64)), "dir");
	assert.deepEqual(await isolated.projectIds(), [id]);
	const location = isolated.location("project", { id, root: "" });
	assert.deepEqual((await isolated.files(location)).files, ["daily/2026-09-28.md", "MEMORY.md", "topics/guide.md"]);
	assert.equal(await isolated.readListedFile(location, "topics/guide.md"), "VISIBLE_TOPIC");
	await assert.rejects(isolated.readListedFile(location, "recovery/backup.md"), /not available/);
	await assert.rejects(isolated.readListedFile(location, "../../outside"), /not available/);
});

test("inherited Git routing cannot select another project's memory", async () => {
	const old = process.env.GIT_DIR;
	process.env.GIT_DIR = join(b.root, ".git");
	try { assert.deepEqual(await identifyProject(a.root), a); }
	finally {
		if (old === undefined) delete process.env.GIT_DIR;
		else process.env.GIT_DIR = old;
	}
});

test("Git metadata outside the worktree still uses the working-tree root", async () => {
	const tree = join(temp, "separate-tree");
	await exec("git", ["init", "--quiet", `--separate-git-dir=${join(temp, "separate-meta")}`, tree]);
	assert.equal((await identifyProject(tree))!.root, await fs.realpath(tree));
});

test("non-Git/bare directories are global-only; explicit roots must contain cwd", async () => {
	assert.equal(await identifyProject(nonGit), undefined);
	const bare = join(temp, "bare");
	await exec("git", ["init", "--bare", "--quiet", bare]);
	assert.equal(await identifyProject(bare), undefined);
	assert.equal((await identifyProject(nonGit, nonGit))!.root, await fs.realpath(nonGit));
	await assert.rejects(identifyProject(a.root, b.root), /outside/);
	await assert.rejects(identifyProject(nonGit, "relative"), /absolute/);
	assert.throws(() => store.location("project"), /No project/);
});

test("project facts, scratchpad and daily logs are isolated; only explicit globals cross projects", async () => {
	const ha = harness(a.root);
	assert.equal(ha.tools.size, 7);
	assert.equal(ha.hooks.has("session_shutdown"), true, "shutdown cleanup restores any temporary review tool set");
	await ha.call("memory_write", { target: "long_term", content: "PROJECT_A_PRIVATE" });
	await ha.call("memory_write", { target: "daily", content: "PROJECT_A_HISTORY" });
	await ha.call("scratchpad", { action: "add", text: "PROJECT_A_TASK" });
	await ha.call("memory_write", { scope: "global", target: "long_term", content: "UNIVERSAL_SAFEGUARD" });
	const own = await ha.prompt();
	assert.ok(own.startsWith("BASE"));
	assert.ok(own.includes("PROJECT_A_PRIVATE") && own.includes("PROJECT_A_TASK"));
	assert.ok(!own.includes("PROJECT_A_HISTORY"));
	const hb = harness(b.root);
	const unrelated = await hb.prompt();
	assert.ok(unrelated.includes("UNIVERSAL_SAFEGUARD"));
	assert.ok(!unrelated.includes("PROJECT_A_"));
	for (const target of ["long_term", "scratchpad", "daily"]) {
		assert.ok(!text(await hb.call("memory_read", { target })).includes("PROJECT_A_"));
	}
	assert.ok(!text(await hb.call("memory_search", { query: "PROJECT_A_HISTORY" })).includes("PROJECT_A_HISTORY"));
	assert.ok(text(await ha.call("memory_search", { query: "PROJECT_A_HISTORY" })).includes("PROJECT_A_HISTORY"));
	assert.ok(text(await hb.call("memory_search", { query: "UNIVERSAL_SAFEGUARD" })).includes("UNIVERSAL_SAFEGUARD"));
});

test("/memory review is user-initiated, scope-captured, and never edits notes", async () => {
	const isolated = new MemoryStore(join(temp, "review-command-memory"));
	const h = harness(a.root, isolated);
	await h.call("memory_write", { target: "long_term", content: "PROJECT_REVIEW_FACT" });
	await h.call("scratchpad", { action: "add", text: "PROJECT_REVIEW_TASK" });
	await h.call("memory_write", { scope: "global", target: "long_term", content: "GLOBAL_REVIEW_FACT" });
	await h.call("memory_write", { target: "long_term", content: "PROJECT_B_REVIEW_FACT" }, { ...h.ctx, cwd: b.root });
	const projectMemory = await isolated.read(isolated.location("project", a), "MEMORY.md");
	const globalMemory = await isolated.read(isolated.location("global"), "MEMORY.md");
	const notices: string[] = [];
	const uiCtx = { ...h.ctx, hasUI: true, ui: { notify: (message: string) => notices.push(message) } } as any;
	await h.emit("session_start", {}, uiCtx);
	assert.equal(notices.length, 1, "due global and project scopes share one reminder");
	assert.match(notices[0], /global memory.*api project memory/);
	assert.equal(h.sentMessages.length, 0, "a due reminder does not call the model");
	await h.prompt(uiCtx);
	assert.equal(notices.length, 1, "the reminder is not repeated in the same session");

	const command = h.commands.get("memory")!;
	await command.handler("review", uiCtx);
	assert.equal(h.sentMessages.length, 1, "only the explicit command starts a review turn");
	const request = h.sentMessages[0];
	assert.match(request.content as string, /only the Lean Memory facts and open tasks/);
	assert.match(request.content as string, /review turn has no tools/);
	assert.ok(!(request.content as string).includes("PROJECT_REVIEW_FACT"), "the already-injected notes are not duplicated in the user message");
	assert.equal((request.options as any).deliverAs, "followUp");
	assert.deepEqual(h.activeToolNames(), [], "all tools are disabled during the review turn");
	assert.equal(await isolated.lastReviewedAt(isolated.location("global")), undefined, "requesting advice alone does not mark review complete");
	await h.emit("agent_end");
	assert.ok(h.activeToolNames().includes("memory_write"), "the prior tool set is restored after review");

	const reviewLink = join(isolated.location("project", a).dir, "REVIEW.json");
	const blockedMetadata = join(temp, "blocked-review.json");
	await fs.writeFile(blockedMetadata, "external marker");
	await fs.symlink(blockedMetadata, reviewLink);
	uiCtx.cwd = b.root; // completion still marks the captured project A, not the new cwd
	await command.handler("review done", uiCtx);
	assert.ok(await isolated.lastReviewedAt(isolated.location("global")));
	await assert.rejects(isolated.lastReviewedAt(isolated.location("project", a)), /symlink/);
	assert.ok(notices.some(message => message.includes("Could not save review date for api project memory")));
	await fs.unlink(reviewLink);
	await command.handler("review done", uiCtx);
	assert.ok(await isolated.lastReviewedAt(isolated.location("project", a)));
	assert.equal(await isolated.lastReviewedAt(isolated.location("project", b)), undefined);
	assert.equal(await isolated.read(isolated.location("project", a), "MEMORY.md"), projectMemory);
	assert.equal(await isolated.read(isolated.location("global"), "MEMORY.md"), globalMemory);
	assert.ok(notices.some(message => message.includes("Memory contents were not changed")));
	await command.handler("review done", uiCtx);
	assert.ok(notices.some(message => message.includes("no pending memory review")));
	uiCtx.cwd = b.root;
	await h.prompt(uiCtx);
	assert.equal(notices.filter(message => message.includes("Memory review due")).length, 2, "entering another project checks its own review state");
	assert.equal(await isolated.lastReviewedAt(isolated.location("project", b)), undefined);
});

test("empty scopes stay quiet until reviewable memory is written", async () => {
	const isolated = new MemoryStore(join(temp, "review-empty-memory"));
	const h = harness(a.root, isolated);
	const notices: string[] = [];
	const uiCtx = { ...h.ctx, hasUI: true, ui: { notify: (message: string) => notices.push(message) } } as any;
	await h.emit("session_start", {}, uiCtx);
	assert.equal(notices.length, 0, "empty global/project scopes are not due for review");
	await h.call("memory_write", { target: "long_term", content: "NEW_REVIEWABLE_FACT" }, uiCtx);
	await h.prompt(uiCtx);
	assert.equal(notices.length, 1, "the scope is checked after it gains reviewable content");
	assert.match(notices[0], /Memory review due/);
});

test("/memory review falls back to global-only when project identity is unknown", async () => {
	const isolated = new MemoryStore(join(temp, "review-global-only"));
	const h = harness(nonGit, isolated);
	await h.call("memory_write", { scope: "global", target: "long_term", content: "GLOBAL_ONLY_REVIEW_FACT" });
	const notices: string[] = [];
	const uiCtx = { ...h.ctx, hasUI: true, ui: { notify: (message: string) => notices.push(message) } } as any;
	await h.emit("session_start", {}, uiCtx);
	assert.equal(notices.length, 1);
	assert.match(notices[0], /global memory/);
	assert.doesNotMatch(notices[0], /project memory/);
	await h.commands.get("memory")!.handler("review", uiCtx);
	await h.emit("agent_end");
	await h.commands.get("memory")!.handler("review done", uiCtx);
	assert.ok(await isolated.lastReviewedAt(isolated.location("global")));
	assert.equal(await isolated.projectIds().then(ids => ids.length), 0);
});

test("review reminders are silent without UI, but explicit review still works", async () => {
	const isolated = new MemoryStore(join(temp, "review-no-ui-memory"));
	const h = harness(a.root, isolated);
	await h.call("memory_write", { target: "long_term", content: "HEADLESS_REVIEW_FACT" });
	await h.emit("session_start");
	assert.equal(h.sentMessages.length, 0, "session startup never schedules a model review");
	assert.equal(await isolated.lastReviewedAt(isolated.location("project", a)), undefined);
	await h.commands.get("memory")!.handler("review", h.ctx);
	assert.equal(h.sentMessages.length, 1, "an explicit review command remains user-initiated in no-UI mode");
	assert.deepEqual(h.activeToolNames(), [], "mutation tools are still disabled for an explicit headless review");
	await h.emit("agent_end");
	assert.ok(h.activeToolNames().includes("memory_write"));
});

test("old mixed MEMORY.md, scratchpad, topics and logs are never auto-read or searched", async () => {
	await fs.writeFile(join(store.root, "MEMORY.md"), "LEGACY_UNRELATED");
	await fs.writeFile(join(store.root, "SCRATCHPAD.md"), "- [ ] LEGACY_UNRELATED");
	await fs.mkdir(join(store.root, "daily"));
	await fs.mkdir(join(store.root, "topics"));
	await fs.writeFile(join(store.root, "daily", `${today()}.md`), "LEGACY_UNRELATED");
	await fs.writeFile(join(store.root, "topics", "old.md"), "LEGACY_UNRELATED");
	const h = harness(b.root);
	assert.ok(!(await h.prompt()).includes("LEGACY_UNRELATED"));
	assert.ok(!text(await h.call("memory_search", { query: "LEGACY_UNRELATED" })).includes("LEGACY_UNRELATED"));
	assert.equal(await fs.readFile(join(store.root, "MEMORY.md"), "utf8"), "LEGACY_UNRELATED");
});

test("global-only context never silently turns a default project operation into a global operation", async () => {
	const h = harness(nonGit);
	assert.ok((await h.prompt()).includes("UNIVERSAL_SAFEGUARD"));
	await assert.rejects(h.call("memory_write", { target: "long_term", content: "wrong" }), /No project/);
	await assert.rejects(h.call("scratchpad", { action: "add", text: "wrong" }), /No project/);
	await assert.rejects(h.call("memory_read", { target: "daily" }), /No project/);
	await assert.rejects(h.call("memory_search", { scope: "project", query: "wrong" }), /No project/);
	assert.ok(text(await h.call("memory_read", { scope: "global", target: "long_term" })).includes("UNIVERSAL_SAFEGUARD"));
});

test("snapshots are stable; facts/tasks refresh, daily writes do not; successful compaction and cwd switch refresh", async () => {
	const h = harness(a.root);
	const initial = await h.prompt();
	assert.equal(await h.prompt(), initial);
	await h.call("memory_write", { target: "daily", content: "NEW_DAILY" });
	assert.equal(await h.prompt(), initial);
	await h.call("memory_write", { target: "long_term", content: "NEW_FACT" });
	assert.ok((await h.prompt()).includes("NEW_FACT"));
	await h.call("scratchpad", { action: "done", text: "PROJECT_A_TASK" });
	assert.ok(!(await h.prompt()).includes("PROJECT_A_TASK"));
	await store.write(store.location("project", a), "long_term", "EXTERNAL_WRITE");
	assert.ok(!(await h.prompt()).includes("EXTERNAL_WRITE"));
	await h.emit("session_compact");
	assert.ok((await h.prompt()).includes("EXTERNAL_WRITE"));
	h.ctx.cwd = b.root;
	assert.ok(!(await h.prompt()).includes("NEW_FACT"));
	await h.call("memory_write", { target: "long_term", content: "PROJECT_B_FACT" });
	assert.ok(!await store.read(store.location("project", a), "MEMORY.md").then(s => s.includes("PROJECT_B_FACT")));
});

test("/memory browses scoped entries, and falls back to a listing without a UI", async () => {
	const h = harness(a.root);
	await h.call("memory_write", { target: "long_term", content: "FACT_FOR_BROWSE" });
	await h.call("scratchpad", { action: "add", text: "TASK_FOR_BROWSE" });
	const command = h.commands.get("memory")!;
	const notices: string[] = [];
	await command.handler("", { ...h.ctx, hasUI: false, ui: { notify: (text: string) => notices.push(text) } } as any);
	assert.equal(notices.length, 1, "no-UI mode emits one listing instead of dialogs");
	assert.ok(notices[0].includes("TASK_FOR_BROWSE") && notices[0].includes("FACT_FOR_BROWSE"));
	const opened: string[] = [];
	const ui = {
		select: async (_title: string, items: string[]) => (opened.length ? undefined : items[0]),
		confirm: async (title: string, text: string) => { opened.push(`${title}\n${text}`); return true; },
	};
	await command.handler("", { ...h.ctx, hasUI: true, ui } as any);
	assert.equal(opened.length, 1, "one view, then dismissing the picker ends the loop");
	assert.ok(opened[0].startsWith("Open tasks (this project) · 1"));
	assert.ok(opened[0].includes("TASK_FOR_BROWSE"));
});

test("browser preview is loopback-only, token-gated, and carries no content in its shell", async () => {
	const preview = await startPreview(async () => ({ heading: "H", entries: [{ label: "L", text: "<script>alert(1)</script>" }] }));
	const token = new URL(preview.url).searchParams.get("token")!;
	const base = `http://127.0.0.1:${preview.port}`;
	try {
		assert.equal(new URL(preview.url).hostname, "127.0.0.1");
		assert.equal((await fetch(`${base}/data`)).status, 403, "no token is rejected");
		assert.equal((await fetch(`${base}/data?token=x`)).status, 403, "a short token is rejected without throwing");
		const wrong = (token[0] === "a" ? "b" : "a") + token.slice(1);
		assert.equal((await fetch(`${base}/data?token=${wrong}`)).status, 403, "a same-length wrong token is rejected");
		const response = await fetch(preview.url);
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.ok(!(await response.text()).includes("alert(1)"), "the shell never carries memory content");
		const data = await fetch(`${base}/data?token=${token}`);
		assert.equal(data.status, 200);
		assert.deepEqual(await data.json(), { heading: "H", entries: [{ label: "L", text: "<script>alert(1)</script>" }] });
		assert.equal((await fetch(`${base}/other?token=${token}`)).status, 404, "no request path is ever served from disk");
	} finally { await preview.close(); }
	await assert.rejects(fetch(preview.url), "the socket is gone after close");
});

test("/memory html browses all scopes, actual injection, fresh previews, and safe files", async () => {
	const h = harness(a.root);
	await h.call("memory_write", { target: "long_term", content: "FACT_FOR_HTML" });
	await h.call("memory_write", { scope: "global", target: "long_term", content: "GLOBAL_FOR_HTML" });
	await h.call("scratchpad", { action: "add", text: "TASK_FOR_HTML" });
	await store.write(store.location("project", b), "long_term", "FACT_FOR_OTHER_PROJECT");
	await fs.mkdir(join(store.location("project", a).dir, "topics"), { recursive: true });
	await fs.writeFile(join(store.location("project", a).dir, "topics", "guide.md"), "TOPIC_FOR_HTML");
	await fs.mkdir(join(store.location("project", a).dir, "daily"), { recursive: true });
	await fs.writeFile(join(store.location("project", a).dir, "daily", "2026-09-28.md"), "DAILY_FOR_HTML");
	await fs.mkdir(join(store.location("project", a).dir, "recovery"), { recursive: true });
	await fs.writeFile(join(store.location("project", a).dir, "recovery", "secret.json"), "RECOVERY_FOR_HTML");
	const legacyId = "f".repeat(64);
	const legacyDirectory = join(store.root, "projects", legacyId);
	await fs.mkdir(legacyDirectory, { recursive: true });
	await fs.writeFile(join(legacyDirectory, "MEMORY.md"), "LEGACY_PROJECT_WITHOUT_LABEL");
	const beforeMemory = await fs.readFile(join(store.location("project", a).dir, "MEMORY.md"), "utf8");
	const beforeGlobal = await fs.readFile(join(store.location("global").dir, "MEMORY.md"), "utf8");
	const command = h.commands.get("memory")!;
	const notices: string[] = [];
	const statuses: (string | undefined)[] = [];
	const ui = { notify: (text: string) => notices.push(text), setStatus: (_key: string, value?: string) => statuses.push(value) };
	// No `mode`, so this is not a terminal: the URL is announced and no browser launches.
	const ctx = { ...h.ctx, hasUI: true, ui } as any;
	try {
		await command.handler("html", ctx);
		const url = notices.join("\n").match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0];
		assert.ok(url, "the loopback URL is announced");
		assert.ok(statuses.some(status => status?.includes("127.0.0.1")), "status shows the port");
		const parsed = new URL(url);
		const base = `http://127.0.0.1:${parsed.port}`;
		const token = parsed.searchParams.get("token")!;
		const shell = await (await fetch(url)).text();
		assert.ok(shell.includes("Lean Memory"));
		assert.ok(shell.includes("textContent"), "memory content is rendered as text");
		const initial: any = await (await fetch(`${base}/data?token=${token}`)).json();
		assert.ok(initial.projects.some((project: any) => project.id === a.id && project.active));
		const otherProject = initial.projects.find((project: any) => project.id === b.id);
		assert.ok(otherProject, "all stored projects are discoverable");
		const projectOrder = (await store.projectIds()).indexOf(b.id) + 1;
		assert.equal(otherProject.label, `api · saved ${projectOrder}`, "saved names disambiguate duplicate folder names");
		assert.ok(!otherProject.label.includes(b.id), "project hashes are not shown");
		assert.equal(initial.projects.find((project: any) => project.id === a.id).label, "api · current");
		const legacyProject = initial.projects.find((project: any) => project.id === legacyId);
		assert.match(legacyProject.label, /^Saved project \d+$/, "older scopes stay unnamed without migration");
		assert.equal(await fs.readFile(join(legacyDirectory, "PROJECT.json")).catch(() => ""), "", "legacy scope receives no metadata write");
		assert.ok(initial.global.files.includes("MEMORY.md"));
		assert.equal(initial.actual, null, "the UI reports no actual injection before the first prompt");
		assert.equal(await store.projectName(a), basename(a.root));
		assert.ok(!(await store.files(store.location("project", a))).files.includes("PROJECT.json"));
		const prompt = await h.prompt();
		const expectedActual = prompt.slice("BASE".length);
		const data: any = await (await fetch(`${base}/data?token=${token}`)).json();
		assert.deepEqual(data.actual.text, expectedActual, "actual view captures exactly the extension-added prompt segment");
		assert.equal(data.actual.label, basename(a.root));
		assert.ok(!data.actual.label.includes(a.id), "project hashes are not shown in the actual label");
		assert.ok(!data.actual.text.includes("BASE"), "the base system prompt is not exposed");
		assert.ok(!data.actual.text.includes('"projectId"'), "name metadata is not injected into the prompt");
		const file = await (await fetch(`${base}/file?token=${token}&scope=project&id=${a.id}&file=topics%2Fguide.md`)).json() as any;
		assert.equal(file.text, "TOPIC_FOR_HTML");
		const daily = await (await fetch(`${base}/file?token=${token}&scope=project&id=${a.id}&file=daily%2F2026-09-28.md`)).json() as any;
		assert.equal(daily.text, "DAILY_FOR_HTML");
		assert.ok(data.projects.find((project: any) => project.id === a.id).files.includes("daily/2026-09-28.md"));
		assert.ok(!data.projects.find((project: any) => project.id === a.id).files.some((name: string) => name.includes("recovery")));
		const simulation: any = await (await fetch(`${base}/context?token=${token}&id=${b.id}`)).json();
		assert.ok(simulation.text.includes("FACT_FOR_OTHER_PROJECT") && simulation.text.includes("GLOBAL_FOR_HTML"));
		assert.ok(!simulation.text.includes("FACT_FOR_HTML"), "simulation stays within the selected project plus global");
		const activeSimulation: any = await (await fetch(`${base}/context?token=${token}&id=${a.id}`)).json();
		assert.ok(activeSimulation.text.includes("TASK_FOR_HTML") && activeSimulation.text.includes("GLOBAL_FOR_HTML"));
		assert.ok(!activeSimulation.text.includes("DAILY_FOR_HTML") && !activeSimulation.text.includes("TOPIC_FOR_HTML"));
		assert.ok(activeSimulation.text.indexOf("### global facts") < activeSimulation.text.indexOf("### project facts"), "snapshot ordering matches injection");
		assert.ok(!simulation.label.includes(b.id), "simulation labels do not expose project hashes");
		assert.equal(simulation.characters, Array.from(simulation.text).length);
		assert.equal(simulation.estimatedTokens, Math.ceil(Array.from(simulation.text).length / 4));
		assert.equal((await fetch(`${base}/file?token=${token}&scope=project&id=invalid&file=MEMORY.md`)).status, 500);
		const rejected = await fetch(`${base}/file?token=${token}&scope=project&id=${a.id}&file=..%2F..%2Foutside`);
		assert.equal(rejected.status, 500);
		assert.equal(await rejected.text(), "Memory read failed.", "validation errors never reveal filesystem paths");
		assert.equal((await fetch(`${base}/data?token=${token}`, { method: "POST" })).status, 404, "the preview is GET-only");
		await command.handler("close", ctx);
		assert.equal(await fetch(url).catch(() => null), null, "close stops the socket");
		assert.ok(notices.some(notice => notice.includes("stopped")));
		assert.equal(await fs.readFile(join(store.location("project", a).dir, "MEMORY.md"), "utf8"), beforeMemory);
		assert.equal(await fs.readFile(join(store.location("global").dir, "MEMORY.md"), "utf8"), beforeGlobal);
	} finally { await command.handler("close", ctx); }
});

test("snapshot cache keys by scope, so a load finishing last cannot reach another project", async () => {
	const cache = new SnapshotCache();
	let release!: (text: string) => void;
	const slow = new Promise<string>(resolve => { release = resolve; });
	const aLoad = cache.get("A", () => slow); // A finishes after B, as an interleaved turn would
	assert.equal(await cache.get("B", async () => "B_TEXT"), "B_TEXT");
	release("A_TEXT");
	assert.equal(await aLoad, "A_TEXT");
	const refuse = async () => { throw new Error("a cached snapshot must be reused, not reloaded"); };
	assert.equal(await cache.get("A", refuse), "A_TEXT");
	assert.equal(await cache.get("B", refuse), "B_TEXT");
});

test("an in-flight snapshot cannot repopulate the cache after invalidation", async () => {
	const cache = new SnapshotCache();
	let release!: (text: string) => void;
	const stale = cache.get("P", () => new Promise<string>(resolve => { release = resolve; }));
	cache.invalidate(); // a facts/task write landed while the snapshot was loading
	release("STALE_TEXT");
	assert.equal(await stale, "STALE_TEXT");
	assert.equal(await cache.get("P", async () => "FRESH_TEXT"), "FRESH_TEXT");
});

test("interleaved turns for two projects keep their ambient context separate", async () => {
	const h = harness(a.root);
	await h.call("memory_write", { target: "long_term", content: "INTERLEAVE_A" });
	h.ctx.cwd = b.root;
	await h.call("memory_write", { target: "long_term", content: "INTERLEAVE_B" });
	const context = (cwd: string) => ({ cwd, hasUI: false }) as ExtensionContext;
	const [first, second] = await Promise.all([h.prompt(context(a.root)), h.prompt(context(b.root))]);
	assert.ok(first.includes("INTERLEAVE_A") && !first.includes("INTERLEAVE_B"));
	assert.ok(second.includes("INTERLEAVE_B") && !second.includes("INTERLEAVE_A"));
	const after = await h.prompt(context(b.root));
	assert.ok(after.includes("INTERLEAVE_B"), "a later turn keeps its own project's snapshot");
	assert.ok(!after.includes("INTERLEAVE_A"), "a later turn must not inherit another project's snapshot");
});

test("forget/restore binds recovery to scope; preserves later writes and is idempotent", async () => {
	const la = store.location("project", a);
	const lb = store.location("project", b);
	await store.write(la, "long_term", "DELETE_ME");
	const id = (await store.forget(la, "long_term", "DELETE_ME"))!;
	assert.ok(id);
	await assert.rejects(store.restore(lb, id), /not found/);
	await assert.rejects(store.restore(store.location("global"), id), /not found/);
	await store.write(la, "long_term", "LATER_FACT");
	await store.restore(la, id);
	await store.restore(la, id);
	const result = await store.read(la, "MEMORY.md");
	assert.ok(result.includes("LATER_FACT"));
	assert.equal(result.split("DELETE_ME").length, 2);
	// Even a copied recovery file cannot cross the project boundary.
	await fs.mkdir(join(lb.dir, "recovery"), { recursive: true });
	await fs.copyFile(join(la.dir, "recovery", `${id}.json`), join(lb.dir, "recovery", `${id}.json`));
	await assert.rejects(store.restore(lb, id), /scope mismatch/);
});

test("scratchpad edits preserve unrelated lines; overwrite and clear_done create backups", async () => {
	const loc = store.location("project", b);
	await fs.writeFile(join(loc.dir, "SCRATCHPAD.md"), "# Context\nKeep this prose.\n- [ ] example\n  sub-note\n");
	await store.scratchpad(loc, "done", "example");
	await store.scratchpad(loc, "clear_done");
	const scratch = await store.scratchpad(loc, "list");
	assert.ok(scratch.includes("Keep this prose.") && scratch.includes("sub-note"));
	const before = await store.read(loc, "MEMORY.md");
	await store.write(loc, "long_term", "REPLACEMENT", "overwrite");
	const records = await fs.readdir(join(loc.dir, "recovery"));
	assert.ok((await Promise.all(records.map(f => fs.readFile(join(loc.dir, "recovery", f), "utf8")))).some(s => JSON.parse(s).content === before));
});

test("invalid dates, scope, targets, recovery traversal and multiline tasks fail before writing", async () => {
	const loc = store.location("project", a);
	for (const date of ["../../escape", "2026-02-30", "2026-13-01"]) {
		await assert.rejects(store.write(loc, "daily", "bad", "append", date));
	}
	await assert.rejects(store.write(loc, "daily", "bad", "overwrite"), /append-only/);
	await assert.rejects(store.restore(loc, "../../outside"), /Invalid recovery/);
	await assert.rejects(store.scratchpad(loc, "add", "line\n- [ ] injected"), /single line/);
	await assert.rejects(store.forget(loc, "long_term", "  "), /Non-empty/);
	assert.throws(() => store.location("other" as any, a), /Scope/);
	await assert.rejects(store.readTarget(loc, "../../other"), /Unknown/);
});

test("file and directory symlinks cannot cross project boundaries", async () => {
	const isolated = new MemoryStore(join(temp, "symlink-memory"));
	const la = isolated.location("project", a);
	const lb = isolated.location("project", b);
	await isolated.write(lb, "long_term", "PRIVATE_B");
	await fs.mkdir(la.dir, { recursive: true });
	await fs.symlink(join(lb.dir, "MEMORY.md"), join(la.dir, "MEMORY.md"));
	await assert.rejects(isolated.read(la, "MEMORY.md"), /symlink/);
	await assert.rejects(isolated.write(la, "long_term", "bad"), /symlink/);
	await fs.symlink(lb.dir, join(la.dir, "linked-directory"), "dir");
	assert.deepEqual((await isolated.search([la], "PRIVATE_B")).results, []);
	await fs.mkdir(join(isolated.root, "global"));
	await fs.symlink(lb.dir, join(isolated.root, "global", "daily"), "dir");
	await assert.rejects(isolated.write(isolated.location("global"), "daily", "bad"), /symlink/);
	assert.ok((await isolated.read(lb, "MEMORY.md")).includes("PRIVATE_B"));
});

test("failed recovery persistence leaves the original intact and releases the scope lock", async () => {
	const isolated = new MemoryStore(join(temp, "recovery-failure"));
	const loc = isolated.location("project", a);
	await isolated.write(loc, "long_term", "MUST_SURVIVE");
	const before = await isolated.read(loc, "MEMORY.md");
	await fs.writeFile(join(loc.dir, "recovery"), "not a directory");
	await assert.rejects(isolated.forget(loc, "long_term", "MUST_SURVIVE"), /Not a memory directory/);
	await assert.rejects(isolated.write(loc, "long_term", "replacement", "overwrite"), /Not a memory directory/);
	assert.equal(await isolated.read(loc, "MEMORY.md"), before);
	await assert.rejects(fs.stat(join(loc.dir, ".lock")), { code: "ENOENT" });
});

test("search scan limits are visible, and recovery content is never searchable", async () => {
	const isolated = new MemoryStore(join(temp, "search-limits"));
	const loc = isolated.location("project", a);
	await isolated.write(loc, "long_term", "FORGET_SECRET");
	await isolated.forget(loc, "long_term", "FORGET_SECRET");
	await fs.mkdir(join(loc.dir, "one/two/three/four"), { recursive: true });
	await fs.writeFile(join(loc.dir, "one/two/three/four", "deep.md"), "HIDDEN_DEEP");
	const result = await isolated.search([loc], "FORGET_SECRET");
	assert.deepEqual(result.results, []);
	assert.equal(result.truncated, true);
});

test("a search that exhausts the byte budget stops reading later scopes", async () => {
	const isolated = new MemoryStore(join(temp, "budget-scan"));
	const project = isolated.location("project", a);
	const global = isolated.location("global");
	await fs.mkdir(project.dir, { recursive: true });
	await fs.mkdir(global.dir, { recursive: true });
	const padding = "x".repeat(1024 * 1024 - 1);
	for (let i = 0;i < 9;i++) await fs.writeFile(join(project.dir, `pad-${i}.md`), padding);
	// Oversized, so any read of the global scope fails visibly instead of being scored.
	await fs.writeFile(join(global.dir, "answer.md"), "x".repeat(1024 * 1024 + 1));
	const result = await isolated.search([project, global], "global_term_here");
	assert.equal(result.truncated, true);
	assert.deepEqual(result.results, []);
});

test("file listings page by offset/limit with a continuation marker", async () => {
	const isolated = new MemoryStore(join(temp, "list-paging"));
	const loc = isolated.location("project", a);
	await fs.mkdir(join(loc.dir, "topics"), { recursive: true });
	for (let i = 0;i < 12;i++) await fs.writeFile(join(loc.dir, "topics", `note-${String(i).padStart(2, "0")}.md`), "x");
	const listing = (await isolated.files(loc)).files.join("\n");
	const marker = (offset: number) => `\n[More: offset ${offset}; ${listing.length} characters total]`;
	assert.equal(await isolated.readTarget(loc, "list", undefined, 0, 40), listing.slice(0, 40) + marker(40));
	assert.equal(await isolated.readTarget(loc, "list", undefined, 40, 40), listing.slice(40, 80) + marker(80));
	assert.equal(await isolated.readTarget(loc, "list", undefined, listing.length, 40), "");
});

test("bounded reads, snapshots and search explicitly signal omissions", async () => {
	const isolated = new MemoryStore(join(temp, "budget-memory"));
	const loc = isolated.location("project", a);
	await isolated.write(loc, "long_term", "- Safety first\n" + "- detail\n".repeat(1000));
	const snapshot = await isolated.snapshot(a);
	assert.ok(snapshot.includes("Safety first") && snapshot.includes("Content omitted"));
	assert.ok(snapshot.length < 3000);
	assert.ok((await isolated.readTarget(loc, "long_term", undefined, 0, 30)).includes("More: offset 30"));
	await assert.rejects(isolated.readTarget(loc, "long_term", undefined, -1));
	await assert.rejects(isolated.write(loc, "long_term", "x".repeat(1024 * 1024)), /exceed/);
	assert.ok((await isolated.read(loc, "MEMORY.md")).includes("Safety first"));
	await assert.rejects(isolated.search([loc], "!!!"), /keyword/);
	await assert.rejects(isolated.search([loc], "detail", 100), /limit/);
});

test("concurrent append operations do not lose entries", async () => {
	const loc = store.location("project", a);
	await Promise.all(Array.from({ length: 12 }, (_, i) => store.write(loc, "daily", `CONCURRENT_${i}_END`)));
	const result = await store.readTarget(loc, "daily", undefined, 0, 12000);
	for (let i = 0;i < 12;i++) assert.ok(result.includes(`CONCURRENT_${i}_END`));
});

test("separate processes use the same lock and retain both writes", async () => {
	const script = `const {createJiti}=require('jiti'); createJiti(process.cwd()+'/index.ts').import('./store.ts').then(async ({MemoryStore})=>{const s=new MemoryStore(process.env.TEST_MEMORY_ROOT);await s.write(s.location('project',JSON.parse(process.env.TEST_PROJECT)), 'daily', process.env.TEST_ENTRY);}).catch(e=>{console.error(e);process.exitCode=1;});`;
	await Promise.all(["CHILD_ONE", "CHILD_TWO"].map(entry => exec(process.execPath, ["--conditions=import", "-e", script], { cwd: resolve(__dirname, ".."), env: { ...process.env, TEST_MEMORY_ROOT: store.root, TEST_PROJECT: JSON.stringify(a), TEST_ENTRY: entry }, timeout: 15000 })));
	const result = await store.readTarget(store.location("project", a), "daily", undefined, 0, 12000);
	assert.ok(result.includes("CHILD_ONE") && result.includes("CHILD_TWO"));
});
