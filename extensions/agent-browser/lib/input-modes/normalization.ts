import { isRecord } from "../parsing.js";

export type AgentBrowserInputNormalization = {
	code: "role-value-as-name" | "text-as-target";
	path: "semanticAction" | `job.steps[${number}]`;
};

function normalizeAction(input: unknown, path: AgentBrowserInputNormalization["path"]): { input: unknown; normalizations: AgentBrowserInputNormalization[] } {
	if (!isRecord(input)) return { input, normalizations: [] };
	const normalized = { ...input };
	const normalizations: AgentBrowserInputNormalization[] = [];
	if (
		normalized.locator === "role"
		&& typeof normalized.role === "string"
		&& typeof normalized.value === "string"
		&& normalized.value !== normalized.role
		&& normalized.name === undefined
	) {
		normalized.name = normalized.value;
		normalized.value = normalized.role;
		normalizations.push({ code: "role-value-as-name", path });
	}
	if (
		(normalized.action === "click" || normalized.action === "check")
		&& typeof normalized.text === "string"
		&& normalized.value === undefined
	) {
		if (normalized.locator === "role" && typeof normalized.role === "string" && normalized.name === undefined) {
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

export function normalizeAgentBrowserStructuredInputs(params: { job?: unknown; semanticAction?: unknown }): {
	job?: unknown;
	normalizations: AgentBrowserInputNormalization[];
	semanticAction?: unknown;
} {
	const semantic = normalizeAction(params.semanticAction, "semanticAction");
	const normalizations = [...semantic.normalizations];
	let job = params.job;
	if (isRecord(job) && Array.isArray(job.steps)) {
		const steps = job.steps.map((step, index) => {
			const normalized = normalizeAction(step, `job.steps[${index}]`);
			normalizations.push(...normalized.normalizations);
			return normalized.input;
		});
		job = { ...job, steps };
	}
	return { job, normalizations, semanticAction: semantic.input };
}
