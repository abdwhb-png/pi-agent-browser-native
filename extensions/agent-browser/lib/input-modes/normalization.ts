import { isRecord } from "../parsing.js";

export type AgentBrowserInputNormalization = {
	readonly code: "role-value-as-name" | "text-as-target";
	readonly path: "semanticAction";
};

function hasRoleValueName(normalized: Readonly<Record<string, unknown>>): boolean {
	return (
		normalized.locator === "role" &&
		typeof normalized.role === "string" &&
		typeof normalized.value === "string" &&
		normalized.value !== normalized.role &&
		normalized.name === undefined
	);
}

function hasTextTarget(normalized: Readonly<Record<string, unknown>>): boolean {
	return (
		(normalized.action === "click" || normalized.action === "check") &&
		typeof normalized.text === "string" &&
		normalized.value === undefined
	);
}

function normalizeAction(
	input: unknown,
	path: AgentBrowserInputNormalization["path"],
): { input: unknown; normalizations: AgentBrowserInputNormalization[] } {
	if (!isRecord(input)) {
		return { input, normalizations: [] };
	}
	const normalized = { ...input };
	const normalizations: AgentBrowserInputNormalization[] = [];
	if (hasRoleValueName(normalized)) {
		normalized.name = normalized.value;
		normalized.value = normalized.role;
		normalizations.push({ code: "role-value-as-name", path });
	}
	if (hasTextTarget(normalized)) {
		if (
			normalized.locator === "role" &&
			typeof normalized.role === "string" &&
			normalized.name === undefined
		) {
			normalized.name = normalized.text;
		} else {
			normalized.locator ??= "text";
			normalized.value = normalized.text;
		}
		delete normalized.text;
		normalizations.push({ code: "text-as-target", path });
	}
	return { input: normalized, normalizations };
}

export function normalizeAgentBrowserStructuredInputs(params: {
	readonly semanticAction?: unknown;
}): {
	readonly normalizations: readonly AgentBrowserInputNormalization[];
	readonly semanticAction: unknown;
} {
	const semantic = normalizeAction(params.semanticAction, "semanticAction");
	return { normalizations: semantic.normalizations, semanticAction: semantic.input };
}
