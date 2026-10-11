import type { ExecutionPlan as AgentBrowserExecutionPlan } from "../../runtime-contracts.js";
import { buildAgentBrowserResultCategoryDetails } from "../../results/categories.js";
import { buildSessionDetailFields } from "./session-state.js";
import type { BrowserRunStatePatch, PrepareBrowserRunResult } from "./types.js";

export type PreparationStatePatch = Pick<
	BrowserRunStatePatch,
	"artifactManifest" | "freshSessionOrdinal"
>;

export function preparationFailure(request: {
	readonly message: string;
	readonly details: Readonly<Record<string, unknown>>;
	readonly statePatch?: PreparationStatePatch;
}): PrepareBrowserRunResult {
	return {
		kind: "early-result",
		statePatch: request.statePatch,
		result: {
			content: [{ type: "text", text: request.message }],
			details: { ...request.details },
			isError: true,
		},
	};
}

export function preparationSessionDetails(
	restoreDisabled: boolean,
	plan: AgentBrowserExecutionPlan,
): ReturnType<typeof buildSessionDetailFields> {
	return buildSessionDetailFields(
		plan.sessionName,
		plan.usedImplicitSession,
		plan.namespace,
		restoreDisabled,
	);
}

export function categorizedGuardFailure(
	restoreDisabled: boolean,
	request: {
		readonly plan: AgentBrowserExecutionPlan;
		readonly redactedArgs: readonly string[];
		readonly effectiveArgs: readonly string[];
		readonly sessionMode: "auto" | "fresh";
		readonly statePatch: PreparationStatePatch;
	},
	failure: {
		readonly message: string;
		readonly failureCategory?: Parameters<
			typeof buildAgentBrowserResultCategoryDetails
		>[0]["failureCategory"];
		readonly validationError?: string;
		readonly details?: Readonly<Record<string, unknown>>;
		readonly omitCommand?: boolean;
	},
): PrepareBrowserRunResult {
	return preparationFailure({
		message: failure.message,
		statePatch: request.statePatch,
		details: {
			args: request.redactedArgs,
			...(failure.omitCommand === true ? {} : { command: request.plan.commandInfo.command }),
			compatibilityWorkaround: request.plan.compatibilityWorkaround,
			effectiveArgs: request.effectiveArgs,
			sessionMode: request.sessionMode,
			...buildAgentBrowserResultCategoryDetails({
				args: request.effectiveArgs,
				command: request.plan.commandInfo.command,
				errorText: failure.message,
				failureCategory: failure.failureCategory,
				succeeded: false,
				validationError: failure.validationError,
			}),
			...(failure.validationError !== undefined
				? { validationError: failure.validationError }
				: {}),
			...preparationSessionDetails(restoreDisabled, request.plan),
			...failure.details,
		},
	});
}
