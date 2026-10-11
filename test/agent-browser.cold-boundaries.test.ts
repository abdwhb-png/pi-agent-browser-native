import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { readRecord, readArray, readString, readBoolean } from "./helpers/assertions.js";

import { extractUpstreamCommandTokens } from "../extensions/agent-browser/lib/argv-descriptor.js";
import {
	createExtensionHarness,
	createShortPrivateSocketDir,
	createToolBranchEntry,
	executeRegisteredTool,
	readInvocationLog,
	runExtensionEvent,
	type AgentBrowserToolParams,
	withPatchedEnv,
	writeFakeAgentBrowserBinary,
} from "./helpers/agent-browser-harness.js";

const rememberedUrl = "http://127.0.0.1:43210/remembered/page";
const chosenUrl = "http://127.0.0.1:43210/chosen";
const hashRouteUrl = "http://127.0.0.1:43210/app#/reports/weekly?range=7d";

type Page = {
	readonly call: (params: AgentBrowserToolParams) => ReturnType<typeof executeRegisteredTool>;
	readonly calls: () => ReturnType<typeof readInvocationLog>;
	readonly patch: (patch: Readonly<Record<string, unknown>>) => Promise<void>;
	readonly reload: () => Promise<void>;
	readonly state: () => Promise<{
		readonly active: boolean;
		readonly browser: boolean;
		readonly url: string;
	}>;
	readonly tree: () => Promise<void>;
	readonly url: string;
};

async function withPage(
	run: (page: Page) => Promise<void>,
	options: {
		readonly live?: boolean;
		readonly url?: string;
		readonly explicit?: boolean;
		readonly attached?: boolean;
		readonly restoreDisabled?: boolean;
	} = {},
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "cb-"));
	const socketDir = createShortPrivateSocketDir(root);
	const cwd = join(root, "g");
	const home = join(root, "h");
	const logPath = join(root, "calls.jsonl");
	const statePath = join(root, "browser.json");
	const url = options.url ?? rememberedUrl;
	await Promise.all([cwd, home].map((path) => mkdir(path, { mode: 0o700 })));
	execFileSync("git", ["init", "-q", cwd]);
	// Native HTTP reads and session info leave cold browsers untouched; tab list launches the browser.
	await writeFakeAgentBrowserBinary(
		root,
		`const fs = require('node:fs');
const args = process.argv.slice(2), stdin = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args, stdin }) + '\\n');
let state = { active: false, browser: false, url: 'about:blank', restoreKey: null };
try { state = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8')); } catch {}
const tokens = [];
for (let i = 0; i < args.length; i++) {
  if (['--session', '--namespace', '--headers', '--user-agent'].includes(args[i])) i++;
  else if (!['--json', '--no-pin-tab'].includes(args[i])) tokens.push(args[i]);
}
function urlOperand(row) {
  for (let i = 1; i < row.length; i++) {
    if (['--filter', '--timeout', '--llms', '--tags', '--selector', '-s'].includes(row[i])) i++;
    else if (!row[i].startsWith('--')) return row[i];
  }
}
function execute(row) {
  const [command, subcommand] = row;
  if (command === 'session') return { active: state.active, runtime: state.active ? { restoreKey: state.restoreKey } : null };
  if (['close', 'quit', 'exit'].includes(command)) { state = { ...state, active: false, browser: false, url: 'about:blank', restoreKey: null }; return { closed: true }; }
  const explicitRead = command === 'read' && urlOperand(row) !== undefined;
  if (explicitRead) return { content: 'HTTP-only read', source: 'http', url: urlOperand(row) };
  if (!state.active) { state.active = true; state.restoreKey = process.env.AGENT_BROWSER_RESTORE ?? null; }
  if (!state.browser) { state.browser = true; state.url = ${JSON.stringify(new URL(url).origin + "/")}; }
  if (state.failNext === command) { delete state.failNext; throw new Error('Fixture command failed'); }
  if (command === 'not-a-command') throw new Error('Unknown command: not-a-command');
  if (['open', 'goto', 'navigate', 'a11y', 'vitals', 'web-vitals'].includes(command)) state.url = urlOperand(row) ?? (command === 'open' ? 'about:blank' : state.url);
  if (command === 'connect' || (command === 'state' && subcommand === 'load')) { state.url = ${JSON.stringify(chosenUrl)}; return { connected: true }; }
  if (command === 'webmcp') return { invocationId: 'pending-job', status: 'pending' };
  if (command === 'pushstate') state.url = new URL(row[1], state.url).href;
  if (command === 'diff' && subcommand === 'url') { state.url = row[3]; return { url1: row[2], url2: row[3], diff: 'Different pages' }; }
  if (command === 'window' && subcommand === 'new') { state.url = 'about:blank'; return { tabId: 't2', total: 2 }; }
  if (command === 'tab') {
    if (subcommand === undefined || subcommand === 'list') return { tabs: [{ tabId: 't1', active: true, title: 'Page', url: state.url }] };
    state.url = subcommand === 'new' ? row[2] ?? 'about:blank' : ${JSON.stringify(chosenUrl)};
    return { tabId: 't2' };
  }
  if (command === 'record') { if (row[3] !== undefined) state.url = row[3]; return { path: row[2], started: true }; }
  if (command === 'snapshot') return { origin: state.url, snapshot: '- textbox "' + (state.refName ?? 'Name') + '" [ref=e1]', refs: { e1: { role: 'textbox', name: state.refName ?? 'Name' } } };
  if (command === 'read') return { content: 'Rendered page', source: 'browser', url: state.url };
  if (command === 'network') return { requests: [] };
  if (command === 'console') return { messages: [] };
  if (command === 'errors') return { errors: [] };
  if (command === 'fill') { state.value = row[2]; return { filled: row[1] }; }
  if (command === 'get' && subcommand === 'value') return { value: state.value ?? '' };
  if (command === 'get' && subcommand === 'title') return { title: 'Page' };
  return { title: 'Page', url: state.url };
}
function result(row) {
  try { return { command: row, success: true, result: { ...execute(row), lifecycle: { effectiveLaunch: { browserLaunched: state.browser } } } }; }
  catch (error) { return { command: row, success: false, error: error.message }; }
}
if (tokens[0] === 'session' && tokens[1] === 'info' && state.timeoutInfo) setInterval(() => {}, 1000);
else {
let output, failed;
if (tokens[0] === 'batch') {
  const raw = tokens.slice(1).filter((token) => token !== '--bail');
  const rows = raw.length ? raw.map((row) => row.split(' ')) : JSON.parse(stdin);
  output = [];
  for (const row of rows) { const entry = result(row); output.push(entry); if (!entry.success && tokens.includes('--bail')) break; }
  failed = output.some((entry) => !entry.success);
} else { const entry = result(tokens); output = { success: entry.success, data: entry.result, error: entry.error }; failed = !entry.success; }
fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(state));
process.stdout.write(JSON.stringify(output));
process.exitCode = failed ? 1 : 0;
}`,
	);
	try {
		await withPatchedEnv(
			{
				PATH: `${root}${delimiter}${process.env.PATH ?? ""}`,
				HOME: home,
				USERPROFILE: home,
				AGENT_BROWSER_NAMESPACE: "",
				// Automatic restore requires upstream encryption on Windows; this is fixture data only.
				AGENT_BROWSER_ENCRYPTION_KEY: "a".repeat(64),
				PI_AGENT_BROWSER_SOCKET_DIR: socketDir,
				PI_AGENT_BROWSER_MANAGED_SESSION_RESTORE:
					options.restoreDisabled === true ? "0" : undefined,
				PI_AGENT_BROWSER_TEST_CUSTOM_SESSION_INFO: "1",
			},
			async () => {
				let branch: unknown[] = [];
				const prefix = [
					"--namespace",
					"cold",
					...(options.explicit === true ? ["--session", "caller"] : []),
				];
				let harness = createExtensionHarness({ branch, cwd });
				const call = async (params: AgentBrowserToolParams) => {
					const result = await executeRegisteredTool(harness.tool, harness.ctx, params);
					branch.push(
						createToolBranchEntry({ details: readRecord(result.details), isError: result.isError }),
					);
					return result;
				};
				await runExtensionEvent(harness.handlers, "session_start", { reason: "new" }, harness.ctx);
				for (const args of [
					[...prefix, ...(options.attached === true ? ["connect", "9222"] : ["open", url])],
					...(options.attached === true ? [[...prefix, "get", "url"]] : []),
					[...prefix, "snapshot", "-i"],
				]) {
					// These dependent calls reuse the same page, restore state, and shutdown ownership.
					// oxlint-disable-next-line no-await-in-loop
					const result = await call({
						args,
						...(args.includes("open") ? { sessionMode: "fresh" as const } : {}),
					});
					assert.equal(result.isError, false, readString(readRecord(result.content[0]).text));
				}
				const restore = async (reason: "quit" | "reload") => {
					await runExtensionEvent(harness.handlers, "session_shutdown", { reason }, harness.ctx);
					branch = structuredClone(harness.ctx.sessionManager.getBranch());
					harness = createExtensionHarness({ branch, cwd });
					await runExtensionEvent(
						harness.handlers,
						"session_start",
						{ reason: "resume" },
						harness.ctx,
					);
				};
				await restore(options.live === true ? "reload" : "quit");
				await writeFile(logPath, "");
				try {
					await run({
						call:
							options.explicit === true
								? (params) =>
										call({
											...params,
											args: [...prefix, ...readArray(params.args).map(readString)],
										})
								: call,
						calls: () => readInvocationLog(logPath),
						patch: async (patch) =>
							writeFile(
								statePath,
								JSON.stringify({
									...readRecord(JSON.parse(await readFile(statePath, "utf8"))),
									...patch,
								}),
							),
						reload: () => restore("reload"),
						state: async () => {
							const state = readRecord(JSON.parse(await readFile(statePath, "utf8")));
							return {
								...state,
								active: readBoolean(state.active),
								browser: readBoolean(state.browser),
								url: readString(state.url),
							};
						},
						tree: async () => {
							harness.setBranch(structuredClone(branch));
							await runExtensionEvent(harness.handlers, "session_tree", {}, harness.ctx);
						},
						url,
					});
				} finally {
					await runExtensionEvent(
						harness.handlers,
						"session_shutdown",
						{ reason: "quit" },
						harness.ctx,
					);
				}
			},
		);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(socketDir, { recursive: true, force: true });
	}
}

for (const state of ["cold", "known", "unknown", "reopen"]) {
	test(
		`session info timeout preserves ${state} state without browser recovery`,
		{ concurrency: false },
		async () => {
			await withPage(
				async (page) => {
					const initialArgs = {
						cold: ["--namespace", "cold", "--session", "cold-inspected", "session", "info"],
						reopen: ["tab", "list"],
						unknown: ["webmcp", "invoke", "wait_for_navigation", "--detach"],
						known: ["snapshot", "-i"],
					};
					const before = await page.call({
						args: readArray(readRecord(initialArgs)[state]).map(readString),
					});
					assert.equal(before.isError, false, readString(readRecord(before.content[0]).text));
					if (state === "known") {
						// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.notEqual(readRecord(readRecord(before.details).refSnapshot), undefined);
					}
					if (state === "unknown") {
						// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(readRecord(before.details).sessionTabTargetUnknown, true);
					}
					if (state === "reopen") {
						// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(readRecord(before.details).sessionTabReopenPending, true);
					}
					const prefix = [
						"--namespace",
						"cold",
						"--session",
						readString(readRecord(before.details).sessionName),
					];
					const args = [...prefix, "session", "info"];
					const nativeBefore = await page.state();
					const offset = (await page.calls()).length;
					await page.patch({ timeoutInfo: true });
					let timedOut;
					try {
						timedOut = await page.call({ args, timeoutMs: 800 });
					} finally {
						await page.patch({ timeoutInfo: false });
					}
					assert.equal(timedOut.isError, true);
					assert.equal(
						readRecord(timedOut.details).exitCode,
						process.platform === "win32" ? 1 : 124,
					);
					assert.equal(readRecord(timedOut.details).timedOut, true);
					assert.equal(readRecord(timedOut.details).failureCategory, "timeout");
					assert.deepEqual(
						(await page.calls()).slice(offset).map((row) => row.args),
						[["--json", ...args]],
					);
					assert.deepEqual(
						{ ...(await page.state()), timeoutInfo: undefined },
						{ ...nativeBefore, timeoutInfo: undefined },
					);
					for (const key of [
						"sessionTabTarget",
						"sessionTabTargetUnknown",
						"refSnapshotInvalidation",
						"sessionTabReopenPending",
					]) {
						// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.deepEqual(
							readRecord(timedOut.details)[key],
							readRecord(before.details)[key],
							key,
						);
					}
					for (const key of [
						"timeoutPartialProgress",
						"artifacts",
						"artifactVerification",
						"browserWindow",
						"lifecycle",
						"data",
						"managedSessionOutcome",
					]) {
						// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(readRecord(timedOut.details)[key], undefined, key);
					}
					const actions = readArray(readRecord(timedOut.details).nextActions);
					assert.deepEqual(
						actions.map((action) => ({
							id: readRecord(action).id,
							args: readRecord(readRecord(action).params).args,
						})),
						[{ id: "retry-session-info", args }],
					);
					const retried = await page.call({
						args: readArray(readRecord(readRecord(actions[0]).params).args).map(readString),
					});
					assert.equal(retried.isError, false, readString(readRecord(retried.content[0]).text));
					assert.equal(
						readRecord(readRecord(retried.details).data).piCleanupOwnership,
						state === "cold" ? "caller-owned" : "wrapper-managed",
					);
					assert.deepEqual(
						(await page.calls()).slice(offset).map((row) => row.args),
						[
							["--json", ...args],
							["--json", ...args],
						],
					);
					assert.deepEqual(
						{ ...(await page.state()), timeoutInfo: undefined },
						{ ...nativeBefore, timeoutInfo: undefined },
					);
					if (state === "unknown") {
						const blocked = await page.call({ args: [...prefix, "snapshot", "-i"] });
						// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(blocked.isError, true);
						// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.match(
							readString(readRecord(blocked.content[0]).text),
							/active page became unverified/,
						);
						// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal((await page.calls()).length, offset + 2);
					}
					if (state === "reopen") {
						const snapshot = await page.call({ args: [...prefix, "snapshot", "-i"] });
						// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(snapshot.isError, false, readString(readRecord(snapshot.content[0]).text));
						// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(readRecord(readRecord(snapshot.details).data).origin, page.url);
					}
				},
				{ live: state === "known" || state === "unknown" },
			);
		},
	);
}

for (const prefix of [
	["tab", "list"],
	["read", chosenUrl],
]) {
	test(
		`cold reopen survives ${prefix.join(" ")} before snapshot`,
		{ concurrency: false },
		async () => {
			await withPage(async (page) => {
				const first = await page.call({ args: prefix });
				assert.equal(first.isError, false, readString(readRecord(first.content[0]).text));
				assert.equal((await page.state()).active, prefix[0] !== "read");
				assert.equal((await page.state()).browser, prefix[0] === "tab");
				assert.equal(
					(await page.state()).url,
					prefix[0] === "tab" ? new URL(page.url).origin + "/" : "about:blank",
				);
				assert.equal(
					(await page.calls()).some((row) => row.args.includes("open")),
					false,
				);
				const snapshot = await page.call({ args: ["snapshot", "-i"] });
				assert.equal(snapshot.isError, false, readString(readRecord(snapshot.content[0]).text));
				assert.equal(readRecord(readRecord(snapshot.details).data).origin, page.url);
				assert.deepEqual(
					(await page.calls())
						.filter((row) => row.args.includes("open"))
						.map((row) => extractUpstreamCommandTokens(row.args)),
					[["open", page.url]],
				);
			});
		},
	);
}

for (const args of [
	["get", "url"],
	["get", "title"],
	["reload"],
	["back"],
	["forward"],
	["pushstate", "/route"],
]) {
	test(
		`cold current-page command reopens before ${args.join(" ")}`,
		{ concurrency: false },
		async () => {
			await withPage(async (page) => {
				const result = await page.call({ args });
				assert.equal(result.isError, false, readString(readRecord(result.content[0]).text));
				const commands = (await page.calls()).map((row) => extractUpstreamCommandTokens(row.args));
				assert.ok(
					commands.findIndex((row) => row[0] === "open") <
						commands.findIndex((row) => JSON.stringify(row) === JSON.stringify(args)),
					JSON.stringify(commands),
				);
				assert.deepEqual(
					commands.filter((row) => row[0] === "open"),
					[["open", page.url]],
				);
			});
		},
	);
}

for (const prefix of [
	["tab", "list"],
	["read", "--timeout", "100", chosenUrl],
	["console", "--clear"],
]) {
	test(
		`cold reopen persists through non-page ${prefix.join(" ")} and transcript replay`,
		{ concurrency: false },
		async () => {
			await withPage(async (page) => {
				const first = await page.call({ args: prefix });
				assert.equal(first.isError, false, readString(readRecord(first.content[0]).text));
				assert.equal(
					(await page.state()).active,
					prefix[0] !== "read",
					"HTTP reads leave the cold managed daemon untouched",
				);
				assert.equal(
					(await page.calls()).some((row) => row.args.includes("open")),
					false,
				);
				await page.tree();
				await page.reload();
				const result = await page.call({ args: ["get", "url"] });
				assert.equal(result.isError, false, readString(readRecord(result.content[0]).text));
				assert.equal(readRecord(readRecord(result.details).data).url, page.url);
				const snapshot = await page.call({ args: ["snapshot", "-i"] });
				assert.equal(snapshot.isError, false, readString(readRecord(snapshot.content[0]).text));
				assert.equal(readRecord(readRecord(snapshot.details).data).origin, page.url);
				assert.deepEqual(
					(await page.calls())
						.filter((row) => row.args.includes("open"))
						.map((row) => extractUpstreamCommandTokens(row.args)),
					[["open", page.url]],
				);
			});
		},
	);
}

for (const prefix of [
	["tab", "list"],
	["read", "--timeout", "100", chosenUrl],
	["session", "info"],
	["console", "--clear"],
]) {
	test(
		`cold batch finds the page dependency after ${prefix.join(" ")}`,
		{ concurrency: false },
		async () => {
			await withPage(async (page) => {
				const stdin = JSON.stringify([prefix, ["snapshot", "-i"]]);
				const result = await page.call({ args: ["batch", "--bail"], stdin });
				assert.equal(result.isError, false, readString(readRecord(result.content[0]).text));
				assert.equal(
					readRecord(readRecord(readArray(readRecord(result.details).data).at(-1)).result).origin,
					page.url,
				);
				const calls = await page.calls();
				assert.equal(calls.filter((row) => row.args.includes("batch")).length, 1);
				assert.equal(calls.find((row) => row.args.includes("batch"))?.stdin, stdin);
				assert.deepEqual(
					calls
						.filter((row) => row.args.includes("open"))
						.map((row) => extractUpstreamCommandTokens(row.args)),
					[["open", page.url]],
				);
			});
		},
	);
}

for (const boundary of [
	["open", chosenUrl],
	["close"],
	["tab", "new", chosenUrl],
	["state", "load", "fixture.json"],
]) {
	test(
		`cold batch respects non-page prefixes before ${boundary.join(" ")}`,
		{ concurrency: false },
		async () => {
			await withPage(async (page) => {
				const stdin = JSON.stringify([["tab", "list"], boundary, ["get", "url"]]);
				const result = await page.call({ args: ["batch", "--bail"], stdin });
				assert.equal(result.isError, false, readString(readRecord(result.content[0]).text));
				const calls = await page.calls();
				assert.equal(
					calls.some((row) => extractUpstreamCommandTokens(row.args)[0] === "open"),
					false,
					"do not reopen ahead of explicit context changes",
				);
				assert.equal(calls.find((row) => row.args.includes("batch"))?.stdin, stdin);
			});
		},
	);
}

for (const bail of [false, true]) {
	test(
		`cold preparation preserves native batch error continuation (bail=${bail})`,
		{ concurrency: false },
		async () => {
			await withPage(async (page) => {
				const args = ["batch", ...(bail ? ["--bail"] : [])];
				const stdin = JSON.stringify([["tab", "list"], ["not-a-command"], ["snapshot", "-i"]]);
				const result = await page.call({ args, stdin });
				assert.equal(result.isError, true);
				const rows = readArray(readRecord(result.details).batchSteps);
				assert.deepEqual(
					rows.map((row) => readRecord(row).success),
					bail ? [true, false] : [true, false, true],
				);
				const batches = (await page.calls()).filter((row) => row.args.includes("batch"));
				assert.equal(batches.length, 1);
				assert.deepEqual(extractUpstreamCommandTokens(batches[0].args), args);
				assert.equal(batches[0].stdin, stdin);
				if (!bail) {
					// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
					// oxlint-disable-next-line node-test/no-conditional-assertion
					assert.equal(
						readRecord(readRecord(readArray(readRecord(result.details).data).at(-1)).result).origin,
						page.url,
					);
				}
			});
		},
	);
}

for (const params of [
	{ args: ["snapshot", "-i"] },
	{
		args: ["batch", "--bail"],
		stdin: JSON.stringify([
			["tab", "list"],
			["snapshot", "-i"],
		]),
	},
]) {
	test(
		`cold hash-router URL is reopened intact for ${params.args.join(" ")}`,
		{ concurrency: false },
		async () => {
			await withPage(
				async (page) => {
					const result = await page.call(params);
					assert.equal(result.isError, false, readString(readRecord(result.content[0]).text));
					assert.equal((await page.state()).url, hashRouteUrl);
					assert.deepEqual(
						(await page.calls())
							.filter((row) => extractUpstreamCommandTokens(row.args)[0] === "open")
							.map((row) => extractUpstreamCommandTokens(row.args)),
						[["open", hashRouteUrl]],
					);
					assert.equal(
						readRecord(readRecord(readRecord(result.details).refSnapshot).target).url,
						hashRouteUrl,
					);
				},
				{ url: hashRouteUrl },
			);
		},
	);
}

test(
	"live hash-only changes retain fragment-insensitive ref freshness checks",
	{ concurrency: false },
	async () => {
		await withPage(
			async (page) => {
				await page.patch({ url: "http://127.0.0.1:43210/app#/other", refName: "Different field" });
				const result = await page.call({ args: ["get", "value", "@e1"] });
				assert.equal(readRecord(result.details).failureCategory, "stale-ref");
				assert.equal(
					(await page.calls()).some(
						(row) => row.args.includes("open") || row.args.includes("value"),
					),
					false,
				);
			},
			{ live: true, url: hashRouteUrl },
		);
	},
);

test(
	"cold current-URL network filtering reopens before its helper and persists ref invalidation",
	{ concurrency: false },
	async () => {
		await withPage(async (page) => {
			const result = await page.call({ args: ["network", "requests", "--current-url"] });
			assert.equal(result.isError, false, readString(readRecord(result.content[0]).text));
			assert.equal(
				readRecord(readRecord(result.details).networkRequestsPageFilter).currentUrl,
				page.url,
			);
			await page.reload();
			const stale = await page.call({ args: ["get", "value", "@e1"] });
			assert.equal(readRecord(stale.details).failureCategory, "stale-ref");
			assert.equal(
				(await page.calls()).some((row) => row.args.includes("value")),
				false,
			);
		});
	},
);

const explicitDestinations = [
	["read", "--timeout", "100", "--filter", "needle", chosenUrl],
	["read", "--llms", "full", chosenUrl],
	["a11y", "--tags", "wcag2a", "-s", "main", chosenUrl],
	["vitals", chosenUrl],
	["web-vitals", chosenUrl],
	["diff", "url", rememberedUrl, chosenUrl, "--selector", "main", "--wait-until", "load"],
	["window", "new"],
	["record", "start", "chosen.webm", chosenUrl],
];
for (const command of explicitDestinations) {
	for (const batch of [false, true]) {
		test(
			`live missing tab permits explicit destination ${command.join(" ")} (batch=${batch})`,
			{ concurrency: false },
			async () => {
				await withPage(
					async (page) => {
						await page.patch({ url: "http://127.0.0.1:43210/other" });
						const args = batch ? ["batch"] : command;
						const stdin = batch ? JSON.stringify([command]) : undefined;
						const result = await page.call({ args, stdin });
						assert.equal(result.isError, false, readString(readRecord(result.content[0]).text));
						const calls = await page.calls();
						const userCalls = calls.filter(
							(row) => extractUpstreamCommandTokens(row.args)[0] === args[0],
						);
						assert.equal(userCalls.length, 1, "the requested command must actually dispatch");
						assert.deepEqual(extractUpstreamCommandTokens(userCalls[0].args), args);
						if (batch) {
							// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
							// oxlint-disable-next-line node-test/no-conditional-assertion
							assert.equal(userCalls[0].stdin, stdin);
						}
						assert.equal(
							calls.some((row) => extractUpstreamCommandTokens(row.args)[0] === "open"),
							false,
						);
					},
					{ live: true },
				);
			},
		);
	}
}

test(
	"live raw explicit URL read ignores unused stdin without old-tab recovery",
	{ concurrency: false },
	async () => {
		await withPage(
			async (page) => {
				await page.patch({ url: "http://127.0.0.1:43210/other" });
				const raw = `read --timeout 100 ${chosenUrl}`;
				const stdin = JSON.stringify([["snapshot", "-i"]]);
				const args = ["--headers", '{"x-fixture":"boundary"}', "--no-pin-tab", "batch", raw];
				const result = await page.call({ args, stdin });
				assert.equal(result.isError, false, readString(readRecord(result.content[0]).text));
				const batch = (await page.calls()).find((row) => row.args.includes("batch"));
				assert.ok(batch);
				assert.deepEqual(batch.args.slice(-args.length), args);
				assert.equal(batch.stdin, stdin);
				assert.deepEqual(
					readArray(readRecord(result.details).batchSteps).map((row) => readRecord(row).command),
					[["read", "--timeout", "100", chosenUrl]],
				);
				assert.equal(
					(await page.calls()).some((row) =>
						["open", "tab", "snapshot"].includes(extractUpstreamCommandTokens(row.args)[0]),
					),
					false,
				);
			},
			{ live: true, explicit: true },
		);
	},
);

for (const command of [
	["network", "requests", "--current-url"],
	["read", "--filter", chosenUrl],
	["read", "--llms", "full"],
	["a11y", "--selector", chosenUrl],
	["a11y", "--tags", "wcag2a"],
	["vitals"],
	["diff", "snapshot"],
	["record", "start", "chosen.webm"],
	["reload"],
	["pushstate", "/route"],
	["fill", "#name", "text"],
]) {
	test(
		`live page-dependent ${command.join(" ")} still protects a missing tab`,
		{ concurrency: false },
		async () => {
			await withPage(
				async (page) => {
					await page.patch({ url: "http://127.0.0.1:43210/other" });
					for (const params of [
						{ args: command },
						{ args: ["batch"], stdin: JSON.stringify([["read", chosenUrl], command]) },
					]) {
						// These dependent calls reuse the same page, restore state, and shutdown ownership.
						// oxlint-disable-next-line no-await-in-loop
						const result = await page.call(params);
						// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(readRecord(result.details).failureCategory, "tab-drift");
					}
					assert.equal(
						(await page.calls()).some(
							(row) => !["session", "tab"].includes(extractUpstreamCommandTokens(row.args)[0]),
						),
						false,
						"neither page actions nor unsolicited navigation may run",
					);
				},
				{ live: true },
			);
		},
	);
}

for (const options of [{ explicit: true }, { attached: true }, { restoreDisabled: true }]) {
	test(
		`cold boundary does not navigate outside automatic restore: ${JSON.stringify(options)}`,
		{ concurrency: false },
		async () => {
			for (const inspectFirst of [false, true]) {
				// These dependent calls reuse the same page, restore state, and shutdown ownership.
				// oxlint-disable-next-line no-await-in-loop
				await withPage(async (page) => {
					if (inspectFirst) {
						await page.call({ args: ["tab", "list"] });
					}
					await page.call({ args: ["snapshot", "-i"] });
					// Fixed cold/known/unknown/reopen and batch fixtures require different state assertions; common dispatch checks remain unconditional.
					// oxlint-disable-next-line node-test/no-conditional-assertion
					assert.equal(
						(await page.calls()).some(
							(row) => extractUpstreamCommandTokens(row.args)[0] === "open",
						),
						false,
					);
				}, options);
			}
		},
	);
}

for (const reachedNavigation of [false, true]) {
	test(
		`cold pending reopen follows executed batch rows (navigation reached=${reachedNavigation})`,
		{ concurrency: false },
		async () => {
			await withPage(async (page) => {
				const tabs = await page.call({ args: ["tab", "list"] });
				assert.equal(tabs.isError, false, readString(readRecord(tabs.content[0]).text));
				await page.patch({ failNext: reachedNavigation ? "open" : "console" });
				const result = await page.call({
					args: ["batch", "--bail"],
					stdin: JSON.stringify([
						["console", "--clear"],
						["open", chosenUrl],
					]),
				});
				assert.equal(result.isError, true);
				await page.reload();
				await page.call({ args: ["snapshot", "-i"] });
				assert.equal(
					(await page.calls()).filter((row) => extractUpstreamCommandTokens(row.args)[0] === "open")
						.length,
					reachedNavigation ? 0 : 1,
					"unreached navigation must not consume the obligation; attempted navigation must not trigger an unsolicited retry",
				);
			});
		},
	);
}
