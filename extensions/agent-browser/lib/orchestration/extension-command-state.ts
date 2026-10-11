import type { BrowserRecord } from "../browser-transcript.js";
import type { buildExecutionPlan } from "../runtime.js";
import type { BrowserRunState } from "./browser-run/types.js";
import type { SessionPageState, SessionPageStateView } from "../session-page-state.js";
import type { SessionArtifactManifest, NetworkRouteRecord } from "../results/contracts.js";

export interface BrowserCommandPreparation {
	readonly generationAtStart: number;
	readonly workingPageState: SessionPageState;
	readonly priorPages: ReadonlyMap<string, SessionPageStateView>;
	readonly sessionPageStateUpdate: ReturnType<SessionPageState["beginUpdate"]>;
	readonly browserRunState: BrowserRunState;
	readonly selectedPlan: ReturnType<typeof buildExecutionPlan>;
	readonly browserAffecting: boolean;
	readonly operationId: string;
	readonly selectedKey: string;
	readonly begin: BrowserRecord;
	readonly executionSignal: AbortSignal | undefined;
}

export interface BrowserCommandDispatch {
	readonly initialArtifactManifest: SessionArtifactManifest | undefined;
	readonly initialNetworkRoutesBySession: ReadonlyMap<string, readonly NetworkRouteRecord[]>;
	readonly attachedSessionRequested: boolean;
	readonly attachedSessionKnown: boolean;
}
