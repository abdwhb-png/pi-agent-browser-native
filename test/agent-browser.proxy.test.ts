import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import {
	createExtensionHarness,
	executeRegisteredTool,
	readInvocationLog,
	withPatchedEnv,
	writeFakeAgentBrowserBinary,
} from "./helpers/agent-browser-harness.js";

test("native proxy arguments reach upstream without exposing credentials or changing session on follow-up", async () => {
	const root = await mkdtemp(join(tmpdir(), "piab-proxy-"));
	try {
		const log = join(root, "calls.jsonl");
		await writeFakeAgentBrowserBinary(
			root,
			`
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args}) + "\\n");
if (args.includes("--version")) process.stdout.write("agent-browser 0.38.1");
else process.stdout.write(JSON.stringify({success:true, data:{url:"https://example.com", title:"Proxy fixture"}}));
`,
		);
		await withPatchedEnv({ PATH: `${root}${delimiter}${process.env.PATH ?? ""}` }, async () => {
			const harness = createExtensionHarness({ cwd: root, prompt: "Browse through the proxy." });
			const opened = await executeRegisteredTool(harness.tool, harness.ctx, {
				args: [
					"--proxy",
					"http://fixture-user:fixture-password@proxy.invalid:8080",
					"--proxy-bypass",
					"*.internal",
					"open",
					"https://example.com",
				],
				sessionMode: "fresh",
			});
			assert.equal(opened.isError, false, JSON.stringify(opened));
			assert.doesNotMatch(JSON.stringify(opened), /fixture-user|fixture-password/);
			const followup = await executeRegisteredTool(harness.tool, harness.ctx, {
				args: ["get", "title"],
			});
			assert.equal(followup.isError, false, JSON.stringify(followup));
			assert.equal(followup.details?.sessionName, opened.details?.sessionName);
			const calls = await readInvocationLog(log);
			const launch = calls.find((call) => call.args.includes("open"));
			assert.ok(launch);
			assert.equal(
				launch.args[launch.args.indexOf("--proxy") + 1],
				"http://fixture-user:fixture-password@proxy.invalid:8080",
			);
			assert.equal(launch.args[launch.args.indexOf("--proxy-bypass") + 1], "*.internal");
			const getter = calls.find((call) => call.args.includes("title"));
			assert.ok(getter);
			assert.equal(getter.args.includes("--proxy"), false);
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
