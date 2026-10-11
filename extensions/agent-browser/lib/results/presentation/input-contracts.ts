import type { CompiledAgentBrowserSemanticAction } from "../../input-modes/types.js";
import type { NetworkRouteRecord } from "../contracts.js";
import type { BuildNestedToolPresentationOptions } from "./batch-contracts.js";

export interface BuildToolPresentationOptions extends BuildNestedToolPresentationOptions {
	readonly textOutput?: boolean;
	readonly stdin?: string;
	readonly batchArtifactRequests?: readonly BuildNestedToolPresentationOptions["artifactRequest"][];
	readonly compiledSemanticAction?: CompiledAgentBrowserSemanticAction;
	readonly networkRoutes?: readonly NetworkRouteRecord[];
	readonly recordingPending?: boolean;
	readonly previousRecordingContactSheetPath?: string;
}
