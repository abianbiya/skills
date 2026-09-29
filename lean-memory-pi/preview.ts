import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

export interface PreviewRequest {
	pathname: string;
	searchParams: URLSearchParams;
}
export interface Preview {
	url: string;
	port: number;
	close(): Promise<void>;
}

// The shell is fully static: memory arrives as JSON and is rendered with textContent.
function shellFor(nonce: string): string {
	return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Lean Memory</title>
<style>
 :root { color-scheme: light; --ink:#202825; --muted:#68736d; --line:#e2e8e3; --paper:#fff; --wash:#f5f7f5; --accent:#236b52; --accent-wash:#e7f1ec }
 * { box-sizing:border-box }
 body { margin:0; background:var(--wash); color:var(--ink); font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif }
 button,select { font:inherit }
 .topbar { height:64px; display:flex; align-items:center; gap:14px; padding:0 24px; background:var(--paper); border-bottom:1px solid var(--line) }
 .mark { width:30px; height:30px; display:grid; place-items:center; border-radius:9px; background:var(--accent-wash); color:var(--accent); font-weight:750 }
 h1 { margin:0; font-size:18px; letter-spacing:-.02em }
 .eyebrow { color:var(--muted); font-size:11px; letter-spacing:.12em; text-transform:uppercase }
 #updated { margin-left:auto; color:var(--muted); font-size:12px }
 .layout { display:grid; grid-template-columns:250px minmax(0,1fr); max-width:1440px; min-height:calc(100vh - 64px); margin:0 auto }
 aside { display:flex; flex-direction:column; gap:8px; padding:22px 14px; border-right:1px solid var(--line); background:#fafbfa }
 .nav-title { margin:0 10px 7px; color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.1em; text-transform:uppercase }
 .scope-button { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; padding:9px 10px; border:1px solid transparent; border-radius:8px; background:transparent; color:inherit; text-align:left; cursor:pointer }
 .scope-button small { color:var(--muted); font-size:11px }
 .scope-button:hover { background:#edf2ee }
 .scope-button[aria-pressed="true"] { border-color:#d6e5dc; background:var(--accent-wash); color:#174e3b; font-weight:650 }
 .aside-note { margin:auto 10px 0; color:var(--muted); font-size:11px }
 .content { min-width:0; padding:30px clamp(18px,4vw,56px) 50px }
 .content-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px }
 h2 { margin:0; font-size:24px; letter-spacing:-.035em }
 .subhead { margin:4px 0 0; color:var(--muted); font-size:13px }
 .tabs,.segmented { display:flex; gap:3px; padding:3px; border:1px solid var(--line); border-radius:9px; background:var(--paper) }
 .tabs button,.segmented button { padding:7px 12px; border:0; border-radius:6px; background:transparent; color:var(--muted); cursor:pointer }
 .tabs button[aria-selected="true"],.segmented button[aria-pressed="true"] { background:var(--accent-wash); color:var(--accent); font-weight:650 }
 .card { overflow:hidden; border:1px solid var(--line); border-radius:12px; background:var(--paper); box-shadow:0 4px 16px #1c34240a }
 .toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:12px; min-height:58px; padding:10px 16px; border-bottom:1px solid var(--line) }
 label { color:var(--muted); font-size:12px; font-weight:600 }
 select { min-width:min(320px,100%); padding:7px 32px 7px 10px; border:1px solid var(--line); border-radius:7px; background:var(--paper); color:var(--ink) }
 .meta { margin-left:auto; color:var(--muted); font-size:12px }
 .markdown { min-height:250px; max-height:calc(100vh - 290px); overflow:auto; padding:22px; color:#29342e; font-size:14px; line-height:1.7; overflow-wrap:anywhere }
 .markdown.empty { color:var(--muted) }
 .markdown-body > :first-child { margin-top:0 }
 .markdown-body > :last-child { margin-bottom:0 }
 .markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4 { margin:1.35em 0 .45em; line-height:1.3; letter-spacing:-.02em }
 .markdown-body h1 { font-size:1.55em }.markdown-body h2 { font-size:1.3em }.markdown-body h3 { font-size:1.12em }.markdown-body h4 { font-size:1em }
 .markdown-body p { margin:.65em 0 }
 .markdown-body ul,.markdown-body ol { margin:.55em 0; padding-left:1.5em }
 .markdown-body li + li { margin-top:.2em }
 .markdown-body blockquote { margin:.8em 0; padding:.15em 1em; border-left:3px solid #c9d9cf; color:var(--muted) }
 .markdown-body code { padding:.12em .35em; border-radius:4px; background:#f0f3f0; font: .9em ui-monospace,SFMono-Regular,Menlo,monospace }
 .markdown-body pre { overflow:auto; margin:.8em 0; padding:14px; border-radius:8px; background:#f4f6f4; font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap }
 .markdown-body pre code { padding:0; background:transparent }
 .markdown-body a { color:var(--accent); text-decoration-thickness:1px; text-underline-offset:2px }
 .markdown-body hr { border:0; border-top:1px solid var(--line); margin:1em 0 }
 .context-note { margin:0; padding:14px 18px; border-bottom:1px solid var(--line); color:var(--muted); font-size:12px }
 .metrics { display:flex; gap:8px; margin-left:auto; color:var(--muted); font-size:12px }
 .pill { padding:3px 8px; border-radius:99px; background:var(--wash) }
 :focus-visible { outline:3px solid #5aab88; outline-offset:2px }
 button:focus-visible,select:focus-visible { position:relative; z-index:1 }
 [hidden] { display:none !important }
 @media (max-width:720px) {
  .topbar { height:58px; padding:0 16px }
  .layout { display:block; min-height:calc(100vh - 58px) }
  aside { flex-direction:row; overflow:auto; gap:6px; padding:10px 12px; border-right:0; border-bottom:1px solid var(--line) }
  .nav-title,.aside-note { display:none }
  .scope-button { width:auto; flex:0 0 auto; white-space:nowrap }
  .content { padding:22px 14px 32px }
  .content-head { align-items:flex-start; flex-direction:column; margin-bottom:16px }
  .tabs { align-self:stretch }
  .tabs button { flex:1 }
  .meta,.metrics { margin-left:0 }
  .toolbar { align-items:flex-start; flex-direction:column }
  select { width:100%; min-width:0 }
  .markdown { min-height:220px; max-height:none; padding:16px }
 }
</style>
</head>
<body>
<header class="topbar"><div class="mark" aria-hidden="true">L</div><div><div class="eyebrow">Local workspace</div><h1>Lean Memory</h1></div><span id="updated" aria-live="polite">Connecting…</span></header>
<main class="layout">
 <aside aria-label="Memory scopes"><p class="nav-title">Scopes</p><button id="global" class="scope-button" type="button" aria-pressed="false"><span>Global</span><small>Shared</small></button><div id="projects" role="group" aria-label="Projects"></div><p class="aside-note">Read-only · stays on this machine</p></aside>
 <section class="content">
  <div class="content-head"><div><h2 id="scopeTitle">Memory</h2><p id="scopeHint" class="subhead">Browse stored notes or inspect prompt context.</p></div><div class="tabs" role="tablist" aria-label="Memory view"><button id="filesTab" type="button" role="tab" aria-selected="true">Stored files</button><button id="contextTab" type="button" role="tab" aria-selected="false">Prompt context</button></div></div>
  <section id="filesView" class="card" aria-label="Stored memory files"><div class="toolbar"><label for="fileSelect">Memory file</label><select id="fileSelect"></select><span id="fileMeta" class="meta"></span></div><div id="fileText" class="markdown empty" aria-live="polite">Choose a scope to browse its files.</div></section>
  <section id="contextView" class="card" aria-label="Prompt context" hidden><div class="toolbar"><div class="segmented" role="group" aria-label="Context mode"><button id="actualTab" type="button" aria-pressed="true">Actual injection</button><button id="previewTab" type="button" aria-pressed="false">Project preview</button></div><div id="contextMetrics" class="metrics"></div></div><p id="contextNote" class="context-note"></p><div id="contextText" class="markdown empty" aria-live="polite">No context selected.</div></section>
 </section>
</main>
<script nonce="${nonce}">
const token = new URLSearchParams(location.search).get("token") || "";
let inventory = null;
let selected = { scope:"global" };
let activeView = "files";
let contextMode = "actual";
let selectedFile = "";
let busy = false;
let initialSelectionDone = false;

async function api(path, params = {}) {
 const query = new URLSearchParams({ token, ...params });
 const response = await fetch(path + "?" + query, { cache:"no-store", credentials:"same-origin" });
 if (!response.ok) throw new Error("Memory request failed (" + response.status + ").");
 return response.json();
}
function scopeData() {
 if (selected.scope === "global") return { label:"Global", files:inventory?.global?.files || [], truncated:inventory?.global?.truncated || false };
 return inventory?.projects?.find(project => project.id === selected.id) || { label:"Project", files:[], truncated:false };
}
function updateScopeButtons() {
 const global = document.getElementById("global");
 global.setAttribute("aria-pressed", String(selected.scope === "global"));
 document.getElementById("projects").replaceChildren(...(inventory?.projects || []).map(project => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scope-button";
  button.setAttribute("aria-pressed", String(selected.scope === "project" && selected.id === project.id));
  button.title = project.label;
  const name = document.createElement("span"); name.textContent = project.label;
  const count = document.createElement("small"); count.textContent = String(project.files.length) + (project.truncated ? "+" : "") + " files";
  button.append(name, count);
  button.addEventListener("click", () => { selected = { scope:"project", id:project.id }; selectedFile = ""; render(); });
  return button;
 }));
 const data = scopeData();
 document.getElementById("scopeTitle").textContent = data.label;
 document.getElementById("scopeHint").textContent = selected.scope === "global" ? "Shared notes and safeguards." : "Project-specific facts, tasks, and files.";
}
function updateTabs() {
 document.getElementById("filesView").hidden = activeView !== "files";
 document.getElementById("contextView").hidden = activeView !== "context";
 document.getElementById("filesTab").setAttribute("aria-selected", String(activeView === "files"));
 document.getElementById("contextTab").setAttribute("aria-selected", String(activeView === "context"));
 document.getElementById("actualTab").setAttribute("aria-pressed", String(contextMode === "actual"));
 document.getElementById("previewTab").setAttribute("aria-pressed", String(contextMode === "preview"));
}
function estimate(text) {
 const chars = Array.from(text).length;
 const tokens = Math.ceil(chars / 4);
 document.getElementById("contextMetrics").replaceChildren();
 for (const label of [chars.toLocaleString() + " characters", "≈ " + tokens.toLocaleString() + " tokens · rough estimate"]) {
  const pill = document.createElement("span"); pill.className = "pill"; pill.textContent = label;
  document.getElementById("contextMetrics").append(pill);
 }
}
// ponytail: render the common safe Markdown subset without shipping a dependency; use a vetted CommonMark parser if full GFM/table support is needed.
function appendInline(parent, source) {
 const pattern = /(\x60[^\x60]+\x60|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
 let cursor = 0;
 for (const match of source.matchAll(pattern)) {
  parent.append(document.createTextNode(source.slice(cursor, match.index)));
  const token = match[0];
  let node;
  if (token.startsWith("**") || token.startsWith("__")) {
   node = document.createElement("strong"); node.textContent = token.slice(2, -2);
  } else if (token.startsWith("~~")) {
   node = document.createElement("del"); node.textContent = token.slice(2, -2);
  } else if (token.startsWith("*") || token.startsWith("_")) {
   node = document.createElement("em"); node.textContent = token.slice(1, -1);
  } else if (token.charCodeAt(0) === 96) {
   node = document.createElement("code"); node.textContent = token.slice(1, -1);
  } else {
   const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
   try {
    const url = new URL(link[2]);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsafe link");
    node = document.createElement("a"); node.textContent = link[1]; node.href = url.href;
    node.target = "_blank"; node.rel = "noopener noreferrer"; node.referrerPolicy = "no-referrer";
   } catch { node = document.createTextNode(token); }
  }
  parent.append(node);
  cursor = match.index + token.length;
 }
 parent.append(document.createTextNode(source.slice(cursor)));
}
function showMarkdown(target, source, empty = false) {
 const root = document.createElement("div"); root.className = "markdown-body";
 const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
 let paragraph = [];
 let list = null;
 let listKind = "";
 let codeLines = null;
 const fenceMarker = String.fromCharCode(96).repeat(3);
 function flushParagraph() {
  if (!paragraph.length) return;
  const p = document.createElement("p"); appendInline(p, paragraph.join(" ")); root.append(p); paragraph = [];
 }
 function closeList() { list = null; listKind = ""; }
 function appendCode() {
  const pre = document.createElement("pre"); const code = document.createElement("code");
  code.textContent = codeLines.join("\n"); pre.append(code); root.append(pre); codeLines = null;
 }
 for (const line of lines) {
  if (codeLines !== null) {
   if (line.trimStart().startsWith(fenceMarker)) appendCode(); else codeLines.push(line);
   continue;
  }
  if (line.trimStart().startsWith(fenceMarker)) { flushParagraph(); closeList(); codeLines = []; continue; }
  if (!line.trim()) { flushParagraph(); closeList(); continue; }
  const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
  if (heading) {
   flushParagraph(); closeList();
   const element = document.createElement("h" + heading[1].length); appendInline(element, heading[2]); root.append(element); continue;
  }
  const item = /^\s{0,3}(?:([-+*])|(\d+)[.)])\s+(.*)$/.exec(line);
  if (item) {
   flushParagraph();
   const kind = item[2] ? "ol" : "ul";
   if (!list || listKind !== kind) { closeList(); list = document.createElement(kind); listKind = kind; root.append(list); }
   const li = document.createElement("li"); appendInline(li, item[3]); list.append(li); continue;
  }
  const quote = /^\s{0,3}>\s?(.*)$/.exec(line);
  if (quote) {
   flushParagraph(); closeList();
   const block = document.createElement("blockquote"); const p = document.createElement("p"); appendInline(p, quote[1]); block.append(p); root.append(block); continue;
  }
  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
   flushParagraph(); closeList(); root.append(document.createElement("hr")); continue;
  }
  closeList(); paragraph.push(line.trim());
 }
 flushParagraph(); closeList();
 if (codeLines !== null) appendCode();
 target.className = empty ? "markdown empty" : "markdown";
 target.replaceChildren(root);
}
async function loadFile() {
 const file = document.getElementById("fileSelect").value;
 selectedFile = file;
 if (!file) {
  showMarkdown(document.getElementById("fileText"), "No Markdown files in this scope.", true);
  document.getElementById("fileMeta").textContent = "";
  return;
 }
 try {
  const params = { scope:selected.scope, file };
  if (selected.scope === "project") params.id = selected.id;
  const result = await api("/file", params);
  showMarkdown(document.getElementById("fileText"), result.text || "(empty file)", !result.text);
  document.getElementById("fileMeta").textContent = result.text.length.toLocaleString() + " characters";
 } catch (error) {
  showMarkdown(document.getElementById("fileText"), error.message, true);
  document.getElementById("fileMeta").textContent = "";
 }
}
async function loadContext() {
 const content = document.getElementById("contextText");
 const note = document.getElementById("contextNote");
 const actual = inventory?.actual || null;
 try {
  if (contextMode === "actual") {
   if (!actual) {
    showMarkdown(content, "No actual injection has been captured yet. It appears after Lean Memory handles a prompt in this session.", true);
    note.textContent = "This shows only the latest text added by Lean Memory, never Pi’s base system prompt.";
    document.getElementById("contextMetrics").replaceChildren(); return;
   }
   showMarkdown(content, actual.text, !actual.text);
   estimate(actual.text);
   note.textContent = "Actual injection · " + actual.label + " · captured " + new Date(actual.capturedAt).toLocaleTimeString() + ". Only Lean Memory’s appended segment is shown.";
   return;
  }
  const params = {};
  if (selected.scope === "project") params.id = selected.id;
  const result = await api("/context", params);
  showMarkdown(content, result.text || "(no facts or open tasks would be injected)", !result.text);
  estimate(result.text);
  note.textContent = "Simulation from current disk state · " + result.label + ". Facts and open tasks only; daily/topic files are not auto-injected. This is the memory payload, not Pi’s full prompt.";
 } catch (error) {
  showMarkdown(content, error.message, true);
  document.getElementById("contextMetrics").replaceChildren();
  note.textContent = "Could not load context.";
 }
}
async function render() {
 if (!inventory) return;
 updateScopeButtons(); updateTabs();
 const data = scopeData();
 const select = document.getElementById("fileSelect");
 const files = data.files;
 if (!files.includes(selectedFile)) selectedFile = files[0] || "";
 select.replaceChildren(...files.map(file => { const option = document.createElement("option"); option.value = file; option.textContent = file; return option; }));
 select.value = selectedFile;
 document.getElementById("fileMeta").textContent = data.truncated ? "File list capped" : files.length + " file" + (files.length === 1 ? "" : "s");
 if (activeView === "files") await loadFile(); else await loadContext();
}
async function refresh() {
 if (busy) return;
 busy = true;
 try {
  inventory = await api("/data");
  if (!initialSelectionDone) {
   if (inventory.activeProject) selected = { scope:"project", id:inventory.activeProject };
   initialSelectionDone = true;
  } else if (selected.scope === "project" && !inventory.projects.some(project => project.id === selected.id)) {
   selected = { scope:"global" };
  }
  await render();
  document.getElementById("updated").textContent = "Updated " + new Date().toLocaleTimeString();
 } catch (error) { document.getElementById("updated").textContent = error.message; }
 finally { busy = false; }
}
document.getElementById("global").addEventListener("click", () => { initialSelectionDone = true; selected = { scope:"global" }; selectedFile = ""; render(); });
document.getElementById("filesTab").addEventListener("click", () => { activeView = "files"; render(); });
document.getElementById("contextTab").addEventListener("click", () => { activeView = "context"; render(); });
document.getElementById("actualTab").addEventListener("click", () => { contextMode = "actual"; render(); });
document.getElementById("previewTab").addEventListener("click", () => { contextMode = "preview"; render(); });
document.getElementById("fileSelect").addEventListener("change", loadFile);
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}

// Loopback-only, token-gated, read-only. Request data is passed to the extension
// only after route matching; no URL path is ever converted into a filesystem path.
export async function startPreview(load: (request: PreviewRequest) => Promise<unknown>): Promise<Preview> {
	const token = randomBytes(24).toString("base64url");
	const nonce = randomBytes(16).toString("base64");
	const shell = shellFor(nonce);
	const expected = Buffer.from(token);
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const provided = Buffer.from(url.searchParams.get("token") ?? "");
		if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
			response.writeHead(403, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" });
			response.end("Forbidden");
			return;
		}
		if (request.method === "GET" && url.pathname === "/") {
			response.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
				"referrer-policy": "no-referrer",
				"x-frame-options": "DENY",
				"content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'`,
			});
			response.end(shell);
			return;
		}
		if (request.method === "GET" && ["/data", "/file", "/context"].includes(url.pathname)) {
			try {
				const searchParams = new URLSearchParams(url.searchParams);
				searchParams.delete("token");
				const result = await load({ pathname: url.pathname, searchParams });
				response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
				response.end(JSON.stringify(result));
			} catch {
				response.writeHead(500, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
				response.end("Memory read failed.");
			}
			return;
		}
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
		response.end("Not found");
	});
	server.unref(); // never keeps the pi process alive on exit
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("Lean memory preview did not bind a loopback port.");
	}
	return {
		url: `http://127.0.0.1:${address.port}/?token=${token}`,
		port: address.port,
		close: () => new Promise<void>(resolve => {
			server.closeAllConnections();
			server.close(() => resolve());
		}),
	};
}
