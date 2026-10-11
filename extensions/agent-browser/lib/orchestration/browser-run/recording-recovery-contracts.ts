import type { ToolPresentationObservation } from "../../results/presentation/observation-contracts.js";
import type { ProcessRunResult } from "../../process.js";
import type {
	AgentBrowserEnvelope,
	SessionArtifactManifest,
	ToolPresentation,
} from "../../results/contracts.js";
import type {
	ActiveRecordingReservation,
	RecordingRecovery,
} from "../../results/evidence-contracts.js";

export interface RecordingRecoveryOptions {
	readonly modelVisible?: boolean;
	readonly artifactManifest?: SessionArtifactManifest;
	readonly artifactRunStartedAtMs: number;
	readonly commandTokens: readonly string[];
	readonly cwd: string;
	readonly envelope?: AgentBrowserEnvelope;
	readonly namespace?: string;
	readonly parseError?: string;
	readonly processResult: ProcessRunResult;
	readonly reservation?: ActiveRecordingReservation;
	readonly sessionName?: string;
	readonly signal?: AbortSignal;
	readonly stdin?: string;
}

export interface RecordingStopRecoveryResult {
	readonly batch: boolean;
	readonly envelope?: AgentBrowserEnvelope;
	readonly partialBatch: boolean;
	readonly stopIndex: number;
	readonly presentation: ToolPresentation;
	readonly recovery: RecordingRecovery;
}

export type RecordingStopRecoveryObservation = Omit<RecordingStopRecoveryResult, "presentation"> & {
	readonly presentation: ToolPresentationObservation;
};

export interface RecordingRecoveryPlan {
	readonly batch: boolean;
	readonly rows?: readonly unknown[];
	readonly stopIndex: number;
	readonly expected?: ActiveRecordingReservation;
	readonly attempt: RecordingRecovery["attempt"];
}
