import type {
	AgentBrowserFailureCategory,
	ProjectedAgentBrowserObservation,
	AgentBrowserResultCategory,
	AgentBrowserSuccessCategory,
} from "../results/contracts.js";

export interface AgentBrowserScriptBrowserParams {
	readonly args: readonly string[];
	readonly stdin?: string;
	readonly timeoutMs?: number;
}
export interface AgentBrowserScriptBrowserEnvelope extends ProjectedAgentBrowserObservation {
	readonly failureCategory?: AgentBrowserFailureCategory;
	readonly successCategory?: AgentBrowserSuccessCategory;
	readonly summary?: string;
}

export interface AgentBrowserScriptStepSummary {
	readonly failureCategory?: AgentBrowserFailureCategory;
	readonly index: number;
	readonly ok: boolean;
	readonly resultCategory: AgentBrowserResultCategory;
	readonly successCategory?: AgentBrowserSuccessCategory;
	readonly summary: string;
}

export interface AgentBrowserScriptRunResult {
	readonly aborted?: boolean;
	readonly failures?: readonly AgentBrowserScriptBrowserEnvelope[];
	readonly callCount: number;
	readonly data?: unknown;
	readonly emitCount: number;
	readonly error?: string;
	readonly failureCategory?: AgentBrowserFailureCategory;
	readonly ok: boolean;
	readonly rejectedCallCount: number;
	readonly steps: readonly AgentBrowserScriptStepSummary[];
	readonly timedOut?: boolean;
}

export interface RunAgentBrowserScriptOptions {
	readonly emitImage?: (image: unknown) => void | Promise<void>;
	readonly code: string;
	readonly dispatch: (
		params: AgentBrowserScriptBrowserParams,
		signal: AbortSignal,
	) => Promise<ProjectedAgentBrowserObservation>;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}
