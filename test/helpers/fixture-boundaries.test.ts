import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import {
	createExtensionHarness,
	executeRegisteredTool,
	readInvocationLog,
	runExtensionEvent,
	withPatchedEnv,
	writeFakeAgentBrowserBinary,
} from "./agent-browser-harness.js";
import {
	readArray,
	readBoolean,
	readFunction,
	readNumber,
	readRecord,
	readString,
} from "./assertions.js";
import { readOptionalFakeElectronLaunchLog } from "./extension-validation-fixtures.js";

await test("fixture readers reject malformed shapes instead of asserting unchecked JSON types", async () => {
	assert.deepEqual(readRecord({ key: 1 }), { key: 1 });
	assert.deepEqual(readArray([1]), [1]);
	assert.equal(readString("fixture"), "fixture");
	assert.equal(readNumber(3), 3);
	assert.equal(readBoolean(false), false);
	assert.equal(readFunction((value: unknown) => value)("fixture"), "fixture");
	assert.throws(() => readRecord(null), assert.AssertionError);
	assert.throws(() => readRecord([]), assert.AssertionError);
	assert.throws(() => readRecord("record"), assert.AssertionError);
	assert.throws(() => readArray({}), assert.AssertionError);
	assert.throws(() => readString(1), assert.AssertionError);
	assert.throws(() => readNumber(Number.NaN), assert.AssertionError);
	assert.throws(() => readBoolean("false"), assert.AssertionError);
	assert.throws(() => readFunction({}), assert.AssertionError);

	const root = await mkdtemp(join(tmpdir(), "piab-fixture-boundary-"));
	try {
		const invocations = join(root, "invocations.jsonl");
		const launches = join(root, "launches.jsonl");
		assert.deepEqual(await readInvocationLog(invocations), []);
		assert.deepEqual(await readOptionalFakeElectronLaunchLog(launches), []);
		const invocation = {
			args: ["get", "url"],
			idleTimeout: null,
			socketDir: "/tmp/fixture",
			confirmActions: "navigate",
			extraReceipt: { generation: 2 },
		};
		const launch = {
			args: ["script.cjs"],
			mode: "normal",
			pid: 123,
			userDataDir: "/tmp/profile",
			extraReceipt: { generation: 2 },
		};
		await writeFile(invocations, `${JSON.stringify(invocation)}\n`);
		await writeFile(launches, `${JSON.stringify(launch)}\n`);
		assert.deepEqual(await readInvocationLog(invocations), [invocation]);
		assert.deepEqual(await readOptionalFakeElectronLaunchLog(launches), [launch]);
		await writeFile(invocations, `${JSON.stringify({ ...invocation, confirmActions: 3 })}\n`);
		await assert.rejects(readInvocationLog(invocations), assert.AssertionError);
		await writeFile(invocations, '{"args":[1]}\n');
		await writeFile(launches, `${JSON.stringify({ ...launch, mode: "unknown" })}\n`);
		await assert.rejects(readInvocationLog(invocations), assert.AssertionError);
		await assert.rejects(readOptionalFakeElectronLaunchLog(launches), assert.AssertionError);
		await writeFile(invocations, "not JSON\n");
		await writeFile(launches, "not JSON\n");
		await assert.rejects(readInvocationLog(invocations), SyntaxError);
		await assert.rejects(readOptionalFakeElectronLaunchLog(launches), SyntaxError);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

await test("browser fixtures isolate inherited native configuration and restore the environment", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "piab-fixture-env-"));
	const inherited = new Map(
		["HOME", "USERPROFILE", "AGENT_BROWSER_CONFIG"].map((name) => [name, process.env[name]]),
	);
	t.after(async () => {
		for (const [name, value] of inherited) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
		await rm(root, { recursive: true, force: true });
	});
	const config = join(root, ".agent-browser", "config.json");
	const cwd = join(root, "project");
	await mkdir(join(root, ".agent-browser"));
	await mkdir(cwd);
	await writeFile(config, '{"caCert":"fixture-cert.pem"}\n');
	await writeFakeAgentBrowserBinary(
		root,
		'process.stdout.write(JSON.stringify({ success: true, data: { url: "https://fixture.test/", title: "Isolated fixture page" } }));',
	);
	process.env.HOME = root;
	process.env.USERPROFILE = root;
	process.env.AGENT_BROWSER_CONFIG = config;
	let isolatedHome = "";
	await withPatchedEnv({ PATH: `${root}${delimiter}${process.env.PATH ?? ""}` }, async () => {
		isolatedHome = homedir();
		const harness = createExtensionHarness({ cwd });
		try {
			const result = await executeRegisteredTool(harness.tool, harness.ctx, {
				args: ["open", "https://fixture.test/"],
			});
			assert.equal(result.isError, false, result.content[0]?.text);
			assert.match(JSON.stringify(result.content), /Isolated fixture page/);
			assert.notEqual(isolatedHome, root);
			assert.equal(process.env.AGENT_BROWSER_CONFIG, undefined);
		} finally {
			await runExtensionEvent(
				harness.handlers,
				"session_shutdown",
				{ reason: "quit" },
				harness.ctx,
			);
		}
	});
	assert.equal(homedir(), root);
	assert.equal(process.env.AGENT_BROWSER_CONFIG, config);
	assert.equal(await readFile(config, "utf8"), '{"caCert":"fixture-cert.pem"}\n');
	await assert.rejects(stat(isolatedHome), { code: "ENOENT" });
});

await test("nested fixture environments preserve explicit configuration and restore after rejection", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "piab-fixture-env-"));
	t.after(async () => await rm(root, { recursive: true, force: true }));
	const previousHome = homedir();
	const previousConfig = process.env.AGENT_BROWSER_CONFIG;
	const config = join(root, "explicit.json");
	const failure = new Error("fixture failure");
	await assert.rejects(
		withPatchedEnv({ HOME: root, USERPROFILE: root, AGENT_BROWSER_CONFIG: config }, async () => {
			await withPatchedEnv({ PI_AGENT_BROWSER_TEST_PAGE_URL: "https://fixture.test" }, async () => {
				assert.equal(homedir(), root);
				assert.equal(process.env.AGENT_BROWSER_CONFIG, config);
				throw failure;
			});
		}),
		(error: unknown) => error === failure,
	);
	assert.equal(homedir(), previousHome);
	assert.equal(process.env.AGENT_BROWSER_CONFIG, previousConfig);
});
