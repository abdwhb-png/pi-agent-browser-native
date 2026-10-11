import { isRecord } from "../parsing.js";
import { extractUpstreamCommandTokens } from "../argv-descriptor.js";
import { GLOBAL_BOOLEAN_FLAGS_WITH_OPTIONAL_VALUES } from "../argv-grammar.js";
import { redactInvocationArgs } from "../runtime.js";
import { getUpstreamEffectiveBatchSteps } from "./batch-stdin.js";
import type { AgentBrowserToolResult } from "./browser-run/types.js";
import { runAgentBrowserProcess, type ProcessRunResult } from "../process.js";
import type { AgentBrowserNextAction } from "../results/next-actions.js";

const HELP_TIMEOUT_MS = 5_000;
const MAX_HELP_BYTES = 256 * 1_024;
const HELP_USAGE_PATTERN = /^Usage:\s+agent-browser\s+(.+)$/gmu;
const FLAG_PATTERN = /(?<![\w-])(--?[A-Za-z][\w-]*)(?:[= ](<[^>]+>|\[[^\]]+\]))?/gu;

export interface DynamicArgvValidationDetails {
	readonly checkedCommands: readonly string[];
	readonly observedVersion?: string;
	readonly status: "rejected" | "unavailable" | "verified";
	readonly unsupportedFlags?: readonly string[];
}

export interface DynamicArgvValidationResult {
	readonly details: DynamicArgvValidationDetails;
	readonly rejection?: AgentBrowserToolResult;
	readonly warning?: string;
}

interface HelpGrammar {
	readonly commandOptionsDocumented: boolean;
	readonly flags: ReadonlyMap<string, boolean>;
	readonly maxPositionals?: number;
	readonly variadicPositionals: boolean;
}

interface CachedHelp {
	grammar?: HelpGrammar;
	reason?: string;
}

type RunProbe = (
	args: readonly string[],
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal,
) => Promise<ProcessRunResult>;

function parseObservedVersion(stdout: string): string | undefined {
	return stdout.match(/\b(?:agent-browser\s+)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u)?.[1];
}

function parseHelpFlags(help: string): ReadonlyMap<string, boolean> {
	const flags = new Map<string, boolean>();
	for (const match of help.matchAll(FLAG_PATTERN)) {
		const flag = match.at(1);
		if (flag === undefined) {
			continue;
		}
		flags.set(flag, match.at(2) !== undefined || flags.get(flag) === true);
	}
	return flags;
}

function parseHelpPositionals(
	help: string,
	command: string | undefined,
): Pick<HelpGrammar, "maxPositionals" | "variadicPositionals"> {
	let maxPositionals: number | undefined;
	let variadicPositionals = false;
	for (const match of help.matchAll(HELP_USAGE_PATTERN)) {
		const usage = match.at(1)?.trim() ?? "";
		const tokens: string[] = usage.match(/<[^>]+>|\[[^\]]+\]|\S+/gu) ?? [];
		const commandIndex = command === undefined ? -1 : tokens.indexOf(command);
		if (command !== undefined && commandIndex < 0) {
			continue;
		}
		const positionals = tokens
			.slice(commandIndex + 1)
			.filter((token) => !token.startsWith("[--") && /^<[^>]+>$|^\[[^\]]+\]$/u.test(token));
		maxPositionals = Math.max(maxPositionals ?? 0, positionals.length);
		variadicPositionals ||= positionals.some((token) => token.includes("..."));
	}
	return { maxPositionals, variadicPositionals };
}

function parseHelpGrammar(help: string, command: string | undefined): HelpGrammar | undefined {
	if (!/^Usage:\s+agent-browser\s+/mu.test(help)) {
		return undefined;
	}
	return {
		commandOptionsDocumented: command === undefined || /^Options:\s*$/mu.test(help),
		flags: parseHelpFlags(help),
		...parseHelpPositionals(help, command),
	};
}

function combineHelpGrammar(
	root: HelpGrammar | undefined,
	family: HelpGrammar | undefined,
): HelpGrammar | undefined {
	if (root === undefined || family === undefined || !family.commandOptionsDocumented) {
		return undefined;
	}
	return { ...family, flags: new Map([...root.flags, ...family.flags]) };
}

function isUsableHelpResult(result: ProcessRunResult): boolean {
	return (
		result.exitCode === 0 &&
		!result.aborted &&
		!result.timedOut &&
		!result.spawnError &&
		result.stdoutSpillPath === undefined &&
		Buffer.byteLength(result.stdout, "utf8") <= MAX_HELP_BYTES
	);
}

function consumesNextFlagValue(
	flag: string,
	token: string,
	next: string | undefined,
	takesValue: boolean,
): boolean {
	return (
		(takesValue && !token.includes("=")) ||
		(GLOBAL_BOOLEAN_FLAGS_WITH_OPTIONAL_VALUES.has(flag) && ["true", "false"].includes(next ?? ""))
	);
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
		const flag = token.split("=", 1)[0];
		const takesValue = grammar.flags.get(flag);
		if (takesValue !== undefined) {
			if (consumesNextFlagValue(flag, token, tokens[index + 1], takesValue)) {
				index += 1;
			}
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
		if (token.startsWith(`${flag}=`)) {
			continue;
		}
		output.push(token);
	}
	return output;
}

function buildRejection(options: {
	readonly args: readonly string[];
	readonly checkedCommands: readonly string[];
	readonly observedVersion?: string;
	readonly unsupportedFlags: readonly string[];
}): AgentBrowserToolResult {
	const commandTokens = extractUpstreamCommandTokens(options.args);
	const command = commandTokens[0] ?? "command";
	const unsupported = options.unsupportedFlags.join(", ");
	const consoleLevel = command === "console" && options.unsupportedFlags.includes("--level");
	const nextActions: AgentBrowserNextAction[] | undefined = consoleLevel
		? [
				{
					id: "retry-console-without-level",
					params: { args: redactInvocationArgs(removeFlagAndValue(options.args, "--level")) },
					reason:
						"The installed upstream console command returns the aggregate console buffer and does not filter by level. Inspect the returned message types instead.",
					safety:
						"This retries the same read-only console inspection without the unsupported flag.",
					tool: "agent_browser",
				},
			]
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

export interface ArgvValidationInput {
	readonly args: readonly string[];
	readonly cwd: string;
	readonly path: string;
	readonly signal?: AbortSignal;
	readonly stdin?: string;
}

export class DynamicArgvValidator {
	readonly #helpCache = new Map<string, CachedHelp>();
	readonly #runProbe: RunProbe;

	constructor(runProbe: RunProbe) {
		this.#runProbe = runProbe;
	}

	async #loadHelp(
		cacheKey: string,
		args: readonly string[],
		command: string | undefined,
		options: ArgvValidationInput,
	): Promise<CachedHelp> {
		const cached = this.#helpCache.get(cacheKey);
		if (cached) {
			return cached;
		}
		const result = await this.#runProbe(args, options.cwd, HELP_TIMEOUT_MS, options.signal);
		const loaded = isUsableHelpResult(result)
			? {
					grammar: parseHelpGrammar(result.stdout, command),
					reason: "help output did not contain a usable Usage line",
				}
			: { reason: result.timedOut ? "help timed out" : "help was unavailable or exceeded 256 KiB" };
		if (!loaded.grammar) {
			delete loaded.grammar;
		}
		this.#helpCache.set(cacheKey, loaded);
		return loaded;
	}

	async #observeVersion(options: ArgvValidationInput): Promise<string | undefined> {
		const versionProbe = await this.#runProbe(
			["--version"],
			options.cwd,
			HELP_TIMEOUT_MS,
			options.signal,
		);
		return isUsableHelpResult(versionProbe) ? parseObservedVersion(versionProbe.stdout) : undefined;
	}

	async validate(options: ArgvValidationInput): Promise<DynamicArgvValidationResult> {
		const observedVersion = await this.#observeVersion(options);
		const identity = `${options.cwd}\0${options.path}\0${observedVersion ?? "unobserved"}`;
		const rootHelp = await this.#loadHelp(`${identity}\0root`, ["--help"], undefined, options);
		const commandTokens = extractUpstreamCommandTokens(options.args);
		const steps =
			commandTokens[0] === "batch"
				? [commandTokens, ...getUpstreamEffectiveBatchSteps(commandTokens, options.stdin)]
				: [commandTokens];
		const checkedCommands: string[] = [];
		const unsupportedFlags = new Set<string>();
		let unavailable = !rootHelp.grammar;
		let hasFlagsNeedingVerification = hasUnverifiedFlag(commandTokens);

		const commands = [
			...new Set(steps.map((tokens) => tokens.at(0)).filter((command) => command !== undefined)),
		];
		const families = new Map(
			await Promise.all(
				commands.map(
					async (command) =>
						[
							command,
							(
								await this.#loadHelp(
									`${identity}\0${command}`,
									[command, "--help"],
									command,
									options,
								)
							).grammar,
						] as const,
				),
			),
		);
		for (const tokens of steps) {
			const command = tokens.at(0);
			if (command === undefined) {
				continue;
			}
			checkedCommands.push(command);
			if (command === "plugin" && tokens[1] === "run") {
				continue;
			}
			hasFlagsNeedingVerification ||= hasUnverifiedFlag(tokens);
			const familyHelp = families.get(command);
			const grammar = combineHelpGrammar(rootHelp.grammar, familyHelp);
			if (grammar === undefined) {
				unavailable = true;
				continue;
			}
			for (const flag of getUnsupportedFlags(tokens, grammar)) {
				unsupportedFlags.add(flag);
			}
		}

		return validationResult({
			args: options.args,
			checkedCommands,
			observedVersion,
			unsupportedFlags: [...unsupportedFlags],
			unavailable,
			hasFlagsNeedingVerification,
		});
	}
}

function appendJsonWarning(text: string, warning: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	} // Non-JSON output receives a separate visible warning.
	if (!isRecord(parsed) || Array.isArray(parsed)) {
		return undefined;
	}
	const warnings = Array.isArray(parsed.warnings)
		? parsed.warnings.filter((entry: unknown) => typeof entry === "string")
		: [];
	return JSON.stringify({ ...parsed, warnings: [...warnings, warning] }, null, 2);
}

export function applyDynamicArgvValidationWarning(
	result: AgentBrowserToolResult,
	validation: DynamicArgvValidationResult,
	userRequestedJson = false,
): AgentBrowserToolResult {
	if (validation.warning === undefined) {
		return result;
	}
	const content = [...result.content];
	const first = content.at(0);
	if (first?.type === "text" && userRequestedJson) {
		const json = appendJsonWarning(first.text, validation.warning);
		if (json === undefined) {
			content.push({ type: "text", text: validation.warning });
		} else {
			content[0] = { ...first, text: json };
		}
	} else if (first?.type === "text") {
		content[0] = { ...first, text: `${first.text}\n\n${validation.warning}` };
	} else {
		content.push({ type: "text", text: validation.warning });
	}
	return {
		...result,
		content,
		details: {
			...(isRecord(result.details) ? result.details : {}),
			argvValidation: validation.details,
		},
	};
}

function validationResult({
	args,
	checkedCommands,
	observedVersion,
	unsupportedFlags,
	unavailable,
	hasFlagsNeedingVerification,
}: {
	readonly args: readonly string[];
	readonly checkedCommands: readonly string[];
	readonly observedVersion: string | undefined;
	readonly unsupportedFlags: readonly string[];
	readonly unavailable: boolean;
	readonly hasFlagsNeedingVerification: boolean;
}): DynamicArgvValidationResult {
	let status: DynamicArgvValidationDetails["status"] = unavailable ? "unavailable" : "verified";
	if (unsupportedFlags.length > 0) {
		status = "rejected";
	}
	const details: DynamicArgvValidationDetails = {
		checkedCommands: [...new Set(checkedCommands)],
		observedVersion,
		status: status,
		unsupportedFlags: unsupportedFlags.length > 0 ? unsupportedFlags : undefined,
	};
	if (unsupportedFlags.length > 0) {
		return {
			details,
			rejection: buildRejection({
				args,
				checkedCommands: details.checkedCommands,
				observedVersion,
				unsupportedFlags: unsupportedFlags,
			}),
		};
	}
	return {
		details,
		warning:
			unavailable && hasFlagsNeedingVerification
				? "Argv validation warning: installed agent-browser help could not be inspected, so one or more flags were not verified before dispatch."
				: undefined,
	};
}

const runtimeValidators = new WeakMap<object, DynamicArgvValidator>();

export function validateRuntimeArgv(
	runtime: object,
	input: ArgvValidationInput,
): Promise<DynamicArgvValidationResult> {
	let validator = runtimeValidators.get(runtime);
	if (validator === undefined) {
		validator = new DynamicArgvValidator((args, cwd, timeoutMs, signal) =>
			runAgentBrowserProcess({
				args,
				cwd,
				timeoutMs,
				signal,
				env: { PI_AGENT_BROWSER_ARGV_INSPECTION: "1" },
			}),
		);
		runtimeValidators.set(runtime, validator);
	}
	return validator.validate(input);
}
