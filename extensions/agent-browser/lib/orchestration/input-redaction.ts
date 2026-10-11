import { redactInvocationArgs, redactSensitiveText } from "../runtime.js";
import {
	redactNetworkSourceLookupArgs,
	redactNetworkSourceLookupUrl,
} from "../input-modes/lookups.js";
import type {
	CompiledAgentBrowserElectron,
	CompiledAgentBrowserJob,
	CompiledAgentBrowserNetworkSourceLookup,
	CompiledAgentBrowserSourceLookup,
} from "../input-modes/types.js";

export function redactCompiledElectron(
	compiled: CompiledAgentBrowserElectron | undefined,
): CompiledAgentBrowserElectron | undefined {
	if (compiled === undefined) {
		return undefined;
	}
	if (compiled.action === "list") {
		return {
			...compiled,
			query:
				compiled.query !== undefined && compiled.query.length > 0
					? redactSensitiveText(compiled.query)
					: undefined,
		};
	}
	if (compiled.action === "launch") {
		return {
			...compiled,
			appArgs:
				compiled.appArgs === undefined ? undefined : redactInvocationArgs([...compiled.appArgs]),
		};
	}
	return { ...compiled };
}

export function redactCompiledJob(
	compiled: CompiledAgentBrowserJob | undefined,
): CompiledAgentBrowserJob | undefined {
	if (compiled === undefined) {
		return undefined;
	}
	const steps = compiled.steps.map((step) => ({
		...step,
		args: redactInvocationArgs([...step.args]),
	}));
	return { ...compiled, stdin: JSON.stringify(steps.map((step) => step.args)), steps };
}

export function redactCompiledSourceLookup(
	compiled: CompiledAgentBrowserSourceLookup | undefined,
): CompiledAgentBrowserSourceLookup | undefined {
	if (compiled === undefined) {
		return undefined;
	}
	const steps = compiled.steps.map((step) => ({
		...step,
		args: redactInvocationArgs([...step.args]),
	}));
	return { ...compiled, stdin: JSON.stringify(steps.map((step) => step.args)), steps };
}

export function redactCompiledNetworkSourceLookup(
	compiled: CompiledAgentBrowserNetworkSourceLookup | undefined,
): CompiledAgentBrowserNetworkSourceLookup | undefined {
	if (compiled === undefined) {
		return undefined;
	}
	const steps = compiled.steps.map((step) => ({
		...step,
		args: redactNetworkSourceLookupArgs([...step.args]),
	}));
	return {
		...compiled,
		args: redactNetworkSourceLookupArgs([...compiled.args]),
		query: {
			...compiled.query,
			filter: redactNetworkSourceLookupUrl(compiled.query.filter),
			url: redactNetworkSourceLookupUrl(compiled.query.url),
		},
		stdin: JSON.stringify(steps.map((step) => step.args)),
		steps,
	};
}
