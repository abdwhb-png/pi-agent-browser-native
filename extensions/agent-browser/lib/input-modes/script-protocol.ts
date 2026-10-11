import { isRecord } from "../parsing.js";
import type {
	AgentBrowserFailureCategory,
	AgentBrowserSuccessCategory,
	ProjectedAgentBrowserObservation,
} from "../results/contracts.js";
import type { AgentBrowserScriptBrowserEnvelope } from "./script-types.js";

export const SCRIPT_IPC_MESSAGE_MAX_BYTES = 1 * 1_024 * 1_024;
export const SCRIPT_IPC_CUMULATIVE_MAX_BYTES = 8 * 1_024 * 1_024;
export const SCRIPT_FINAL_OUTPUT_MAX_BYTES = 64 * 1_024;
export const SCRIPT_MAX_CALLS = 25;

export type ScriptChildMessage =
	| { readonly type: "ready" }
	| { readonly id: number; readonly params: unknown; readonly type: "call" }
	| { readonly type: "emit" | "image"; readonly value?: unknown }
	| {
			readonly error?: { readonly message?: unknown; readonly name?: unknown };
			readonly hasValue?: boolean;
			readonly type: "complete";
			readonly value?: unknown;
	  };

export type ScriptParentMessage =
	| { readonly code: string; readonly type: "start" }
	| {
			readonly envelope: AgentBrowserScriptBrowserEnvelope;
			readonly id: number;
			readonly type: "response";
	  };

export function isScriptChildMessage(value: unknown): value is ScriptChildMessage {
	if (!isRecord(value)) {
		return false;
	}
	switch (value.type) {
		case "ready":
		case "emit":
		case "image":
			return true;
		case "call":
			return typeof value.id === "number" && Number.isSafeInteger(value.id) && value.id > 0;
		case "complete":
			return (
				(value.error === undefined || isRecord(value.error)) &&
				(value.hasValue === undefined || typeof value.hasValue === "boolean")
			);
		default:
			return false;
	}
}

export function describeScriptError(error: {
	readonly message?: unknown;
	readonly name?: unknown;
}): string {
	const name =
		typeof error.name === "string" && error.name.length > 0 ? error.name.slice(0, 80) : "Error";
	const message =
		typeof error.message === "string" && error.message.length > 0
			? error.message.replace(/[\r\n]+/g, " ").slice(0, 400)
			: "Script execution failed.";
	return `${name}: ${message}`;
}

export function rejectedCallEnvelope(error: string): AgentBrowserScriptBrowserEnvelope {
	return {
		data: null,
		error,
		failureCategory: "validation-error",
		success: false,
		resultCategory: "failure",
		summary: error,
	};
}

function failureCategory(value: unknown): AgentBrowserFailureCategory | undefined {
	const categories: readonly AgentBrowserFailureCategory[] = [
		"aborted",
		"artifact-missing",
		"cleanup-failed",
		"confirmation-required",
		"download-not-verified",
		"missing-binary",
		"parse-failure",
		"policy-blocked",
		"qa-failure",
		"selector-not-found",
		"selector-unsupported",
		"script-error",
		"stale-ref",
		"tab-drift",
		"tab-gone",
		"timeout",
		"upstream-error",
		"validation-error",
	];
	return categories.find((category) => category === value);
}
function successCategory(value: unknown): AgentBrowserSuccessCategory | undefined {
	const categories: readonly AgentBrowserSuccessCategory[] = [
		"artifact-pending",
		"artifact-saved",
		"artifact-unverified",
		"completed",
		"inspection",
	];
	return categories.find((category) => category === value);
}
export function normalizeBrowserEnvelope(
	value: ProjectedAgentBrowserObservation,
): AgentBrowserScriptBrowserEnvelope {
	if (
		!isRecord(value) ||
		typeof value.success !== "boolean" ||
		!["success", "failure"].includes(value.resultCategory)
	) {
		return rejectedCallEnvelope("The browser executor returned an invalid code observation.");
	}
	return {
		...value,
		failureCategory: failureCategory(value.failureCategory),
		successCategory: successCategory(value.successCategory),
		summary: typeof value.summary === "string" ? value.summary : undefined,
	};
}
