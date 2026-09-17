import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { MemoryEntry } from "./store.ts";

export interface PreviewData { heading: string; entries: MemoryEntry[] }
export interface Preview { url: string; port: number; close(): Promise<void> }

// The shell is fully static: it carries no memory content and no request-derived data.
// All entries arrive as JSON and are written with textContent, so a note containing
// markup or a script tag can never execute or inject into the page.
function shellFor(nonce: string): string {
	return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lean Memory</title>
<style>
 :root { color-scheme: dark light }
 body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace }
 header { display: flex; gap: 12px; align-items: baseline; padding: 10px 14px; border-bottom: 1px solid #8884 }
 h1 { margin: 0; font-size: 15px }
 #updated { margin-left: auto; font-size: 12px; opacity: .6 }
 main { display: grid; grid-template-columns: minmax(190px, 270px) 1fr; height: calc(100vh - 46px) }
 nav { overflow: auto; padding: 8px 0; border-right: 1px solid #8884 }
 nav button { display: block; width: 100%; padding: 6px 14px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer }
 nav button[aria-current="true"] { background: #8882; font-weight: 600 }
 section { overflow: auto; padding: 14px }
 pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere }
 .empty { opacity: .6 }
</style>
<header><h1 id="title">Memory</h1><span id="updated"></span></header>
<main><nav id="nav"></nav><section><pre id="content" class="empty">loading…</pre></section></main>
<script nonce="${nonce}">
const token = new URLSearchParams(location.search).get("token") || "";
let current = null;

function show(entries) {
	const entry = entries.find(e => e.label === current);
	const content = document.getElementById("content");
	content.textContent = entry ? entry.text : "(no entries)";
	content.className = entry && entry.text.startsWith("(") ? "empty" : "";
	for (const button of document.querySelectorAll("nav button"))
		button.setAttribute("aria-current", String(button.textContent === current));
}

function draw(data) {
	document.getElementById("title").textContent = data.heading;
	if (!data.entries.some(e => e.label === current)) current = data.entries[0]?.label ?? null;
	document.getElementById("nav").replaceChildren(...data.entries.map(entry => {
		const button = document.createElement("button");
		button.textContent = entry.label;
		button.onclick = () => { current = entry.label; show(data.entries); };
		return button;
	}));
	show(data.entries);
}

async function tick() {
	const stamp = document.getElementById("updated");
	try {
		const response = await fetch("/data?token=" + encodeURIComponent(token), { cache: "no-store" });
		if (!response.ok) { stamp.textContent = "not authorized"; return; }
		draw(await response.json());
		stamp.textContent = "updated " + new Date().toLocaleTimeString();
	} catch { stamp.textContent = "disconnected"; }
}

tick();
setInterval(tick, 2000);
</script>
</html>
`;
}

// Loopback-only, token-gated, read-only. No request path, header or body is ever
// turned into a filesystem path, and no write endpoint exists.
export async function startPreview(load: () => Promise<PreviewData>): Promise<Preview> {
	const token = randomBytes(24).toString("base64url");
	const nonce = randomBytes(16).toString("base64");
	const shell = shellFor(nonce);
	const expected = Buffer.from(token);
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const provided = Buffer.from(url.searchParams.get("token") ?? "");
		if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
			response.writeHead(403, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
			response.end("Forbidden");
			return;
		}
		if (request.method === "GET" && url.pathname === "/") {
			response.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
				"content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'`,
			});
			response.end(shell);
			return;
		}
		if (request.method === "GET" && url.pathname === "/data") {
			try {
				response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
				response.end(JSON.stringify(await load()));
			} catch {
				response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
				response.end("Memory read failed.");
			}
			return;
		}
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
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
