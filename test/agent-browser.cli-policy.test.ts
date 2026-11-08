import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readRecord } from "./helpers/assertions.js";
import {
	createExtensionHarness,
	runExtensionEventResults,
	withPatchedEnv,
} from "./helpers/agent-browser-harness.js";

test("native extension allows direct CLI calls by default", async () => {
	const root = await mkdtemp(join(tmpdir(), "piab-cli-policy-"));
	try {
		const config = join(root, "config.json");
		await writeFile(config, "{}");
		await withPatchedEnv({ PI_AGENT_BROWSER_CONFIG: config }, async () => {
			const harness = createExtensionHarness({ cwd: root, prompt: "Open a page." });
			assert.deepEqual(
				await runExtensionEventResults(
					harness.handlers,
					"tool_call",
					{
						toolName: "bash",
						input: { command: "agent-browser open https://example.com" },
					},
					harness.ctx,
				),
				[],
			);
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

for (const blockDirectCli of [false, true]) {
	test(`explicit CLI blocking ${blockDirectCli} overrides prompt, environment, and package cwd`, async () => {
		const root = await mkdtemp(join(tmpdir(), "piab-cli-explicit-"));
		try {
			const config = join(root, "config.json");
			await writeFile(config, JSON.stringify({ blockDirectCli }));
			await writeFile(
				join(root, "package.json"),
				JSON.stringify({ name: "pi-agent-browser-native" }),
			);
			await withPatchedEnv(
				{ PI_AGENT_BROWSER_CONFIG: config, PI_AGENT_BROWSER_ALLOW_DIRECT_BASH: "1" },
				async () => {
					const harness = createExtensionHarness({
						cwd: root,
						prompt: "Please debug agent-browser via bash.",
					});
					const results = await runExtensionEventResults(
						harness.handlers,
						"tool_call",
						{
							toolName: "bash",
							input: { command: "npx --yes agent-browser --version" },
						},
						harness.ctx,
					);
					assert.deepEqual(
						results.map((result) => readRecord(result).block),
						blockDirectCli ? [true] : [],
					);
				},
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}

for (const command of [
	"agent-browser open https://example.com",
	"env agent-browser --version",
	"cat <<'EOF'\nwhich agent-browser\nEOF\nagent-browser open https://example.com",
	"FOO=bar agent-browser --version",
	'FOO="bar baz" agent-browser --version',
	"echo ready\nagent-browser open https://example.com",
	"which agent-browser && agent-browser open https://example.com",
	"npx --yes agent-browser open https://example.com",
	"pnpm dlx agent-browser open https://example.com",
	"/opt/bin/agent-browser open https://example.com",
]) {
	test(`explicit blocking rejects ${command}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "piab-cli-launch-"));
		try {
			const config = join(root, "config.json");
			await writeFile(config, JSON.stringify({ blockDirectCli: true }));
			await withPatchedEnv({ PI_AGENT_BROWSER_CONFIG: config }, async () => {
				const harness = createExtensionHarness({ cwd: root, prompt: "Open a page." });
				assert.deepEqual(
					(
						await runExtensionEventResults(
							harness.handlers,
							"tool_call",
							{
								toolName: "bash",
								input: { command },
							},
							harness.ctx,
						)
					).map((result) => readRecord(result).block),
					[true],
				);
				assert.deepEqual(
					await runExtensionEventResults(
						harness.handlers,
						"tool_call",
						{
							toolName: "bash",
							input: { command: "command -v agent-browser" },
						},
						harness.ctx,
					),
					[],
				);
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}

for (const projectTrusted of [false, true]) {
	test(`CLI blocking respects project trust ${projectTrusted} and config reload`, async () => {
		const root = await mkdtemp(join(tmpdir(), "piab-cli-trust-"));
		try {
			const globalDir = join(root, ".pi", "config", "pi-agent-browser-native");
			const cwd = join(root, "project");
			const projectDir = join(cwd, ".pi", "config", "pi-agent-browser-native");
			await mkdir(globalDir, { recursive: true });
			await mkdir(projectDir, { recursive: true });
			await writeFile(join(globalDir, "config.json"), JSON.stringify({ blockDirectCli: true }));
			await writeFile(join(projectDir, "config.json"), JSON.stringify({ blockDirectCli: false }));
			await withPatchedEnv({ HOME: root, PI_AGENT_BROWSER_CONFIG: undefined }, async () => {
				const harness = createExtensionHarness({ cwd, projectTrusted, prompt: "Open a page." });
				const event = { toolName: "bash", input: { command: "agent-browser --version" } };
				const results = await runExtensionEventResults(
					harness.handlers,
					"tool_call",
					event,
					harness.ctx,
				);
				assert.deepEqual(
					results.map((result) => readRecord(result).block),
					projectTrusted ? [] : [true],
				);
				await writeFile(join(globalDir, "config.json"), JSON.stringify({ blockDirectCli: false }));
				assert.deepEqual(
					await runExtensionEventResults(harness.handlers, "tool_call", event, harness.ctx),
					[],
				);
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}

test("explicit blocking leaves discovery, unrelated tools, and non-executing shell text available", async () => {
	const root = await mkdtemp(join(tmpdir(), "piab-cli-inspection-"));
	try {
		const config = join(root, "config.json");
		await writeFile(config, JSON.stringify({ blockDirectCli: true }));
		await withPatchedEnv({ PI_AGENT_BROWSER_CONFIG: config }, async () => {
			const harness = createExtensionHarness({ cwd: root, prompt: "Inspect the browser." });
			const commands = [
				"which agent-browser",
				"type -P agent-browser",
				"echo agent-browser",
				"grep agent-browser README.md",
				"printf '%s' agent-browser",
				"cat <<'EOF'\nagent-browser open https://example.com\nEOF",
			];
			const results = await Promise.all(
				commands.map((command) =>
					runExtensionEventResults(
						harness.handlers,
						"tool_call",
						{ toolName: "bash", input: { command } },
						harness.ctx,
					),
				),
			);
			assert.deepEqual(
				results,
				commands.map(() => []),
			);
			assert.deepEqual(
				await runExtensionEventResults(
					harness.handlers,
					"tool_call",
					{ toolName: "read", input: { path: "README.md" } },
					harness.ctx,
				),
				[],
			);
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
