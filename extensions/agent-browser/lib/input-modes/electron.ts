import { isRecord } from "../parsing.js";
import { isStringArray } from "./shared.js";
import {
	AGENT_BROWSER_ELECTRON_ACTIONS,
	AGENT_BROWSER_ELECTRON_HANDOFFS,
	AGENT_BROWSER_ELECTRON_LIST_FIELDS,
	AGENT_BROWSER_ELECTRON_PROBE_FIELDS,
	AGENT_BROWSER_ELECTRON_RESERVED_APP_ARGS,
	AGENT_BROWSER_ELECTRON_TARGET_TYPES,
	type CompiledAgentBrowserElectron,
} from "./types.js";

type Input = Readonly<Record<string, unknown>>;
type Compilation = { compiled?: CompiledAgentBrowserElectron; error?: string };

function optionalString(input: Input, fieldName: string): { value?: string; error?: string } {
	const value = input[fieldName];
	if (value === undefined) {
		return {};
	}
	if (typeof value !== "string" || value.trim().length === 0) {
		return { error: `electron.${fieldName} must be a non-empty string when provided.` };
	}
	return { value: value.trim() };
}

function optionalInteger(
	input: Input,
	fieldName: "maxResults" | "timeoutMs",
): { value?: number; error?: string } {
	const value = input[fieldName];
	if (value === undefined) {
		return {};
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		return { error: `electron.${fieldName} must be a positive integer when provided.` };
	}
	return { value };
}

function stringArray(value: unknown): string[] | undefined {
	if (!isStringArray(value)) {
		return undefined;
	}
	return value.map((item) => item.trim());
}

function arrayError(input: Input, fieldName: "allow" | "appArgs" | "deny"): string | undefined {
	const value = input[fieldName];
	if (value === undefined) {
		return undefined;
	}
	const parsed = stringArray(value);
	return parsed === undefined || parsed.some((item) => item.length === 0)
		? `electron.${fieldName} must be an array of non-empty strings when provided.`
		: undefined;
}

function enumError(input: Input, fieldName: string, values: readonly string[]): string | undefined {
	const value = input[fieldName];
	if (value === undefined) {
		return undefined;
	}
	return typeof value !== "string" || !values.includes(value)
		? `electron.${fieldName} must be one of: ${values.join(", ")}.`
		: undefined;
}

function commonError(input: Input): string | undefined {
	for (const field of ["query", "appPath", "appName", "bundleId", "executablePath", "launchId"]) {
		const error = optionalString(input, field).error;
		if (error !== undefined) {
			return error;
		}
	}
	for (const field of ["appArgs", "allow", "deny"] as const) {
		const error = arrayError(input, field);
		if (error !== undefined) {
			return error;
		}
	}
	return (
		enumError(input, "handoff", AGENT_BROWSER_ELECTRON_HANDOFFS) ??
		enumError(input, "targetType", AGENT_BROWSER_ELECTRON_TARGET_TYPES) ??
		numericError(input)
	);
}

function numericError(input: Input): string | undefined {
	for (const field of ["maxResults", "timeoutMs"] as const) {
		const error = optionalInteger(input, field).error;
		if (error !== undefined) {
			return error;
		}
	}
	return input.all !== undefined && input.all !== true
		? "electron.all must be true when provided."
		: undefined;
}

function unsupportedField(input: Input, allowed: readonly string[]): string | undefined {
	return Object.keys(input).find((field) => !allowed.includes(field));
}

function allowedFieldError(
	input: Input,
	action: string,
	allowed: readonly string[],
): string | undefined {
	const field = unsupportedField(input, allowed);
	return field === undefined ? undefined : `electron.${action} does not support electron.${field}.`;
}

function compileLaunch(input: Input): Compilation {
	const fieldError = allowedFieldError(input, "launch", [
		"action",
		"allow",
		"appArgs",
		"appName",
		"appPath",
		"bundleId",
		"deny",
		"executablePath",
		"handoff",
		"targetType",
		"timeoutMs",
	]);
	if (fieldError !== undefined) {
		return { error: fieldError };
	}
	const appArgs = stringArray(input.appArgs);
	const reservedArg = appArgs?.find(
		(arg) =>
			arg === "--" ||
			AGENT_BROWSER_ELECTRON_RESERVED_APP_ARGS.some(
				(reserved) => arg === reserved || arg.startsWith(`${reserved}=`),
			),
	);
	if (reservedArg !== undefined) {
		return { error: `electron.appArgs must not include wrapper-owned launch flag ${reservedArg}.` };
	}
	const providedTargets = ["appPath", "appName", "bundleId", "executablePath"].filter(
		(field) => input[field] !== undefined,
	);
	if (providedTargets.length !== 1) {
		return {
			error:
				"electron.launch requires exactly one of appPath, appName, bundleId, or executablePath.",
		};
	}
	return {
		compiled: {
			action: "launch",
			allow: stringArray(input.allow),
			appArgs,
			deny: stringArray(input.deny),
			appName: optionalString(input, "appName").value,
			appPath: optionalString(input, "appPath").value,
			bundleId: optionalString(input, "bundleId").value,
			executablePath: optionalString(input, "executablePath").value,
			handoff:
				AGENT_BROWSER_ELECTRON_HANDOFFS.find((value) => value === input.handoff) ?? "snapshot",
			targetType:
				AGENT_BROWSER_ELECTRON_TARGET_TYPES.find((value) => value === input.targetType) ?? "page",
			timeoutMs: optionalInteger(input, "timeoutMs").value,
		},
	};
}

function compileList(input: Input): Compilation {
	const field = unsupportedField(input, AGENT_BROWSER_ELECTRON_LIST_FIELDS);
	if (field !== undefined) {
		return { error: `electron.list only supports query and maxResults; remove electron.${field}.` };
	}
	return {
		compiled: {
			action: "list",
			maxResults: optionalInteger(input, "maxResults").value,
			query: optionalString(input, "query").value,
		},
	};
}

function compileProbe(input: Input): Compilation {
	const field = unsupportedField(input, AGENT_BROWSER_ELECTRON_PROBE_FIELDS);
	if (field !== undefined) {
		return {
			error: `electron.probe only supports action, launchId, and timeoutMs; remove electron.${field}.`,
		};
	}
	const launchId = optionalString(input, "launchId").value;
	const timeoutMs = optionalInteger(input, "timeoutMs").value;
	return {
		compiled: {
			action: "probe",
			...(launchId !== undefined ? { launchId } : {}),
			...(timeoutMs !== undefined ? { timeoutMs } : {}),
		},
	};
}

function compileStatusOrCleanup(input: Input, action: "status" | "cleanup"): Compilation {
	const error = allowedFieldError(input, action, ["action", "all", "launchId", "timeoutMs"]);
	if (error !== undefined) {
		return { error };
	}
	if (input.all === true && input.launchId !== undefined) {
		return { error: `electron.${action} accepts launchId or all, not both.` };
	}
	return {
		compiled: {
			action,
			all: input.all === true ? true : undefined,
			launchId: optionalString(input, "launchId").value,
			timeoutMs: optionalInteger(input, "timeoutMs").value,
		},
	};
}

export function compileAgentBrowserElectron(input: unknown): Compilation {
	if (!isRecord(input)) {
		return { error: "electron must be an object." };
	}
	const action = AGENT_BROWSER_ELECTRON_ACTIONS.find((value) => value === input.action);
	if (action === undefined) {
		return {
			error: `electron.action must be one of: ${AGENT_BROWSER_ELECTRON_ACTIONS.join(", ")}.`,
		};
	}
	const error = commonError(input);
	if (error !== undefined) {
		return { error };
	}
	switch (action) {
		case "launch":
			return compileLaunch(input);
		case "list":
			return compileList(input);
		case "probe":
			return compileProbe(input);
		case "status":
		case "cleanup":
			return compileStatusOrCleanup(input, action);
	}
}
