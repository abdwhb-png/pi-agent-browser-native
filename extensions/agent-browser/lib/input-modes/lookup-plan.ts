import { isRecord } from "../parsing.js";
import { validateLookupMaxWorkspaceFiles } from "./shared.js";
import type {
	CompiledAgentBrowserNetworkSourceLookup,
	CompiledAgentBrowserSourceLookup,
	CompiledAgentBrowserSourceLookupStep,
} from "./types.js";

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function validateString(value: unknown, field: string, allowEmpty = false): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === "string" && (value.trim().length > 0 || (allowEmpty && value === ""))) {
		return undefined;
	}
	if (allowEmpty) {
		return `${field} must be a non-empty string or the empty default namespace when provided.`;
	}
	return `${field} must be a non-empty string when provided.`;
}

function validateSourceQuery(input: Readonly<Record<string, unknown>>): string | undefined {
	for (const field of ["selector", "reactFiberId", "componentName"]) {
		const error = validateString(input[field], `sourceLookup.${field}`);
		if (error !== undefined) {
			return error;
		}
	}
	if (
		input.selector === undefined &&
		input.reactFiberId === undefined &&
		input.componentName === undefined
	) {
		return "sourceLookup requires selector, reactFiberId, or componentName.";
	}
	if (input.includeDomHints !== undefined && typeof input.includeDomHints !== "boolean") {
		return "sourceLookup.includeDomHints must be a boolean when provided.";
	}
	return undefined;
}

function planSourceSteps(
	query: CompiledAgentBrowserSourceLookup["query"],
): CompiledAgentBrowserSourceLookupStep[] {
	const steps: CompiledAgentBrowserSourceLookupStep[] = [];
	if (query.selector !== undefined) {
		steps.push({ action: "dom", args: ["is", "visible", query.selector] });
		if (query.includeDomHints) {
			steps.push({ action: "dom", args: ["get", "html", query.selector] });
		}
	}
	if (query.reactFiberId !== undefined) {
		steps.push({ action: "react", args: ["react", "inspect", query.reactFiberId] });
	}
	if (query.componentName !== undefined) {
		steps.push({ action: "react", args: ["react", "tree"] });
	}
	return steps;
}

export function compileAgentBrowserSourceLookup(input: unknown): {
	compiled?: CompiledAgentBrowserSourceLookup;
	error?: string;
} {
	if (!isRecord(input)) {
		return { error: "sourceLookup must be an object." };
	}
	const error = validateSourceQuery(input);
	if (error !== undefined) {
		return { error };
	}
	const maxFiles = validateLookupMaxWorkspaceFiles(
		input.maxWorkspaceFiles,
		"sourceLookup.maxWorkspaceFiles",
	);
	if (maxFiles.error !== undefined) {
		return { error: maxFiles.error };
	}
	const query: CompiledAgentBrowserSourceLookup["query"] = {
		componentName: optionalString(input.componentName),
		includeDomHints: input.includeDomHints !== false,
		maxWorkspaceFiles: maxFiles.value,
		reactFiberId: optionalString(input.reactFiberId),
		selector: optionalString(input.selector),
	};
	const steps = planSourceSteps(query);
	return {
		compiled: {
			args: ["batch"],
			query,
			stdin: JSON.stringify(steps.map((step) => step.args)),
			steps,
		},
	};
}

function validateNetworkQuery(input: Readonly<Record<string, unknown>>): string | undefined {
	for (const field of ["filter", "requestId", "namespace", "session", "url"]) {
		const error = validateString(
			input[field],
			`networkSourceLookup.${field}`,
			field === "namespace",
		);
		if (error !== undefined) {
			return error;
		}
	}
	if (input.filter === undefined && input.requestId === undefined && input.url === undefined) {
		return "networkSourceLookup requires requestId, filter, or url.";
	}
	return undefined;
}

function planNetworkSteps(
	query: CompiledAgentBrowserNetworkSourceLookup["query"],
): CompiledAgentBrowserNetworkSourceLookup["steps"] {
	const steps: Array<{ action: "network"; args: string[] }> = [];
	if (query.requestId !== undefined) {
		steps.push({ action: "network", args: ["network", "request", query.requestId] });
	}
	const effectiveFilter = query.filter ?? query.url;
	if (effectiveFilter !== undefined && effectiveFilter.length > 0) {
		steps.push({ action: "network", args: ["network", "requests", "--filter", effectiveFilter] });
	}
	return steps;
}

export function compileAgentBrowserNetworkSourceLookup(input: unknown): {
	compiled?: CompiledAgentBrowserNetworkSourceLookup;
	error?: string;
} {
	if (!isRecord(input)) {
		return { error: "networkSourceLookup must be an object." };
	}
	const error = validateNetworkQuery(input);
	if (error !== undefined) {
		return { error };
	}
	const maxFiles = validateLookupMaxWorkspaceFiles(
		input.maxWorkspaceFiles,
		"networkSourceLookup.maxWorkspaceFiles",
	);
	if (maxFiles.error !== undefined) {
		return { error: maxFiles.error };
	}
	const query: CompiledAgentBrowserNetworkSourceLookup["query"] = {
		filter: optionalString(input.filter),
		maxWorkspaceFiles: maxFiles.value,
		namespace: optionalString(input.namespace),
		requestId: optionalString(input.requestId),
		session: optionalString(input.session),
		url: optionalString(input.url),
	};
	const steps = planNetworkSteps(query);
	const args = [
		...(query.namespace !== undefined ? ["--namespace", query.namespace] : []),
		...(query.session !== undefined ? ["--session", query.session] : []),
		"batch",
	];
	return {
		compiled: { args, query, stdin: JSON.stringify(steps.map((step) => step.args)), steps },
	};
}
