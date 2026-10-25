import assert from "node:assert/strict";
import { readRecord } from "./helpers/assertions.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import agentBrowserExtension from "../extensions/agent-browser/index.js";
import {
	PROJECT_RULE_PROMPT,
	QUICK_START_GUIDELINES,
	RUNTIME_PROMPT_GUIDELINES,
	SHARED_BROWSER_PLAYBOOK_GUIDELINES,
	ADVANCED_TOOL_PROMPT_GUIDELINES,
	WRAPPER_TAB_RECOVERY_BEHAVIOR,
} from "../extensions/agent-browser/lib/playbook.js";
import {
	createExtensionHarness,
	getBrowserInstructions,
	runExtensionEvent,
	withPatchedEnv,
} from "./helpers/agent-browser-harness.js";

test("the native skill retains the canonical operating guidance without eager injection", async () => {
	const harness = createExtensionHarness({ cwd: process.cwd() });
	const active = harness.getActiveTools();
	const body = await getBrowserInstructions(harness);
	for (const line of [
		PROJECT_RULE_PROMPT,
		...RUNTIME_PROMPT_GUIDELINES,
		...QUICK_START_GUIDELINES,
		...SHARED_BROWSER_PLAYBOOK_GUIDELINES,
		...WRAPPER_TAB_RECOVERY_BEHAVIOR,
		...Object.values(ADVANCED_TOOL_PROMPT_GUIDELINES).flat(),
	]) {
		// All canonical instructions must remain available when the skill is read.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.ok(body.includes(line), `missing skill guidance: ${line}`);
	}
	assert.deepEqual(harness.getActiveTools(), active);
	assert.ok([...harness.tools.values()].every((tool) => tool.promptGuidelines.length === 0));
});

test("full instructions retain trusted config and late web-search guidance without legacy metadata", async () => {
	const root = await mkdtemp(join(tmpdir(), "piab-instructions-"));
	try {
		await withPatchedEnv(
			{
				HOME: join(root, "home"),
				PI_AGENT_BROWSER_CONFIG: undefined,
				EXA_API_KEY: undefined,
				BRAVE_API_KEY: undefined,
			},
			async () => {
				const loader = new DefaultResourceLoader({
					agentDir: root,
					cwd: root,
					noContextFiles: true,
					noExtensions: true,
					noSkills: true,
					noThemes: true,
					noPromptTemplates: true,
					extensionFactories: [agentBrowserExtension],
				});
				await loader.reload();
				assert.deepEqual(loader.getExtensions().errors, []);
				const modelRuntime = await ModelRuntime.create({
					allowModelNetwork: false,
					credentials: new InMemoryCredentialStore(),
					modelsPath: null,
				});
				const { session } = await createAgentSession({
					cwd: root,
					modelRuntime,
					resourceLoader: loader,
					noTools: "builtin",
					settingsManager: SettingsManager.inMemory(),
					sessionManager: SessionManager.inMemory(root),
				});
				try {
					assert.equal(session.getToolDefinition("agent_browser_web_search"), undefined);
					const configPath = join(root, ".pi/config/pi-agent-browser-native/config.json");
					await mkdir(dirname(configPath), { recursive: true });
					await writeFile(
						configPath,
						JSON.stringify({
							version: 1,
							webSearch: { braveApiKey: "test-only-key" },
							browser: { executablePath: "/tmp/project-browser" },
						}),
					);
					await session.bindExtensions({
						onError: (error) => {
							throw new Error(error.error);
						},
					});
					assert.ok(session.getToolDefinition("agent_browser_web_search"));
					for (const tool of session
						.getAllTools()
						.filter((definition) => definition.name.startsWith("agent_browser"))) {
						// Every loaded browser tool must use supported SDK metadata, not bespoke discovery.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(
							Object.hasOwn(readRecord(session.getToolDefinition(tool.name)), "discovery"),
							false,
						);
						// Every loaded browser tool must avoid eager prompt leakage; tools are asserted above.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.deepEqual(tool.promptGuidelines ?? [], []);
					}
					for (const trusted of [true, false]) {
						const harness = createExtensionHarness({ cwd: root, projectTrusted: trusted });
						// Trusted-session startup owns tool registration before instruction discovery.
						// oxlint-disable-next-line no-await-in-loop
						await runExtensionEvent(
							harness.handlers,
							"session_start",
							{ reason: "new" },
							harness.ctx,
						);
						// Read this trust variant's instructions before the next environment-scoped startup.
						// oxlint-disable-next-line no-await-in-loop
						const fallback = await getBrowserInstructions(harness);
						// Both fixed trust variants must honor project browser-config trust.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(fallback.includes("/tmp/project-browser"), trusted);
						// Optional search guidance stays in the skill; tool registration still follows configuration trust.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.equal(Boolean(harness.getTool("agent_browser_web_search")), trusted);
						// Neither fixed trust variant may leak the independent credential canary.
						// oxlint-disable-next-line node-test/no-conditional-assertion
						assert.ok(!fallback.includes("test-only-key"));
					}
					await session.reload();
					assert.ok(session.getToolDefinition("agent_browser_web_search"));
				} finally {
					session.dispose();
				}
			},
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
