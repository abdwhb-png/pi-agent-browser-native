import type { DynamicArgvValidationResult } from "./dynamic-argv-validation.js";
import { format } from "node:util";
import { extractUpstreamCommandTokens, isPlainTextInspectionArgs } from "../runtime.js";
import {
	extractExplicitSessionName,
	resolveAgentBrowserNamespace,
	scanUpstreamGlobalFlagOccurrences,
} from "../argv-grammar.js";
import { parseArgvDescriptor } from "../argv-descriptor.js";
import { needsManagedSession } from "../command-policy.js";
import { isRecord } from "../parsing.js";
import { getAgentBrowserProcessTimeoutMs } from "../process.js";
import { getCommandAwareProcessTimeoutMs } from "./browser-run/prepare/wait-timeouts.js";
import { getAgentBrowserProcessEnvironment } from "../process-environment.js";
import { withNativeSessionDefaults } from "./native-session-defaults.js";
import { getBrowserCwdError, resolveExecutionCwd } from "../execution-cwd.js";
import { resolveOperationPaths } from "./operation-paths.js";
import { isCloseCommand } from "../command-taxonomy.js";
import { getSessionContextKey } from "./browser-run/session-state.js";
import {
	buildValidationFailureResult,
	resolveAgentBrowserInput,
	type ResolvedAgentBrowserValidInput,
} from "./input-plan.js";
import { applyAgentBrowserOutputPath } from "./output-file.js";
import { loadAgentBrowserConfigSync } from "../config.js";
import { scopeReadConfirmationArgs } from "../read-confirmation.js";
import {
	getArtifactPreflightValidationError,
	commandClosesAllSessions,
} from "./extension-artifact-preflight.js";
import { browserExecutionFailure } from "./extension-result-state.js";
import { shouldSerializeBrowserCommand } from "./extension-managed-ownership.js";
import { shouldSerializeElectronHostInput } from "./extension-electron-ownership.js";
import { shouldIncludeProjectConfig } from "./extension-prompt.js";
import { validateUpstreamVersion } from "./extension-version-check.js";
import type { BrowserRuntime } from "./extension-runtime.js";
import { applyUnserializedOutputPath } from "./extension-command-output.js";
import { runCoordinatedElectronHostInput } from "./extension-host-coordination.js";
import { runWithinSessionQueue } from "./extension-execution-queue.js";
import type {
	BrowserInvocation,
	AdmittedBrowserCall,
	PreparedBrowserCall,
	NativeBrowserCall,
	CoordinatedBrowserCall,
	NativeLaunchDefaultsRunner,
} from "./extension-invocation.js";
import type { AgentBrowserToolResult } from "./browser-run/types.js";

type Admission<T> = { readonly call: T } | { readonly failure: AgentBrowserToolResult };

function validationFailure(
	input: ResolvedAgentBrowserValidInput,
	validationError: string,
): AgentBrowserToolResult {
	return buildValidationFailureResult({
		...input,
		attemptedKind: input.kind,
		kind: "invalid",
		status: "invalid",
		validationError,
	});
}

// tool_call hooks can mutate input before the canonical input planner validates it.
function requestedOutputPath(params: unknown): string | undefined {
	return isRecord(params) && typeof params.outputPath === "string" ? params.outputPath : undefined;
}

function operationTimeout(
	call: AdmittedBrowserCall,
	input: ResolvedAgentBrowserValidInput,
): number {
	const electronTimeout =
		input.kind === "electron" && "timeoutMs" in input.compiledElectron
			? input.compiledElectron.timeoutMs
			: undefined;
	return (
		electronTimeout ??
		call.params.timeoutMs ??
		getCommandAwareProcessTimeoutMs(
			extractUpstreamCommandTokens(input.toolArgs),
			input.toolStdin,
		) ??
		getAgentBrowserProcessTimeoutMs()
	);
}

class BrowserAdmission {
	constructor(
		readonly runtime: BrowserRuntime,
		readonly invocation: BrowserInvocation,
	) {}

	admit(): Admission<AdmittedBrowserCall> {
		const { runtime, invocation } = this;
		const branch = invocation.selectedBranch ?? runtime.branch.capture(invocation.ctx);
		let operationCwd: string;
		try {
			operationCwd = invocation.capturedCwd ?? resolveExecutionCwd(runtime.pi, invocation.ctx);
		} catch (error) {
			return {
				failure: buildValidationFailureResult({
					kind: "invalid",
					status: "invalid",
					redactedArgs: [],
					toolArgs: [],
					validationError: error instanceof Error ? error.message : format("%s", error),
				}),
			};
		}
		return this.validateInvocation(branch, operationCwd);
	}

	validateInvocation(
		branch: AdmittedBrowserCall["branch"],
		operationCwd: string,
	): Admission<AdmittedBrowserCall> {
		const { runtime, invocation } = this;
		const promptPolicy = runtime.prompt.policy(invocation.ctx);
		const outputPath = requestedOutputPath(invocation.params);
		const input = resolveAgentBrowserInput({
			getBatchPreflightValidationError: (args, stdin) =>
				getArtifactPreflightValidationError({ args, cwd: operationCwd, outputPath, stdin }),
			params: invocation.params,
		});
		if (input.status === "invalid") {
			return { failure: buildValidationFailureResult(input) };
		}
		const replayError = this.replayFailure(input);
		if (replayError) {
			return { failure: replayError };
		}
		const explicitConfig =
			scanUpstreamGlobalFlagOccurrences(input.toolArgs, "--config").length > 0 ||
			getAgentBrowserProcessEnvironment().AGENT_BROWSER_CONFIG !== undefined;
		const session = extractExplicitSessionName(input.toolArgs);
		const managedAtAdmission =
			input.kind !== "electron" && (session === undefined || session === "") && !explicitConfig;
		return {
			call: {
				...invocation,
				branch,
				operationCwd,
				promptPolicy,
				outputPath,
				admittedInput: input,
				explicitConfig,
				managedAtAdmission,
			},
		};
	}

	replayFailure(input: ResolvedAgentBrowserValidInput): AgentBrowserToolResult | undefined {
		const error = this.runtime.branch.replayError;
		if (error === undefined || error === "" || isPlainTextInspectionArgs(input.toolArgs)) {
			return undefined;
		}
		return browserExecutionFailure(new Error(error), this.invocation.signal, "validation-error");
	}

	selectBrowserCwd(call: AdmittedBrowserCall): string {
		const session = extractExplicitSessionName(call.admittedInput.toolArgs);
		if (call.explicitConfig) {
			return call.operationCwd;
		}
		if (session !== undefined && session !== "") {
			const namespace = resolveAgentBrowserNamespace(
				call.admittedInput.toolArgs,
				getAgentBrowserProcessEnvironment().AGENT_BROWSER_NAMESPACE,
			);
			return (
				this.runtime.managed.owned.get(getSessionContextKey(session, namespace) ?? session)?.cwd ??
				call.ctx.cwd
			);
		}
		if (call.params.sessionMode === "fresh") {
			return call.operationCwd;
		}
		return this.runtime.managed.active ? this.runtime.managed.cwd : call.ctx.cwd;
	}

	prepare(call: AdmittedBrowserCall): Admission<PreparedBrowserCall> {
		const browserCwd = this.selectBrowserCwd(call);
		const input = call.admittedInput;
		const error = input.kind === "electron" ? undefined : getBrowserCwdError(browserCwd);
		if (error !== undefined && error !== "") {
			return { failure: validationFailure(input, error) };
		}
		const resolvedInput = this.bindOperationPaths(call, browserCwd);
		return {
			call: {
				...call,
				browserCwd,
				resolvedInput,
				executionTimeoutMs: operationTimeout(call, resolvedInput),
			},
		};
	}

	bindOperationPaths(
		call: AdmittedBrowserCall,
		browserCwd: string,
	): ResolvedAgentBrowserValidInput {
		const input = call.admittedInput;
		if (
			isPlainTextInspectionArgs(input.toolArgs) ||
			(call.operationCwd === browserCwd && call.operationCwd === call.ctx.cwd)
		) {
			return input;
		}
		const bound = resolveOperationPaths(input.toolArgs, input.toolStdin, call.operationCwd);
		return { ...input, toolArgs: bound.args, toolStdin: bound.stdin };
	}

	canSelectNativeRoot(call: PreparedBrowserCall): boolean {
		if (
			this.runtime.managed.active ||
			this.runtime.managed.freshOrdinal > 0 ||
			call.params.sessionMode === "fresh"
		) {
			return false;
		}
		return (
			this.runtime.sessions.pages.findReadConfirmation(
				[...call.resolvedInput.toolArgs],
				resolveAgentBrowserNamespace(
					call.resolvedInput.toolArgs,
					getAgentBrowserProcessEnvironment().AGENT_BROWSER_NAMESPACE,
				),
				call.resolvedInput.toolStdin,
			) === undefined
		);
	}

	nativeRoot(
		call: PreparedBrowserCall,
		config: ReturnType<typeof loadAgentBrowserConfigSync>,
	): Parameters<typeof withNativeSessionDefaults>[1]["root"] {
		if (!this.canSelectNativeRoot(call)) {
			return undefined;
		}
		const root = process.env.PI_SUBAGENT_ROOT_SESSION_ID;
		const id =
			process.env.PI_SUBAGENT_CHILD === "1" && root !== undefined && root !== ""
				? root
				: call.ctx.sessionManager.getSessionId();
		const profile = config.trustedBrowserDefaultProfile;
		return {
			id,
			profile:
				profile?.policy === "always" && !/[\\/~]/.test(profile.name) ? profile.name : undefined,
			executablePath: config.trustedBrowserExecutablePath,
		};
	}

	async executeAdmitted(admitted: AdmittedBrowserCall): Promise<AgentBrowserToolResult> {
		const prepared = this.prepare(admitted);
		if ("failure" in prepared) {
			return prepared.failure;
		}
		const { call } = prepared;
		await this.runtime.beforeExecute?.(call.nativeToolCallId, { ...call.ctx, signal: call.signal });
		const config = loadAgentBrowserConfigSync({
			cwd: call.ctx.cwd,
			includeProjectConfig: shouldIncludeProjectConfig(call.ctx),
		});
		return withNativeSessionDefaults(
			call.resolvedInput,
			{ cwd: call.browserCwd, signal: call.signal, root: this.nativeRoot(call, config) },
			(input, defaults) => this.executeNative(call, input, defaults),
		);
	}

	prepareNative(
		call: PreparedBrowserCall,
		input: ResolvedAgentBrowserValidInput,
		defaults?: NativeLaunchDefaultsRunner,
	): Admission<NativeBrowserCall> {
		const readConfirmation = this.runtime.sessions.pages.findReadConfirmation(
			[...input.toolArgs],
			resolveAgentBrowserNamespace(
				input.toolArgs,
				getAgentBrowserProcessEnvironment().AGENT_BROWSER_NAMESPACE,
			),
			input.toolStdin,
		);
		const resolvedInput = readConfirmation
			? { ...input, toolArgs: scopeReadConfirmationArgs(input.toolArgs, readConfirmation) }
			: input;
		const qaFailure = this.attachedQaFailure(resolvedInput);
		if (qaFailure) {
			return { failure: qaFailure };
		}
		return {
			call: {
				...call,
				resolvedInput,
				readConfirmation,
				withLaunchDefaults: defaults,
				toolArgs: resolvedInput.toolArgs,
				compiledElectron:
					resolvedInput.kind === "electron" ? resolvedInput.compiledElectron : undefined,
				redactedCompiledElectron:
					resolvedInput.kind === "electron" ? resolvedInput.redactedCompiledElectron : undefined,
			},
		};
	}

	attachedQaFailure(input: ResolvedAgentBrowserValidInput): AgentBrowserToolResult | undefined {
		if (
			input.kind !== "qa" ||
			!input.compiledQaPreset.checks.attached ||
			this.runtime.managed.active
		) {
			return undefined;
		}
		const session = extractExplicitSessionName(input.toolArgs);
		if (session !== undefined && session !== "") {
			return undefined;
		}
		return validationFailure(
			input,
			"qa.attached requires an active attached session. Run electron.launch or connect to an Electron debug port first, or configure a native shared session.",
		);
	}

	needsVersionCheck(call: NativeBrowserCall): boolean {
		if (
			call.compiledElectron &&
			["cleanup", "list", "status"].includes(call.compiledElectron.action)
		) {
			return false;
		}
		if (call.readConfirmation?.capabilities?.readRequiresConfirmation === true) {
			return false;
		}
		if (!needsManagedSession(parseArgvDescriptor(call.toolArgs), call.resolvedInput.toolStdin)) {
			return false;
		}
		return (
			!isPlainTextInspectionArgs(call.toolArgs) &&
			!isCloseCommand(extractUpstreamCommandTokens(call.toolArgs)[0]) &&
			call.signal?.aborted !== true
		);
	}

	coordinate(call: NativeBrowserCall): CoordinatedBrowserCall {
		const explicitSessionName = extractExplicitSessionName(call.toolArgs);
		const namespace =
			explicitSessionName !== undefined && explicitSessionName !== ""
				? resolveAgentBrowserNamespace(
						call.toolArgs,
						getAgentBrowserProcessEnvironment().AGENT_BROWSER_NAMESPACE,
					)
				: undefined;
		const serializeBrowserCommand = shouldSerializeBrowserCommand(
			this.runtime.managed.owned,
			this.runtime.electron.ownedRecords,
			{
				namespace,
				explicitSessionName,
				managedSessionName: this.runtime.managed.name,
			},
		);
		const callerOwnedSessionQueueKey =
			!serializeBrowserCommand && explicitSessionName !== undefined && explicitSessionName !== ""
				? (getSessionContextKey(explicitSessionName, namespace) ?? explicitSessionName)
				: undefined;
		return {
			...call,
			explicitSessionName,
			callerOwnedSessionNamespace: namespace,
			serializeBrowserCommand,
			callerOwnedSessionQueueKey,
			closesAllSessions: commandClosesAllSessions(call.toolArgs, call.resolvedInput.toolStdin),
		};
	}

	async executeNative(
		prepared: PreparedBrowserCall,
		input: ResolvedAgentBrowserValidInput,
		defaults?: NativeLaunchDefaultsRunner,
	): Promise<AgentBrowserToolResult> {
		const admitted = this.prepareNative(prepared, input, defaults);
		if ("failure" in admitted) {
			return admitted.failure;
		}
		const { call } = admitted;
		if (this.needsVersionCheck(call)) {
			const failure = await validateUpstreamVersion(
				this.runtime.validatedUpstreamPathKeys,
				call.browserCwd,
				call.signal,
			);
			if (failure) {
				return applyAgentBrowserOutputPath({
					cwd: call.operationCwd,
					outputPath: call.outputPath,
					result: failure,
				});
			}
		}
		const runHost = () => runCoordinatedElectronHostInput(this.runtime, call);
		const hostResult = await (shouldSerializeElectronHostInput(call.compiledElectron)
			? this.runtime.managedSessionExecutionQueue.run(runHost, call.signal)
			: runHost());
		if (hostResult) {
			return call.compiledElectron?.action === "cleanup"
				? hostResult
				: applyUnserializedOutputPath(this.runtime, call, hostResult);
		}
		return runWithinSessionQueue(this.runtime, this.coordinate(call));
	}

	private async validateArgs(
		call: AdmittedBrowserCall,
	): Promise<DynamicArgvValidationResult | undefined> {
		const input = call.admittedInput;
		let validation: DynamicArgvValidationResult | undefined;
		if (
			input.toolArgs.length > 0 &&
			!isPlainTextInspectionArgs(input.toolArgs) &&
			call.signal?.aborted !== true
		) {
			const environment = getAgentBrowserProcessEnvironment();
			validation = await (
				await import("./dynamic-argv-validation.js")
			).validateRuntimeArgv(this.runtime, {
				args: [...input.toolArgs],
				cwd: call.operationCwd,
				path: environment.PATH ?? environment.Path ?? "",
				signal: call.signal,
				stdin: input.toolStdin,
			});
		}
		return validation;
	}

	async run(): Promise<AgentBrowserToolResult> {
		const admitted = this.admit();
		if ("failure" in admitted) {
			return admitted.failure;
		}
		const { call } = admitted;
		const execute = async () => {
			const input = call.admittedInput;
			const validation = await this.validateArgs(call);
			if (validation?.rejection !== undefined) {
				return applyAgentBrowserOutputPath({
					cwd: call.operationCwd,
					outputPath: call.outputPath,
					result: validation.rejection,
				});
			}
			let result = await this.executeAdmitted(call);
			if (validation?.warning !== undefined) {
				result = (await import("./dynamic-argv-validation.js")).applyDynamicArgvValidationWarning(
					result,
					validation,
					call.params.args?.includes("--json"),
				);
			}
			if (input.inputNormalizations !== undefined && input.inputNormalizations.length > 0) {
				result = {
					...result,
					details: {
						...(typeof result.details === "object" && result.details !== null
							? result.details
							: {}),
						inputNormalizations: input.inputNormalizations,
					},
				};
			}
			return result;
		};
		return call.managedAtAdmission
			? this.runtime.managedSessionExecutionQueue.run(execute, call.signal)
			: execute();
	}
}

export function executeBrowserInvocation(
	runtime: BrowserRuntime,
	invocation: BrowserInvocation,
): Promise<AgentBrowserToolResult> {
	return new BrowserAdmission(runtime, invocation).run();
}
