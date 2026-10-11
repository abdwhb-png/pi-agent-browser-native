/**
 * Purpose: Extension-level semanticAction success prose and navigation probe coverage.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readArray, readRecord, readString } from "./helpers/assertions.js";

import {
	createExtensionHarness,
	executeRegisteredTool,
	readInvocationLog,
	runExtensionEvent,
	withPatchedEnv,
	writeFakeAgentBrowserBinary,
} from "./helpers/agent-browser-harness.js";

test(
	"agentBrowserExtension enriches semanticAction click success with page state probe and prose parity",
	{ concurrency: false },
	async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-semantic-success-"));
		const logPath = join(tempDir, "invocations.log");
		const basePath = process.env.PATH ?? "";
		await writeFakeAgentBrowserBinary(
			tempDir,
			`const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args }) + "\\n");
const valueFlags = new Set(["--session"]);
let commandIndex = -1;
for (let i = 0; i < args.length; i += 1) {
  const token = args[i];
  if (token === "--json") continue;
  if (valueFlags.has(token)) { i += 1; continue; }
  if (token.startsWith("--")) continue;
  commandIndex = i;
  break;
}
const command = args[commandIndex];
if (command === "find") {
  process.stdout.write(JSON.stringify({ success: true, data: { clicked: "[data-agent-browser-located='true']" } }));
} else if (command === "get" && args[commandIndex + 1] === "url") {
  process.stdout.write(JSON.stringify({ success: true, data: { result: "https://example.test/", url: "https://example.test/" } }));
} else if (command === "get" && args[commandIndex + 1] === "title") {
  process.stdout.write(JSON.stringify({ success: true, data: { result: "Example Domain", title: "Example Domain" } }));
} else if (command === "eval") {
  process.stdout.write(JSON.stringify({ success: true, data: { result: { title: "Example Domain", url: "https://example.test/" } } }));
} else if (command === "click") {
  process.stdout.write(JSON.stringify({ success: true, data: { clicked: true, href: "https://example.test/docs", navigationSummary: { title: "Docs", url: "https://example.test/docs" } } }));
} else {
  process.stdout.write(JSON.stringify({ success: true, data: { ok: true } }));
}`,
		);

		try {
			await withPatchedEnv({ PATH: `${tempDir}:${basePath}` }, async () => {
				const harness = createExtensionHarness({ cwd: tempDir });
				await runExtensionEvent(harness.handlers, "session_start", { reason: "new" }, harness.ctx);

				const semanticClick = await executeRegisteredTool(harness.tool, harness.ctx, {
					semanticAction: { action: "click", locator: "text", value: "Close" },
				});
				assert.equal(semanticClick.isError, false);
				const semanticText = readString(readRecord(semanticClick.content[0]).text);
				assert.match(semanticText, /Clicked: text "Close"/);
				assert.doesNotMatch(semanticText, /data-agent-browser-located/);
				assert.match(semanticText, /Current page:/);
				assert.match(semanticText, /Example Domain/);
				assert.match(semanticText, /https:\/\/example.test\//);
				assert.match(
					readString(readRecord(semanticClick.details).summary),
					/click → Example Domain/,
				);
				assert.deepEqual(readRecord(semanticClick.details).navigationSummary, {
					title: "Example Domain",
					url: "https://example.test/",
					urlChanged: false,
				});
				assert.equal(
					readRecord(readRecord(semanticClick.details).pageChangeSummary).command,
					"click",
				);
				assert.equal(
					readRecord(readRecord(semanticClick.details).pageChangeSummary).changeType,
					"mutation",
				);
				assert.equal(
					readRecord(readRecord(semanticClick.details).pageChangeSummary).observed,
					false,
				);
				assert.match(semanticText, /Action dispatched; application change unverified/);
				const nextActionIds = readArray(readRecord(semanticClick.details).nextActions).map(
					(action) => readRecord(action).id,
				);
				assert.ok(nextActionIds.includes("inspect-after-mutation"));

				const directClick = await executeRegisteredTool(harness.tool, harness.ctx, {
					args: ["click", "#direct"],
				});
				assert.equal(directClick.isError, false);
				const directText = readString(readRecord(directClick.content[0]).text);
				assert.match(directText, /Clicked: true/);
				assert.match(directText, /Href: https:\/\/example.test\/docs/);
				assert.match(directText, /Current page:/);

				const invocations = await readInvocationLog(logPath);
				const urlProbeIndex = invocations.findIndex(
					(entry) => entry.args.includes("get") && entry.args.includes("url"),
				);
				const titleProbeIndex = invocations.findIndex(
					(entry) => entry.args.includes("get") && entry.args.includes("title"),
				);
				assert.ok(urlProbeIndex >= 0, "expected URL verification after semantic click");
				assert.ok(
					titleProbeIndex > urlProbeIndex,
					"expected title lookup only after URL verification",
				);
			});
		} finally {
			await rm(tempDir, { force: true, recursive: true });
		}
	},
);
