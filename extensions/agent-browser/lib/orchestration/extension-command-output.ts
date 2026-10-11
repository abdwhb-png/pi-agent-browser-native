import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { AgentBrowserToolResult } from "./browser-run/types.js";
import { buildValidationFailureResult } from "./input-plan.js";
import { applyAgentBrowserOutputPath, canWriteAgentBrowserOutput } from "./output-file.js";
import { getArtifactPreflightValidationError } from "./extension-artifact-preflight.js";
import {
	warnRecordingPersistence,
	type RecordingPublicationAccess,
} from "./extension-recording.js";
import type { AsyncExecutionQueue } from "./execution-queue.js";
import type { BrowserOutputCall } from "./extension-invocation.js";

interface OutputResources {
	readonly artifacts: Readonly<{ queue: AsyncExecutionQueue }>;
	readonly recordings: RecordingPublicationAccess;
}
export async function applyUnserializedOutputPath(
	resources: OutputResources,
	call: BrowserOutputCall,
	result: AgentToolResult<unknown>,
	preserveTextContent = false,
): Promise<AgentBrowserToolResult> {
	if (
		!(call.outputPath !== undefined && call.outputPath !== "") ||
		!canWriteAgentBrowserOutput(result)
	) {
		return warnRecordingPersistence(resources.recordings.dirty, result);
	}
	return resources.artifacts.queue.run(async () => {
		resources.recordings.flush();
		const reservationError = getArtifactPreflightValidationError({
			activeRecordingReservations: [...resources.recordings.active.values()],
			args: [],
			cwd: call.operationCwd,
			outputPath: call.outputPath,
		});
		if (reservationError !== undefined && reservationError !== "") {
			return warnRecordingPersistence(
				resources.recordings.dirty,
				buildValidationFailureResult({
					attemptedKind: call.resolvedInput.kind,
					kind: "invalid",
					redactedArgs: call.resolvedInput.redactedArgs,
					status: "invalid",
					toolArgs: call.resolvedInput.toolArgs,
					toolStdin: call.resolvedInput.toolStdin,
					validationError: reservationError,
				}),
			);
		}
		return applyAgentBrowserOutputPath({
			cwd: call.operationCwd,
			outputPath: call.outputPath,
			preserveTextContent,
			result: warnRecordingPersistence(resources.recordings.dirty, result),
		});
	});
}
