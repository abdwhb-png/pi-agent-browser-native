import { extractUpstreamCommandTokens } from "../argv-descriptor.js";
import { GLOBAL_BOOLEAN_FLAGS_WITH_OPTIONAL_VALUES } from "../argv-grammar.js";
import { redactInvocationArgs } from "../runtime.js";
import { getUpstreamEffectiveBatchSteps } from "./batch-stdin.js";
import type { AgentBrowserToolResult } from "./browser-run/types.js";
import type { ProcessRunResult } from "../process.js";
import type { AgentBrowserNextAction } from "../results/next-actions.js";

const HELP_TIMEOUT_MS = 5_000;
const MAX_HELP_BYTES = 256 * 1_024;
const HELP_USAGE_PATTERN = /^Usage:\s+agent-browser\s+(.+)$/gmu;
const FLAG_PATTERN = /(?<![\w-])(--?[A-Za-z][\w-]*)(?:[= ](<[^>]+>|\[[^\]]+\]))?/gu;

export interface DynamicArgvValidationDetails {
	checkedCommands: string[];
	observedVersion?: string;
	status: "rejected" | "unavailable" | "verified";
	unsupportedFlags?: string[];
}

export interface DynamicArgvValidationResult {
	details: DynamicArgvValidationDetails;
	rejection?: AgentBrowserToolResult;
	warning?: string;
}

interface HelpGrammar {
	commandOptionsDocumented: boolean;
	flags: Map<string, boolean>;
	maxPositionals?: number;
	variadicPositionals: boolean;
}

interface CachedHelp {
	grammar?: HelpGrammar;
	reason?: string;
}

type RunProbe = (args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal) => Promise<ProcessRunResult>;

function parseObservedVersion(stdout: string): string | undefined {
	return stdout.match(/\b(?:agent-browser\s+)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u)?.[1];
}

function parseHelpGrammar(help: string, command: string | undefined): HelpGrammar | undefined {
	if (!/^Usage:\s+agent-browser\s+/mu.test(help)) return undefined;
	const flags = new Map<string, boolean>();
	for (const match of help.matchAll(FLAG_PATTERN)) {
		const flag = match[1];
		if (!flag) continue;
		flags.set(flag, match[2] !== undefined || flags.get(flag) === true);
	}

	let maxPositionals: number | undefined;
	let variadicPositionals = false;
	for (const match of help.matchAll(HELP_USAGE_PATTERN)) {
		const usage = match[1]?.trim();
		if (!usage) continue;
		const tokens: string[] = usage.match(/<[^>]+>|\[[^\]]+\]|\S+/gu) ?? [];
		const commandIndex = command ? tokens.indexOf(command) : -1;
		if (command && commandIndex < 0) continue;
		const tail = tokens.slice(commandIndex + 1);
		let count = 0;
		for (let index = 0; index < tail.length; index += 1) {
			const token = tail[index] ?? "";
			if (token.startsWith("-") || token.startsWith("[--")) {
				continue;
			}
			if (/^<[^>]+>$|^\[[^\]]+\]$/u.test(token)) {
				count += 1;
				if (token.includes("...")) variadicPositionals = true;
			}
		}
		maxPositionals = Math.max(maxPositionals ?? 0, count);
	}
	return {
		commandOptionsDocumented: command === undefined || /^Options:\s*$/mu.test(help),
		flags,
		maxPositionals,
		variadicPositionals,
	};
}

function isUsableHelpResult(result: ProcessRunResult): boolean {
	return result.exitCode === 0
		&& !result.aborted
		&& !result.timedOut
		&& !result.spawnError
		&& result.stdoutSpillPath === undefined
		&& Buffer.byteLength(result.stdout, "utf8") <= MAX_HELP_BYTES;
}

function getUnsupportedFlags(tokens: readonly string[], grammar: HelpGrammar): string[] {
	const unsupported = new Set<string>();
	let positionalCount = 0;
	for (let index = 1; index < tokens.length; index += 1) {
		const token = tokens[index] ?? "";
		if (!token.startsWith("-") || token === "-") {
			positionalCount += 1;
			continue;
		}
		const flag = token.split("=", 1)[0] ?? token;
		const takesValue = grammar.flags.get(flag);
		if (takesValue !== undefined) {
			if (takesValue && !token.includes("=")) index += 1;
			else if (GLOBAL_BOOLEAN_FLAGS_WITH_OPTIONAL_VALUES.has(flag) && ["true", "false"].includes(tokens[index + 1] ?? "")) index += 1;
			continue;
		}
		if (grammar.variadicPositionals || positionalCount < (grammar.maxPositionals ?? 0)) {
			positionalCount += 1;
			continue;
		}
		unsupported.add(flag);
	}
	return [...unsupported];
}

function hasUnverifiedFlag(tokens: readonly string[]): boolean {
	return tokens.slice(1).some((token) => /^--?[A-Za-z]/u.test(token));
}

function removeFlagAndValue(args: readonly string[], flag: string): string[] {
	const output: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const token = args[index] ?? "";
		if (token === flag) {
			index += 1;
			continue;
		}
		if (token.startsWith(`${flag}=`)) continue;
		output.push(token);
	}
	return output;
}

function buildRejection(options: {
	args: string[];
	checkedCommands: string[];
	observedVersion?: string;
	unsupportedFlags: string[];
}): AgentBrowserToolResult {
	const commandTokens = extractUpstreamCommandTokens(options.args);
	const command = commandTokens[0] ?? "command";
	const unsupported = options.unsupportedFlags.join(", ");
	const consoleLevel = command === "console" && options.unsupportedFlags.includes("--level");
	const nextActions: AgentBrowserNextAction[] | undefined = consoleLevel
		? [{
			id: "retry-console-without-level",
			params: { args: redactInvocationArgs(removeFlagAndValue(options.args, "--level")) },
			reason: "The installed upstream console command returns the aggregate console buffer and does not filter by level. Inspect the returned message types instead.",
			safety: "This retries the same read-only console inspection without the unsupported flag.",
			tool: "agent_browser",
		}]
		: undefined;
	const message = consoleLevel
		? `Installed agent-browser ${options.observedVersion ?? "(version unavailable)"} does not support --level for console. Upstream returns the aggregate console buffer; inspect message types after the call.`
		: `Installed agent-browser does not support ${unsupported} for ${command}.`;
	const nextActionText = nextActions
		? `\n\nNext actions:\n- retry-console-without-level ${JSON.stringify(nextActions[0]?.params)}: ${nextActions[0]?.reason}`
		: "";
	return {
		content: [{ type: "text", text: `${message}${nextActionText}` }],
		details: {
			args: redactInvocationArgs(options.args),
			failureCategory: "validation-error",
			resultCategory: "failure",
			argvValidation: {
				checkedCommands: options.checkedCommands,
				observedVersion: options.observedVersion,
				status: "rejected",
				unsupportedFlags: options.unsupportedFlags,
			} satisfies DynamicArgvValidationDetails,
			nextActions,
		},
		isError: true,
	};
}

export class DynamicArgvValidator {
	readonly #helpCache = new Map<string, CachedHelp>();
	readonly #runProbe: RunProbe;

	constructor(runProbe: RunProbe) {
		this.#runProbe = runProbe;
	}

	async #loadHelp(cacheKey: string, args: string[], cwd: string, command: string | undefined, signal?: AbortSignal): Promise<CachedHelp> {
		const cached = this.#helpCache.get(cacheKey);
		if (cached) return cached;
		const result = await this.#runProbe(args, cwd, HELP_TIMEOUT_MS, signal);
		const loaded = isUsableHelpResult(result)
			? { grammar: parseHelpGrammar(result.stdout, command), reason: "help output did not contain a usable Usage line" }
			: { reason: result.timedOut ? "help timed out" : "help was unavailable or exceeded 256 KiB" };
		if (!loaded.grammar) delete loaded.grammar;
		this.#helpCache.set(cacheKey, loaded);
		return loaded;
	}

	async validate(options: { args: string[]; cwd: string; path: string; signal?: AbortSignal; stdin?: string }): Promise<DynamicArgvValidationResult> {
		const versionProbe = await this.#runProbe(["--version"], options.cwd, HELP_TIMEOUT_MS, options.signal);
		const observedVersion = isUsableHelpResult(versionProbe) ? parseObservedVersion(versionProbe.stdout) : undefined;
		const identity = `${options.cwd}\0${options.path}\0${observedVersion ?? "unobserved"}`;
		const rootHelp = await this.#loadHelp(`${identity}\0root`, ["--help"], options.cwd, undefined, options.signal);
		const commandTokens = extractUpstreamCommandTokens(options.args);
		const steps = commandTokens[0] === "batch"
			? [commandTokens, ...getUpstreamEffectiveBatchSteps(commandTokens, options.stdin)]
			: [commandTokens];
		const checkedCommands: string[] = [];
		const unsupportedFlags = new Set<string>();
		let unavailable = !rootHelp.grammar;
		let hasFlagsNeedingVerification = hasUnverifiedFlag(commandTokens);

		for (const tokens of steps) {
			const command = tokens[0];
			if (!command) continue;
			checkedCommands.push(command);
			if (command === "plugin" && tokens[1] === "run") continue;
			hasFlagsNeedingVerification ||= hasUnverifiedFlag(tokens);
			const familyHelp = await this.#loadHelp(`${identity}\0${command}`, [command, "--help"], options.cwd, command, options.signal);
			if (!rootHelp.grammar || !familyHelp.grammar || !familyHelp.grammar.commandOptionsDocumented) {
				unavailable = true;
				continue;
			}
			const grammar: HelpGrammar = {
				commandOptionsDocumented: true,
				flags: new Map([...rootHelp.grammar.flags, ...familyHelp.grammar.flags]),
				maxPositionals: familyHelp.grammar.maxPositionals,
				variadicPositionals: familyHelp.grammar.variadicPositionals,
			};
			for (const flag of getUnsupportedFlags(tokens, grammar)) unsupportedFlags.add(flag);
		}

		const details: DynamicArgvValidationDetails = {
			checkedCommands: [...new Set(checkedCommands)],
			observedVersion,
			status: unsupportedFlags.size > 0 ? "rejected" : unavailable ? "unavailable" : "verified",
			unsupportedFlags: unsupportedFlags.size > 0 ? [...unsupportedFlags] : undefined,
		};
		if (unsupportedFlags.size > 0) {
			return {
				details,
				rejection: buildRejection({
					args: options.args,
					checkedCommands: details.checkedCommands,
					observedVersion,
					unsupportedFlags: [...unsupportedFlags],
				}),
			};
		}
		return {
			details,
			warning: unavailable && hasFlagsNeedingVerification
				? "Argv validation warning: installed agent-browser help could not be inspected, so one or more flags were not verified before dispatch."
				: undefined,
		};
	}
}

export function applyDynamicArgvValidationWarning(
	result: AgentBrowserToolResult,
	validation: DynamicArgvValidationResult,
	userRequestedJson = false,
): AgentBrowserToolResult {
	if (!validation.warning) return result;
	const content = [...result.content];
	const first = content[0];
	if (first?.type === "text" && userRequestedJson) {
		try {
			const parsed = JSON.parse(first.text) as unknown;
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				const payload = parsed as Record<string, unknown>;
				const existingWarnings = Array.isArray(payload.warnings)
					? payload.warnings.filter((warning): warning is string => typeof warning === "string")
					: [];
				content[0] = { ...first, text: JSON.stringify({ ...payload, warnings: [...existingWarnings, validation.warning] }, null, 2) };
			} else content.push({ type: "text", text: validation.warning });
		} catch {
			content.push({ type: "text", text: validation.warning });
		}
	} else if (first?.type === "text") content[0] = { ...first, text: `${first.text}\n\n${validation.warning}` };
	else content.push({ type: "text", text: validation.warning });
	return {
		...result,
		content,
		details: {
			...(typeof result.details === "object" && result.details !== null ? result.details : {}),
			argvValidation: validation.details,
		},
	};
}
