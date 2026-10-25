import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	loadSkills,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
	InMemoryCredentialStore,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	getCurrentSystemPrompt,
} from "@earendil-works/pi-ai";
import agentBrowserExtension from "../extensions/agent-browser/index.js";
import {
	createExtensionHarness,
	runExtensionEventResults,
	withPatchedEnv,
} from "./helpers/agent-browser-harness.js";
import { readRecord, readArray, readString } from "./helpers/assertions.js";

test("the native extension registers a normal packaged Pi skill", async () => {
	const harness = createExtensionHarness({ cwd: process.cwd() });
	const results = await runExtensionEventResults(
		harness.handlers,
		"resources_discover",
		{ reason: "startup", cwd: process.cwd() },
		harness.ctx,
	);
	assert.equal(results.length, 1);
	const paths = readArray(readRecord(results[0]).skillPaths).map(readString);
	const loaded = loadSkills({
		cwd: process.cwd(),
		agentDir: process.cwd(),
		skillPaths: paths,
		includeDefaults: false,
	});
	assert.equal(loaded.skills.length, 1);
	assert.deepEqual(loaded.diagnostics, []);
	assert.equal(loaded.skills[0]?.name, "pi-browser-tool");
	const skill = loaded.skills.at(0);
	assert.ok(skill);
	const body = await readFile(skill.filePath, "utf8");
	assert.match(body, /agent_browser_qa/);
	assert.match(body, /screenshotPath/);
	assert.match(body, /"screenshot", "--full"/);
});

test("normal Pi skill advertisement follows active browser tools without reload", async () => {
	const root = await mkdtemp(join(tmpdir(), "piab-skill-runtime-"));
	try {
		await withPatchedEnv(
			{ HOME: join(root, "home"), BRAVE_API_KEY: undefined, EXA_API_KEY: undefined },
			async () => {
				let api: ExtensionAPI | undefined;
				let starts = 0;
				let discoveries = 0;
				const loader = new DefaultResourceLoader({
					cwd: root,
					agentDir: root,
					noSkills: true,
					noExtensions: true,
					noContextFiles: true,
					noThemes: true,
					noPromptTemplates: true,
					extensionFactories: [
						agentBrowserExtension,
						(pi) => {
							api = pi;
							pi.on("session_start", () => {
								starts += 1;
							});
							pi.on("resources_discover", () => {
								discoveries += 1;
							});
						},
					],
				});
				await loader.reload();
				const models = await ModelRuntime.create({
					credentials: new InMemoryCredentialStore(),
					modelsPath: null,
					allowModelNetwork: false,
				});
				await models.setRuntimeApiKey("openai", "test-only-no-provider-call");
				const model = models.getModel("openai", "gpt-4o");
				assert.ok(model);
				const { session } = await createAgentSession({
					cwd: root,
					agentDir: root,
					model,
					modelRuntime: models,
					resourceLoader: loader,
					settingsManager: SettingsManager.inMemory(),
					sessionManager: SessionManager.inMemory(root),
				});
				try {
					await session.bindExtensions({
						onError: (error) => {
							throw new Error(error.error);
						},
					});
					assert.ok(api);
					const prompts: string[] = [];
					session.agent.streamFunction = (_model, context) => {
						prompts.push(getCurrentSystemPrompt(context.messages));
						const stream = createAssistantMessageEventStream();
						stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("done") });
						stream.end();
						return stream;
					};
					const baseline = api.getActiveTools().filter((name) => !name.startsWith("agent_browser"));
					api.setActiveTools(baseline);
					await session.prompt("Inspect the repository.");
					api.setActiveTools([...baseline, "agent_browser_qa"]);
					await session.prompt("Check the browser page.");
					api.setActiveTools(baseline);
					await session.prompt("Return to repository work.");
					assert.deepEqual(
						prompts.map((prompt) => prompt.includes("<name>pi-browser-tool</name>")),
						[false, true, false],
					);
					assert.ok(prompts.every((prompt) => !prompt.includes("## Operating guidance")));
					assert.equal(starts, 1);
					assert.equal(discoveries, 1);
					assert.ok(api.getCommands().some((command) => command.name === "skill:pi-browser-tool"));
					await session.prompt("/skill:pi-browser-tool inspect");
					assert.ok(
						JSON.stringify(
							session.messages.findLast((message) => message.role === "user"),
						).includes("## Operating guidance"),
					);
				} finally {
					session.dispose();
				}
			},
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
