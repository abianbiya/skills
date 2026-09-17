#!/usr/bin/env node
/* Compare JSON files produced by /llm-audit-export. No dependencies required. */
const fs = require("node:fs");

const files = process.argv.slice(2);
if (files.length < 2) {
  console.error(
    "Usage: node compare-reports.js baseline.export.json candidate.export.json [...]",
  );
  process.exit(1);
}
const sum = (items, pick) =>
  items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
const bytes = (n) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(2)} MiB`
    : `${(n / 1024).toFixed(1)} KiB`;
const rows = files.map((file) => {
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  const requests = Array.isArray(report.requests) ? report.requests : [];
  const first = requests[0]?.analysis?.sections ?? {};
  const input = sum(requests, (r) => r.usage?.inputTokens);
  const cached = sum(requests, (r) => r.usage?.cacheReadTokens);
  return {
    name: file,
    requests: report.session?.requestCount ?? requests.length,
    turns: report.session?.userTurns ?? 0,
    firstFixed:
      (first.systemBytes || 0) +
      (first.developerBytes || 0) +
      (first.toolDefinitionBytes || 0),
    toolSchemas: sum(
      requests,
      (r) => r.analysis?.sections?.toolDefinitionBytes,
    ),
    system: sum(
      requests,
      (r) =>
        (r.analysis?.sections?.systemBytes || 0) +
        (r.analysis?.sections?.developerBytes || 0),
    ),
    growth:
      requests.length > 1
        ? requests.at(-1).analysis.payloadBytes -
          requests[0].analysis.payloadBytes
        : 0,
    input,
    output: sum(requests, (r) => r.usage?.outputTokens),
    cached,
    latency: sum(requests, (r) => r.timing?.totalRequestMs),
    cost: sum(requests, (r) => r.usage?.totalCost),
  };
});
console.log(
  "run\trequests\tcalls/turn\tfirst fixed\ttool schemas\tsystem\thistory growth\tinput\toutput\tcache ratio\tlatency\tcost",
);
for (const row of rows) {
  console.log(
    `${row.name}\t${row.requests}\t${row.turns ? (row.requests / row.turns).toFixed(2) : "n/a"}\t${bytes(row.firstFixed)}\t${bytes(row.toolSchemas)}\t${bytes(row.system)}\t${bytes(row.growth)}\t${row.input}\t${row.output}\t${row.input ? ((row.cached / row.input) * 100).toFixed(1) + "%" : "n/a"}\t${(row.latency / 1000).toFixed(2)}s\t$${row.cost.toFixed(6)}`,
  );
}
