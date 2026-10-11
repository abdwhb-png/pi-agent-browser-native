import type { AgentBrowserInputNormalization } from "../input-modes/normalization.js";
import type {
	CompiledAgentBrowserElectron,
	CompiledAgentBrowserJob,
	CompiledAgentBrowserNetworkSourceLookup,
	CompiledAgentBrowserQaPreset,
	CompiledAgentBrowserSemanticAction,
	CompiledAgentBrowserSourceLookup,
} from "../input-modes/types.js";

export interface AgentBrowserExecuteParams {
	readonly args?: readonly string[];
	readonly electron?: unknown;
	readonly networkSourceLookup?: unknown;
	readonly outputPath?: string;
	readonly qa?: unknown;
	readonly semanticAction?: unknown;
	readonly sessionMode?: "auto" | "fresh";
	readonly sourceLookup?: unknown;
	readonly stdin?: string;
	readonly timeoutMs?: number;
}

export type ResolvedAgentBrowserInputKind =
	| "args"
	| "electron"
	| "networkSourceLookup"
	| "qa"
	| "semanticAction"
	| "sourceLookup";

export interface ResolvedAgentBrowserInputModeFields {
	readonly compiledElectron?: CompiledAgentBrowserElectron;
	readonly compiledGeneratedBatch?:
		| CompiledAgentBrowserJob
		| CompiledAgentBrowserNetworkSourceLookup
		| CompiledAgentBrowserSourceLookup;
	readonly compiledJob?: CompiledAgentBrowserJob;
	readonly compiledNetworkSourceLookup?: CompiledAgentBrowserNetworkSourceLookup;
	readonly compiledQaPreset?: CompiledAgentBrowserQaPreset;
	readonly compiledSemanticAction?: CompiledAgentBrowserSemanticAction;
	readonly compiledSourceLookup?: CompiledAgentBrowserSourceLookup;
	readonly redactedCompiledElectron?: CompiledAgentBrowserElectron;
	readonly redactedCompiledJob?: CompiledAgentBrowserJob;
	readonly redactedCompiledNetworkSourceLookup?: CompiledAgentBrowserNetworkSourceLookup;
	readonly redactedCompiledQaPreset?: CompiledAgentBrowserQaPreset;
	readonly redactedCompiledSemanticAction?: CompiledAgentBrowserSemanticAction;
	readonly redactedCompiledSourceLookup?: CompiledAgentBrowserSourceLookup;
}

export interface ResolvedAgentBrowserInputBase {
	readonly inputNormalizations?: readonly AgentBrowserInputNormalization[];
	readonly redactedArgs: readonly string[];
	readonly toolArgs: readonly string[];
	readonly toolStdin?: string;
}

interface ResolvedAgentBrowserValidInputBase extends ResolvedAgentBrowserInputBase {
	readonly nativeConfirmActions?: string;
	readonly chromeStartupArgs?: string;
	readonly configuredChromeLaunch?: boolean;
	readonly status: "valid";
	readonly validationError?: undefined;
}

export interface ResolvedAgentBrowserInvalidInput
	extends ResolvedAgentBrowserInputBase, ResolvedAgentBrowserInputModeFields {
	readonly attemptedKind?: ResolvedAgentBrowserInputKind;
	readonly kind: "invalid";
	readonly status: "invalid";
	readonly validationError: string;
}

export type ResolvedAgentBrowserValidInput =
	| (ResolvedAgentBrowserValidInputBase & { readonly kind: "args" })
	| (ResolvedAgentBrowserValidInputBase & {
			readonly kind: "electron";
			readonly compiledElectron: CompiledAgentBrowserElectron;
			readonly redactedCompiledElectron: CompiledAgentBrowserElectron;
	  })
	| (ResolvedAgentBrowserValidInputBase & {
			readonly kind: "networkSourceLookup";
			readonly compiledGeneratedBatch: CompiledAgentBrowserNetworkSourceLookup;
			readonly compiledNetworkSourceLookup: CompiledAgentBrowserNetworkSourceLookup;
			readonly redactedCompiledNetworkSourceLookup: CompiledAgentBrowserNetworkSourceLookup;
	  })
	| (ResolvedAgentBrowserValidInputBase & {
			readonly kind: "qa";
			readonly compiledGeneratedBatch: CompiledAgentBrowserQaPreset;
			readonly compiledJob: CompiledAgentBrowserQaPreset;
			readonly compiledQaPreset: CompiledAgentBrowserQaPreset;
			readonly redactedCompiledJob: CompiledAgentBrowserJob;
			readonly redactedCompiledQaPreset: CompiledAgentBrowserQaPreset;
	  })
	| (ResolvedAgentBrowserValidInputBase & {
			readonly kind: "semanticAction";
			readonly compiledSemanticAction: CompiledAgentBrowserSemanticAction;
			readonly redactedCompiledSemanticAction: CompiledAgentBrowserSemanticAction;
	  })
	| (ResolvedAgentBrowserValidInputBase & {
			readonly kind: "sourceLookup";
			readonly compiledGeneratedBatch: CompiledAgentBrowserSourceLookup;
			readonly compiledSourceLookup: CompiledAgentBrowserSourceLookup;
			readonly redactedCompiledSourceLookup: CompiledAgentBrowserSourceLookup;
	  });

export type ResolvedAgentBrowserInput =
	| ResolvedAgentBrowserInvalidInput
	| ResolvedAgentBrowserValidInput;
export type BatchPreflightValidator = (
	args: readonly string[],
	stdin: string | undefined,
) => string | undefined;
