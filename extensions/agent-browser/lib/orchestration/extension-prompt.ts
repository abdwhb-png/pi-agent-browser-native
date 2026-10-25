import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	buildBrowserDefaultProfileGuideline,
	buildBrowserExecutablePathGuideline,
	buildInstalledDocsGuideline,
} from "../playbook.js";
import { AGENT_BROWSER_NAMESPACE } from "../native-output.js";
import { isRecord } from "../parsing.js";
import { buildPromptPolicy, getLatestUserMessage, getMessageText } from "../prompt-policy.js";
import { canRegisterWebSearchTool, loadAgentBrowserConfigSync } from "../config.js";
import { createAgentBrowserWebSearchTool } from "../web-search.js";
import {
	isDirectAgentBrowserBashAllowed,
	isHarmlessAgentBrowserInspectionCommand,
	looksLikeDirectAgentBrowserBash,
} from "../bash-guard.js";

interface PromptState {
	sessionId: string;
	message: ReturnType<typeof getLatestUserMessage>;
	text?: string;
	policy?: ReturnType<typeof buildPromptPolicy>;
}
export function isBashToolCallEvent(
	event: unknown,
): event is { readonly input: { readonly command: string }; readonly toolName: "bash" } {
	return (
		isRecord(event) &&
		event.toolName === "bash" &&
		isRecord(event.input) &&
		typeof event.input.command === "string"
	);
}
export function findPackageRoot(startDir: string): string {
	let currentDir = startDir;
	while (true) {
		const packageJsonPath = join(currentDir, "package.json");
		if (existsSync(packageJsonPath)) {
			const packageJson: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
			if (isRecord(packageJson) && packageJson.name === "pi-agent-browser-native") {
				return currentDir;
			}
		}
		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			return startDir;
		}
		currentDir = parentDir;
	}
}
export function getInstalledDocsPaths(): {
	readmePath: string;
	commandReferencePath: string;
	toolContractPath: string;
} {
	const root = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
	return {
		readmePath: join(root, "README.md"),
		commandReferencePath: join(root, "docs", "COMMAND_REFERENCE.md"),
		toolContractPath: join(root, "docs", "TOOL_CONTRACT.md"),
	};
}
export function hasArgvFlag(argv: readonly string[], longFlag: string, shortFlag: string): boolean {
	return argv.includes(longFlag) || argv.includes(shortFlag);
}
export function shouldIncludeProjectConfig(
	ctx: Readonly<Pick<ExtensionContext, "isProjectTrusted">>,
	argv: readonly string[] = process.argv,
): boolean {
	return !hasArgvFlag(argv, "--no-approve", "-na") && ctx.isProjectTrusted();
}
/** Owns prompt caching and companion registration, never browser or artifact state. */
export class BrowserPrompt {
	private state: PromptState | undefined;
	private webSearchToolRegistered = false;
	constructor(private readonly pi: ExtensionAPI) {}
	restore(ctx: ExtensionContext): PromptState {
		this.state = {
			sessionId: ctx.sessionManager.getSessionId(),
			message: getLatestUserMessage(ctx.sessionManager),
		};
		return this.state;
	}
	policy(ctx: ExtensionContext): ReturnType<typeof buildPromptPolicy> {
		const state =
			this.state?.sessionId === ctx.sessionManager.getSessionId() ? this.state : this.restore(ctx);
		// Keep the native message reference: later transforms must be reflected in policy.
		const text = getMessageText(state.message?.content);
		if (!state.policy || state.text !== text) {
			state.text = text;
			state.policy = buildPromptPolicy(text);
		}
		return state.policy;
	}
	registerWebSearch(config: ReturnType<typeof loadAgentBrowserConfigSync>): void {
		if (this.webSearchToolRegistered || !canRegisterWebSearchTool(config)) {
			return;
		}
		this.pi.registerTool({
			...createAgentBrowserWebSearchTool(config, {
				loadConfigState(ctx) {
					return loadAgentBrowserConfigSync({
						cwd: ctx.cwd,
						includeProjectConfig: shouldIncludeProjectConfig(ctx),
					});
				},
			}),
		});
		this.webSearchToolRegistered = true;
	}
	private runtimeGuidelines(ctx: ExtensionContext): string[] {
		const config = loadAgentBrowserConfigSync({
			cwd: ctx.cwd,
			includeProjectConfig: shouldIncludeProjectConfig(ctx),
		});
		return [
			buildInstalledDocsGuideline(getInstalledDocsPaths()),
			buildBrowserExecutablePathGuideline(config.browserExecutablePath),
			buildBrowserDefaultProfileGuideline(config.browserDefaultProfile),
		].filter((line): line is string => line !== undefined);
	}
	register(): void {
		const skillPath = join(
			findPackageRoot(dirname(fileURLToPath(import.meta.url))),
			"resources",
			"skills",
			"pi-browser-tool",
			"SKILL.md",
		);
		this.pi.on("resources_discover", () => ({ skillPaths: [skillPath] }));
		this.pi.on("message_end", (event, ctx) => {
			if (event.message.role === "user") {
				this.state = { sessionId: ctx.sessionManager.getSessionId(), message: event.message };
			}
		});
		this.pi.on("before_agent_start", (event, ctx) => {
			const active = new Set(this.pi.getActiveTools());
			const tool = this.pi
				.getAllTools()
				.find(
					(candidate) =>
						candidate.namespace?.name === AGENT_BROWSER_NAMESPACE.name &&
						active.has(candidate.name),
				);
			if (tool === undefined) {
				event.systemPromptOptions.skills = event.systemPromptOptions.skills.filter(
					(skill) => skill.filePath !== skillPath,
				);
				return;
			}
			event.systemPromptOptions.toolGuidelines[tool.name] = this.runtimeGuidelines(ctx);
		});
		this.pi.on("tool_call", async (event, ctx) => {
			if (
				!isBashToolCallEvent(event) ||
				!looksLikeDirectAgentBrowserBash(event.input.command) ||
				isHarmlessAgentBrowserInspectionCommand(event.input.command)
			) {
				return;
			}
			if (
				!this.policy(ctx).allowLegacyAgentBrowserBash &&
				!(await isDirectAgentBrowserBashAllowed(ctx.cwd))
			) {
				return {
					block: true,
					reason:
						"Use the native agent_browser tool instead of bash for agent-browser in this environment.",
				};
			}
			return;
		});
	}
}
