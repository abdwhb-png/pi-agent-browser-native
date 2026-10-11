import assert from "node:assert/strict";
import { readArray, readRecord, readString } from "./helpers/assertions.js";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { extractUpstreamCommandTokens } from "../extensions/agent-browser/lib/argv-descriptor.js";
import {
	getExplicitSessionPageVerificationRequirement,
	getPageTargetValidationError,
} from "../extensions/agent-browser/lib/page-target-validation.js";
import { buildExecutionPlan } from "../extensions/agent-browser/lib/runtime.js";
import {
	createExtensionHarness,
	executeRegisteredTool,
	readInvocationLog,
	runExtensionEvent,
	withPatchedEnv,
	writeFakeAgentBrowserBinary,
} from "./helpers/agent-browser-harness.js";

const urlReads = [
	["read", "https://public.test/guide.md"],
	["read", "--raw", "public.test/guide", "--timeout", "50"],
	["read", "--filter", "https://filter.test/not-a-target", "--llms", "full", "public.test"],
	["read", "public.test", "--outline", "--filter", "bearer token"],
];

const invalidReads = [
	["read", "public.test", "--filter"],
	["read", "public.test", "another.test"],
	["read", "public.test", "--unknown"],
	["read", "--unknown"],
	["read", "--timeout", "0"],
	["read", "--llms", "bad"],
	["read", "--llms", "full", "--outline"],
];

test("explicit URL reads follow native operands without requiring a page or implicit session", () => {
	for (const args of [...urlReads, ...invalidReads]) {
		// The nonempty literal valid/invalid read tables all check browser-independent planning.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(
			getPageTargetValidationError({ args, pageUrlUnknown: true }),
			undefined,
			args.join(" "),
		);
		// The nonempty literal valid/invalid read tables all check browser-independent planning.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(
			getExplicitSessionPageVerificationRequirement({ args: ["--session", "shared", ...args] }),
			undefined,
		);
		const plan = buildExecutionPlan(args, {
			freshSessionName: "fresh",
			managedSessionActive: true,
			managedSessionName: "owned",
			sessionMode: "fresh",
		});
		// The nonempty literal valid/invalid read tables all check browser-independent planning.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(plan.managedSessionName, undefined);
		// The nonempty literal valid/invalid read tables all check browser-independent planning.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(plan.usedImplicitSession, false);
	}
	for (const args of [
		["read"],
		["read", "--filter", "https://not-a-target.test"],
		["read", "--llms", "full"],
		["read", "--filter", "--llms", "--outline"],
		["read", "--llms", "index", "--filter", "--outline"],
	]) {
		// Each literal URL-less read variant must retain the unverified-page guard.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.match(getExplicitSessionPageVerificationRequirement({ args }) ?? "", /unverified/);
	}
	assert.equal(
		getPageTargetValidationError({
			args: ["batch"],
			stdin: JSON.stringify(urlReads),
			pageUrlUnknown: true,
		}),
		undefined,
	);
	assert.equal(
		getPageTargetValidationError({
			args: ["batch"],
			stdin: JSON.stringify([["read", "--profile", "public.test"]]),
			pageUrlUnknown: true,
		}),
		undefined,
		"invalid native row flags cannot turn a browserless read into a page probe",
	);
	assert.equal(
		getPageTargetValidationError({
			args: ["batch", "read --raw public.test"],
			stdin: JSON.stringify([["snapshot", "-i"]]),
			pageUrlUnknown: true,
		}),
		undefined,
	);
});

test(
	"shared URL reads and their timeouts dispatch no page helpers; bare reads still verify",
	{ concurrency: false },
	async (t) => {
		const root = await mkdtemp(join(tmpdir(), "piab-url-read-"));
		const logPath = join(root, "calls.jsonl");
		await mkdir(join(root, ".git"));
		await writeFakeAgentBrowserBinary(
			root,
			`const fs = require('node:fs');
const args = process.argv.slice(2), stdin = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args, stdin, autosave: process.env.AGENT_BROWSER_AUTOSAVE_INTERVAL_MS ?? null, idle: process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS ?? null, restoreKey: process.env.AGENT_BROWSER_RESTORE ?? null, namespaceEnv: process.env.AGENT_BROWSER_NAMESPACE ?? null, userAgent: process.env.AGENT_BROWSER_USER_AGENT ?? null, config: process.env.AGENT_BROWSER_CONFIG ?? null, argsEnv: process.env.AGENT_BROWSER_ARGS ?? null }) + '\\n');
const tokens = [];
for (let i = 0; i < args.length; i++) {
  if (['--session', '--namespace', '--profile', '--user-agent', '--args', '--config'].includes(args[i])) i++;
  else if (!['--json', '--headed'].includes(args[i])) tokens.push(args[i]);
}
const rawRows = tokens[0] === 'batch' ? tokens.slice(1).filter(token => token !== '--bail') : [];
const batchRows = tokens[0] === 'batch' ? rawRows.length ? rawRows.map(row => row.split(' ')) : JSON.parse(stdin) : undefined;
const data = batchRows ? batchRows.filter(row => row.length > 0).map(command => ({ command, success: true, result: { source: 'http', content: 'bearer token', url: 'https://public.test' } }))
  : tokens[0] === 'session' ? { session: args[args.indexOf('--session') + 1], active: false, runtime: null }
  : tokens[0] === 'read' && tokens[1] === 'public.test/confirm' ? { confirmation_required: true, confirmation_id: 'read-id', action: 'read', capabilities: { readRequiresConfirmation: true } }
  : tokens[0] === 'confirm' ? { confirmed: true, action: 'read', result: { success: true, data: { source: 'http', content: 'Confirmed read' } } }
  : tokens[0] === 'read' ? { source: 'http', content: 'bearer token', url: 'https://public.test' }
  : { url: 'https://shared.test/current', title: 'Shared page' };
if ((batchRows ?? [tokens]).some(row => row.includes('timeout.test'))) setInterval(() => {}, 1000);
else if (${JSON.stringify(invalidReads)}.some(row => JSON.stringify(row) === JSON.stringify(tokens))) { process.stdout.write(JSON.stringify({ success: false, error: 'Native read argument error' })); process.exitCode = 1; }
else process.stdout.write(JSON.stringify({ success: true, data }));`,
		);
		try {
			await withPatchedEnv(
				{
					PATH: `${root}${delimiter}${process.env.PATH ?? ""}`,
					HOME: root,
					USERPROFILE: root,
					AGENT_BROWSER_SESSION: "shared",
					AGENT_BROWSER_NAMESPACE: "reader-scope",
					PI_AGENT_BROWSER_TEST_CUSTOM_SESSION_INFO: "1",
				},
				async () => {
					const harness = createExtensionHarness({ cwd: root });
					await runExtensionEvent(
						harness.handlers,
						"session_start",
						{ reason: "new" },
						harness.ctx,
					);
					for (const params of [
						...urlReads.map((args) => ({ args })),
						{ args: ["batch"], stdin: JSON.stringify(urlReads) },
						{ args: ["batch"], stdin: JSON.stringify([[], ...urlReads, []]) },
						{
							args: ["--profile", "/exact/untouched-profile", "read", "public.test"],
							sessionMode: "fresh",
						},
					]) {
						// Fixture transitions and their assertions run in order against this test's shared state.
						// oxlint-disable-next-line no-await-in-loop
						await writeFile(logPath, "");
						// Fixture transitions and their assertions run in order against this test's shared state.
						// oxlint-disable-next-line no-await-in-loop
						const result = await executeRegisteredTool(harness.tool, harness.ctx, params);
						// All fixed direct/batch/profile read variants check exact dispatch and no implicit session.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.ok(result.details);
						// All fixed direct/batch/profile read variants check exact dispatch and no implicit session.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(result.isError, false, result.content[0]?.text);
						// All fixed direct/batch/profile read variants check exact dispatch and no implicit session.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.deepEqual(
							// Fixture transitions and their assertions run in order against this test's shared state.
							// oxlint-disable-next-line no-await-in-loop
							(await readInvocationLog(logPath)).map(
								(row) => extractUpstreamCommandTokens(row.args)[0],
							),
							[params.args.includes("batch") ? "batch" : "read"],
						);
						// All fixed direct/batch/profile read variants check exact dispatch and no implicit session.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(result.details.usedImplicitSession, false);
					}
					for (const args of invalidReads) {
						// Fixture transitions and their assertions run in order against this test's shared state.
						// oxlint-disable-next-line no-await-in-loop
						await writeFile(logPath, "");
						// Fixture transitions and their assertions run in order against this test's shared state.
						// oxlint-disable-next-line no-await-in-loop
						const result = await executeRegisteredTool(harness.tool, harness.ctx, { args });
						// Every literal invalid read checks its error and unchanged native argument dispatch.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.ok(result.details);
						// Every literal invalid read checks its error and unchanged native argument dispatch.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(result.isError, true);
						// Every literal invalid read checks its error and unchanged native argument dispatch.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.match(result.content[0]?.text ?? "", /Native read argument error/);
						// Every literal invalid read checks its error and unchanged native argument dispatch.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.deepEqual(
							// Fixture transitions and their assertions run in order against this test's shared state.
							// oxlint-disable-next-line no-await-in-loop
							(await readInvocationLog(logPath)).map((row) =>
								extractUpstreamCommandTokens(row.args),
							),
							[args],
						);
					}
					const nativeSpawn = childProcess.spawn;
					const spawned: string[][] = [];
					t.mock.method(
						childProcess,
						"spawn",
						(...args: Readonly<Parameters<typeof childProcess.spawn>>) => {
							if (Array.isArray(args[1]) && args[1].includes("--json")) {
								spawned.push(readArray(args[1]).map(readString));
							}
							return nativeSpawn(...args);
						},
					);
					syncBuiltinESMExports();
					try {
						for (const params of [
							{ args: ["read", "timeout.test"] },
							{
								args: ["batch"],
								stdin: JSON.stringify([
									["read", "public.test"],
									["read", "timeout.test"],
								]),
							},
							{ args: ["batch", "read timeout.test"], stdin: JSON.stringify([["snapshot", "-i"]]) },
						]) {
							// Fixture transitions and their assertions run in order against this test's shared state.
							// oxlint-disable-next-line no-await-in-loop
							await writeFile(logPath, "");
							spawned.length = 0;
							// Fixture transitions and their assertions run in order against this test's shared state.
							// oxlint-disable-next-line no-await-in-loop
							const timeout = await executeRegisteredTool(harness.tool, harness.ctx, {
								...params,
								timeoutMs: 150,
							});
							// All three literal timeout variants check timeout evidence and exact spawned command.
							// oxlint-disable-next-line node-test/no-conditional-assertion
							assert.ok(timeout.details);
							// All three literal timeout variants check timeout evidence and exact spawned command.
							// oxlint-disable-next-line node-test/no-conditional-assertion
							assert.equal(timeout.details.failureCategory, "timeout");
							// All three literal timeout variants check timeout evidence and exact spawned command.
							// oxlint-disable-next-line node-test/no-conditional-assertion
							assert.equal(timeout.details.agentBrowserStarted, true);
							// Observe real spawns: a short watchdog can expire before a slow fixture Node reaches its log write.
							// All three literal timeout variants check timeout evidence and exact spawned command.
							// oxlint-disable-next-line node-test/no-conditional-assertion
							assert.deepEqual(
								spawned.map((args) => extractUpstreamCommandTokens(args)[0]),
								[params.args[0]],
							);
						}
					} finally {
						t.mock.restoreAll();
						syncBuiltinESMExports();
					}
					await writeFile(logPath, "");
					const bare = await executeRegisteredTool(harness.tool, harness.ctx, { args: ["read"] });
					assert.equal(bare.isError, false, bare.content[0]?.text);
					assert.deepEqual(
						(await readInvocationLog(logPath)).map((row) => extractUpstreamCommandTokens(row.args)),
						[["session", "info"], ["get", "url"], ["read"]],
					);
					await writeFile(logPath, "");
					const sharedInfo = await executeRegisteredTool(harness.tool, harness.ctx, {
						args: ["session", "info"],
					});
					assert.ok(sharedInfo.details);
					assert.equal(readRecord(sharedInfo.details.data).piCleanupOwnership, "caller-owned");
					assert.deepEqual(
						(await readInvocationLog(logPath)).map((row) => extractUpstreamCommandTokens(row.args)),
						[["session", "info"]],
					);
					await withPatchedEnv(
						{
							AGENT_BROWSER_SESSION: undefined,
							AGENT_BROWSER_NAMESPACE: undefined,
							AGENT_BROWSER_USER_AGENT: undefined,
							AGENT_BROWSER_HEADED: undefined,
							AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: undefined,
							AGENT_BROWSER_IDLE_TIMEOUT_MS: undefined,
							AGENT_BROWSER_ENCRYPTION_KEY: "a".repeat(64),
							PI_AGENT_BROWSER_MANAGED_SESSION_RESTORE: undefined,
						},
						async () => {
							for (const headed of [false, true]) {
								const url = headed ? "https://owned.test/" : "https://chatgpt.com/";
								// Fixture transitions and their assertions run in order against this test's shared state.
								// oxlint-disable-next-line no-await-in-loop
								await writeFile(logPath, "");
								// Fixture transitions and their assertions run in order against this test's shared state.
								// oxlint-disable-next-line no-await-in-loop
								const opened = await executeRegisteredTool(harness.tool, harness.ctx, {
									args: [...(headed ? ["--headed"] : []), "open", url],
									sessionMode: "fresh",
								});
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.ok(opened.details);
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.equal(opened.isError, false, readString(readRecord(opened.content[0]).text));
								// Fixture transitions and their assertions run in order against this test's shared state.
								// oxlint-disable-next-line no-await-in-loop
								const launch = (await readInvocationLog(logPath)).find(
									(row) => extractUpstreamCommandTokens(row.args)[0] === "open",
								);
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.ok(launch);
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.equal(
									readRecord(opened.details.compatibilityWorkaround ?? {}).id,
									headed ? undefined : "chatgpt-headless-user-agent",
								);
								// Fixture transitions and their assertions run in order against this test's shared state.
								// oxlint-disable-next-line no-await-in-loop
								await writeFile(logPath, "");
								// Fixture transitions and their assertions run in order against this test's shared state.
								// oxlint-disable-next-line no-await-in-loop
								const read = await executeRegisteredTool(harness.tool, harness.ctx, {
									args: ["--profile", "/unused/profile", "read", "public.test"],
									sessionMode: "fresh",
								});
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.ok(read.details);
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.equal(read.isError, false, readString(readRecord(read.content[0]).text));
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.equal(read.details.managedSessionOutcome, undefined);
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.deepEqual(
									// Fixture transitions and their assertions run in order against this test's shared state.
									// oxlint-disable-next-line no-await-in-loop
									(await readInvocationLog(logPath)).map((row) =>
										extractUpstreamCommandTokens(row.args),
									),
									[["read", "public.test"]],
								);
								const prefix = [
									"--namespace",
									"",
									"--session",
									readString(opened.details.sessionName),
								];
								for (const args of [
									["read", "public.test"],
									["batch", "read public.test"],
									["session", "info"],
									["confirm", "read-id"],
									["--profile", "/caller/profile", "read", "public.test"],
									["--args", "--disable-gpu", "read", "public.test"],
								]) {
									if (args[0] === "confirm") {
										// Fixture transitions and their assertions run in order against this test's shared state.
										// oxlint-disable-next-line no-await-in-loop
										await executeRegisteredTool(harness.tool, harness.ctx, {
											args: [...prefix, "read", "public.test/confirm"],
										});
									}
									// Fixture transitions and their assertions run in order against this test's shared state.
									// oxlint-disable-next-line no-await-in-loop
									await writeFile(logPath, "");
									// Fixture transitions and their assertions run in order against this test's shared state.
									// oxlint-disable-next-line no-await-in-loop
									const inspection = await executeRegisteredTool(harness.tool, harness.ctx, {
										args: [...prefix, ...args],
									});
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.ok(inspection.details);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.equal(
										inspection.isError,
										false,
										readString(readRecord(inspection.content[0]).text),
									);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.equal(inspection.details.managedSessionOutcome, undefined);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.equal(inspection.details.compatibilityWorkaround, undefined);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.equal(inspection.details.managedSessionHeadedAutosaveInterval, undefined);
									if (args[0] === "session") {
										// The literal session-info row exercises this ownership check in both headed modes.
										// oxlint-disable-next-line node-test/no-conditional-assertion
										assert.equal(
											readRecord(inspection.details.data).piCleanupOwnership,
											"wrapper-managed",
										);
									}
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.notEqual(inspection.details.managedSessionRestoreDisabled, true);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.deepEqual(
										// Fixture transitions and their assertions run in order against this test's shared state.
										// oxlint-disable-next-line no-await-in-loop
										(await readInvocationLog(logPath)).map((row) => row.args),
										[["--json", ...prefix, ...args]],
									);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.deepEqual(
										// Fixture transitions and their assertions run in order against this test's shared state.
										// oxlint-disable-next-line no-await-in-loop
										{ ...(await readInvocationLog(logPath))[0], args: undefined, stdin: undefined },
										{ ...launch, args: undefined, stdin: undefined, userAgent: null },
									);
									// Fixture transitions and their assertions run in order against this test's shared state.
									// oxlint-disable-next-line no-await-in-loop
									const followup = await executeRegisteredTool(harness.tool, harness.ctx, {
										args: ["open", url],
									});
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.ok(followup.details);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.equal(
										followup.isError,
										false,
										readString(readRecord(followup.content[0]).text),
									);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.equal(followup.details.sessionName, opened.details.sessionName);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.deepEqual(
										followup.details.compatibilityWorkaround,
										opened.details.compatibilityWorkaround,
									);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.equal(
										followup.details.managedSessionHeadedAutosaveDisabled,
										headed ? true : undefined,
									);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.equal(
										followup.details.managedSessionHeadedAutosaveInterval,
										headed ? "0" : undefined,
									);
									// All six literal inspection commands run in both headed modes and retain launch ownership.
									// oxlint-disable-next-line node-test/no-conditional-assertion
									assert.equal(
										// Fixture transitions and their assertions run in order against this test's shared state.
										// oxlint-disable-next-line no-await-in-loop
										(await readInvocationLog(logPath)).at(-1)?.autosave,
										headed ? "0" : null,
									);
								}
								const config = join(root, "caller-config.json");
								// Fixture transitions and their assertions run in order against this test's shared state.
								// oxlint-disable-next-line no-await-in-loop
								await writeFile(
									config,
									JSON.stringify({ restore: "caller-config-key", args: "--disable-gpu" }),
								);
								for (const [env, expected] of [
									[
										{ AGENT_BROWSER_CONFIG: config },
										{ config, restoreKey: null, autosave: null, userAgent: null, argsEnv: null },
									],
									[
										{
											AGENT_BROWSER_RESTORE: "caller-key",
											AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: "1700",
											AGENT_BROWSER_USER_AGENT: "caller-agent",
											AGENT_BROWSER_ARGS: "--disable-gpu",
										},
										{
											config: null,
											restoreKey: "caller-key",
											autosave: "1700",
											userAgent: "caller-agent",
											argsEnv: "--disable-gpu",
										},
									],
								] as const) {
									// Fixture transitions and their assertions run in order against this test's shared state.
									// oxlint-disable-next-line no-await-in-loop
									await withPatchedEnv(env, async () => {
										await writeFile(logPath, "");
										const result = await executeRegisteredTool(harness.tool, harness.ctx, {
											args: [...prefix, "read", "public.test"],
										});
										// Both literal caller-env variants check exact dispatch and unchanged native environment.
										// oxlint-disable-next-line node-test/no-conditional-assertion
										assert.ok(result.details);
										// Both literal caller-env variants check exact dispatch and unchanged native environment.
										// oxlint-disable-next-line node-test/no-conditional-assertion
										assert.equal(
											result.isError,
											false,
											readString(readRecord(result.content[0]).text),
										);
										// Both literal caller-env variants check exact dispatch and unchanged native environment.
										// oxlint-disable-next-line node-test/no-conditional-assertion
										assert.notEqual(result.details.managedSessionRestoreDisabled, true);
										const calls = await readInvocationLog(logPath);
										// Both literal caller-env variants check exact dispatch and unchanged native environment.
										// oxlint-disable-next-line node-test/no-conditional-assertion
										assert.deepEqual(
											calls.map((row) => row.args),
											[["--json", ...prefix, "read", "public.test"]],
										);
										// Both literal caller-env variants check exact dispatch and unchanged native environment.
										// oxlint-disable-next-line node-test/no-conditional-assertion
										assert.deepEqual(
											{ ...calls[0], args: undefined, stdin: undefined },
											{ ...launch, ...expected, args: undefined, stdin: undefined },
										);
									});
								}
								// Fixture transitions and their assertions run in order against this test's shared state.
								// oxlint-disable-next-line no-await-in-loop
								const retained = await executeRegisteredTool(harness.tool, harness.ctx, {
									args: ["open", url],
								});
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.ok(retained.details);
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.equal(
									retained.isError,
									false,
									readString(readRecord(retained.content[0]).text),
								);
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.equal(retained.details.sessionName, opened.details.sessionName);
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.notEqual(retained.details.managedSessionRestoreDisabled, true);
								// Both literal headed modes run the complete launch, follow-up, and retained-session checks.
								// oxlint-disable-next-line node-test/no-conditional-assertion
								assert.deepEqual(
									retained.details.compatibilityWorkaround,
									opened.details.compatibilityWorkaround,
								);
							}
						},
					);
					await runExtensionEvent(
						harness.handlers,
						"session_shutdown",
						{ reason: "quit" },
						harness.ctx,
					);
				},
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
