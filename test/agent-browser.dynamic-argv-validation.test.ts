/**
 * Purpose: Verify model-facing argv validation against the installed agent-browser help contract.
 * Responsibilities: Cover rejected unsupported flags, help caching, and fail-open help inspection.
 * Scope: Extension-level input validation with a deterministic fake upstream binary.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	createExtensionHarness,
	executeRegisteredTool,
	readInvocationLog,
	withPatchedEnv,
	writeFakeAgentBrowserBinary,
	runExtensionEvent,
} from "./helpers/agent-browser-harness.js";

const ROOT_HELP = `agent-browser

Usage: agent-browser <command> [args] [options]

Global Options:
  --json  Output as JSON
  --session <name>  Use specific session
  --namespace <name>  Use namespace
`;

const CONSOLE_HELP = `agent-browser console - View console logs

Usage: agent-browser console [--clear]

Options:
  --clear  Clear console log buffer

Global Options:
  --json  Output as JSON
  --session <name>  Use specific session
`;

function helpAwareFakeBody(logPath: string): string {
	return `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args }) + "\\n");
if (args.includes("--help")) {
  const command = args.find(arg => !arg.startsWith("-"));
  const help = command === "console" ? ${JSON.stringify(CONSOLE_HELP)}
    : command === "fill" ? "agent-browser fill\\n\\nUsage: agent-browser fill <selector> <text>\\n\\nGlobal Options:\\n  --json  Output as JSON\\n  --session <name>  Use specific session\\n"
	: command === "type" ? "agent-browser type\\n\\nUsage: agent-browser type <selector> <text>\\n\\nGlobal Options:\\n  --json  Output as JSON\\n  --session <name>  Use specific session\\n"
    : command === "wait" ? "agent-browser wait\\n\\nUsage: agent-browser wait <selector|ms> [--text <text>]\\n\\nOptions:\\n  --text <text>  Wait for text\\n"
    : command === "batch" ? "agent-browser batch\\n\\nUsage: agent-browser batch [--bail] [commands...]\\n\\nOptions:\\n  --bail  Stop on failure\\n"
    : ${JSON.stringify(ROOT_HELP)};
  process.stdout.write(help);
  process.exit(0);
}
process.stdout.write(JSON.stringify({ success: true, data: { messages: [] } }));
`;
}

test("agentBrowserExtension rejects console --level from installed help before dispatch", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-dynamic-argv-"));
	const logPath = join(tempDir, "invocations.jsonl");
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(tempDir, `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args }) + "\\n");
if (args.includes("--help")) {
  const consoleHelp = args.includes("console");
  process.stdout.write(consoleHelp
    ? "agent-browser console - View console logs\\n\\nUsage: agent-browser console [--clear]\\n\\nOptions:\\n  --clear  Clear console log buffer\\n\\nGlobal Options:\\n  --json  Output as JSON\\n  --session <name>  Use specific session\\n"
    : "agent-browser\\n\\nUsage: agent-browser <command> [args] [options]\\n\\nGlobal Options:\\n  --json  Output as JSON\\n  --session <name>  Use specific session\\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify({ success: true, data: { messages: [{ type: "error", text: "boom" }] } }));
`);

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}`, PI_AGENT_BROWSER_TEST_CUSTOM_HELP: "1" }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir, prompt: "Inspect console errors." });
			const result = await executeRegisteredTool(harness.tool, harness.ctx, { args: ["console", "--level", "error"] });

			assert.equal(result.isError, true);
			assert.equal(result.details?.failureCategory, "validation-error");
			assert.match(result.content[0]?.text ?? "", /does not support.*--level/i);
			assert.match(result.content[0]?.text ?? "", /retry-console-without-level/);
			const nextAction = (result.details?.nextActions as Array<{ id?: string; params?: { args?: string[] } }> | undefined)?.[0];
			assert.equal(nextAction?.id, "retry-console-without-level");
			assert.deepEqual(nextAction?.params?.args, ["console"]);

			const invocations = await readInvocationLog(logPath);
			assert.equal(invocations.some(({ args }) => args.includes("console") && !args.includes("--help")), false);
			assert.equal(invocations.filter(({ args }) => args.includes("console") && args.includes("--help")).length, 1);
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("dynamic argv help cache changes with the observed version", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-dynamic-cache-"));
	const logPath = join(tempDir, "invocations.jsonl");
	const versionPath = join(tempDir, "version.txt");
	const basePath = process.env.PATH ?? "";
	await writeFile(versionPath, "agent-browser 0.37.0\n", "utf8");
	await writeFakeAgentBrowserBinary(tempDir, `
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write(fs.readFileSync(${JSON.stringify(versionPath)}, "utf8"));
  process.exit(0);
}
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args }) + "\\n");
if (args.includes("--help")) {
  process.stdout.write(args.includes("console") ? ${JSON.stringify(CONSOLE_HELP)} : ${JSON.stringify(ROOT_HELP)});
  process.exit(0);
}
process.stdout.write(JSON.stringify({ success: true, data: { messages: [] } }));
`);

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}`, PI_AGENT_BROWSER_TEST_CUSTOM_HELP: "1", PI_AGENT_BROWSER_TEST_CUSTOM_VERSION: "1" }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			for (let index = 0; index < 2; index += 1) {
				const result = await executeRegisteredTool(harness.tool, harness.ctx, { args: ["console", "--level", "error"] });
				assert.equal(result.isError, true);
			}
			await writeFile(versionPath, "agent-browser 0.37.1\n", "utf8");
			const changedVersion = await executeRegisteredTool(harness.tool, harness.ctx, { args: ["console", "--level", "error"] });
			assert.equal(changedVersion.isError, true);

			const helpCalls = (await readInvocationLog(logPath)).filter(({ args }) => args.includes("--help"));
			assert.equal(helpCalls.filter(({ args }) => args.includes("console")).length, 2, JSON.stringify(helpCalls));
			assert.equal(helpCalls.filter(({ args }) => !args.includes("console")).length, 2, JSON.stringify(helpCalls));
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("invalid help fails open with a visible unverified flag warning", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-dynamic-fail-open-"));
	const logPath = join(tempDir, "invocations.jsonl");
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(tempDir, `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args }) + "\\n");
if (args.includes("--help")) { process.stdout.write("not parseable"); process.exit(0); }
process.stdout.write(JSON.stringify({ success: true, data: { messages: [] } }));
`);

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}`, PI_AGENT_BROWSER_TEST_CUSTOM_HELP: "1" }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			const result = await executeRegisteredTool(harness.tool, harness.ctx, { args: ["console", "--level", "error"] });
			assert.equal(result.isError, false, result.content[0]?.text);
			assert.match(result.content[0]?.text ?? "", /could not be inspected.*not verified/i);
			assert.equal((result.details?.argvValidation as { status?: string } | undefined)?.status, "unavailable");
			assert.ok((await readInvocationLog(logPath)).some(({ args }) => args.includes("console") && !args.includes("--help")));
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("family help without an options contract does not reject working undocumented flags", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-dynamic-incomplete-help-"));
	const logPath = join(tempDir, "invocations.jsonl");
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(tempDir, helpAwareFakeBody(logPath));

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}`, PI_AGENT_BROWSER_TEST_CUSTOM_HELP: "1" }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			const result = await executeRegisteredTool(harness.tool, harness.ctx, { args: ["type", "#name", "Curie", "--clear", "--delay", "1"] });
			assert.equal(result.isError, false, result.content[0]?.text);
			assert.match(result.content[0]?.text ?? "", /could not be inspected.*not verified/i);
			assert.ok((await readInvocationLog(logPath)).some(({ args }) => args.includes("type") && !args.includes("--help")));
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("dynamic argv validation preserves dash-prefixed positional and flag values", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-dynamic-values-"));
	const logPath = join(tempDir, "invocations.jsonl");
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(tempDir, helpAwareFakeBody(logPath));

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}`, PI_AGENT_BROWSER_TEST_CUSTOM_HELP: "1" }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			const fill = await executeRegisteredTool(harness.tool, harness.ctx, { args: ["fill", "@e1", "--password"] });
			assert.equal(fill.isError, false, fill.content[0]?.text);
			const wait = await executeRegisteredTool(harness.tool, harness.ctx, { args: ["wait", "--text", "--password"] });
			assert.equal(wait.isError, false, wait.content[0]?.text);
			const dispatched = (await readInvocationLog(logPath)).filter(({ args }) => !args.includes("--help"));
			assert.ok(dispatched.some(({ args }) => args.includes("fill") && args.includes("--password")));
			assert.ok(dispatched.some(({ args }) => args.includes("wait") && args.includes("--password")));
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("dynamic argv validation inspects batch rows before dispatch", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-dynamic-batch-"));
	const logPath = join(tempDir, "invocations.jsonl");
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(tempDir, helpAwareFakeBody(logPath));

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}`, PI_AGENT_BROWSER_TEST_CUSTOM_HELP: "1" }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			const result = await executeRegisteredTool(harness.tool, harness.ctx, {
				args: ["batch", "--bail"],
				stdin: JSON.stringify([["console", "--level", "error"]]),
			});
			assert.equal(result.isError, true);
			assert.equal(result.details?.failureCategory, "validation-error");
			assert.match(result.content[0]?.text ?? "", /--level/);
			assert.equal((await readInvocationLog(logPath)).some(({ args }) => args[0] === "batch" && !args.includes("--help")), false);
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("dynamic argv validation applies to browser calls inside script mode", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-dynamic-script-"));
	const logPath = join(tempDir, "invocations.jsonl");
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(tempDir, helpAwareFakeBody(logPath));

	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}`, PI_AGENT_BROWSER_TEST_CUSTOM_HELP: "1" }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir, sessionFile: join(tempDir, "session.jsonl") });
			await runExtensionEvent(harness.handlers, "session_start", { reason: "new" }, harness.ctx);
			const result = await executeRegisteredTool(harness.tool, harness.ctx, {
				script: `emit(await browser({ args: ["console", "--level", "error"] }));`,
			});
			assert.equal(result.isError, false, result.content[0]?.text);
			assert.match(result.content[0]?.text ?? "", /does not support --level/i);
			assert.equal((await readInvocationLog(logPath)).some(({ args }) => args.includes("console") && !args.includes("--help")), false);
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});

test("unsupported argv diagnostics redact sensitive values", { concurrency: false }, async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-agent-browser-dynamic-redaction-"));
	const logPath = join(tempDir, "invocations.jsonl");
	const basePath = process.env.PATH ?? "";
	await writeFakeAgentBrowserBinary(tempDir, helpAwareFakeBody(logPath));
	try {
		await withPatchedEnv({ PATH: `${tempDir}:${basePath}`, PI_AGENT_BROWSER_TEST_CUSTOM_HELP: "1" }, async () => {
			const harness = createExtensionHarness({ cwd: tempDir });
			const secret = "raw-secret-value";
			const result = await executeRegisteredTool(harness.tool, harness.ctx, { args: ["console", `--password=${secret}`] });
			assert.equal(result.isError, true);
			assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
		});
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}
});
