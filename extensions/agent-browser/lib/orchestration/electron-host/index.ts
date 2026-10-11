import type { CompiledAgentBrowserElectron } from "../../input-modes/types.js";
import { withAttachedBrowserSessionContext } from "../../process.js";
import { getSessionPageStateKey } from "../../session-page-state.js";
import { buildElectronHostFailureResult } from "../browser-run/final-result-electron.js";
import type { AgentBrowserToolResult } from "../browser-run/types.js";
import { selectElectronRecords } from "./branch.js";
import { cleanupTrackedElectronHostLaunches } from "./cleanup.js";
import { buildElectronCleanupResult } from "./cleanup-result.js";
import type { ElectronHostInput, ElectronHostObservationInput } from "./contracts.js";
import { discoverElectronHostApps } from "./discovery.js";

export type { ElectronLaunchRecord } from "../../electron/launch.js";
export { ELECTRON_PROFILE_ISOLATION_DETAILS } from "./discovery.js";
export { restoreElectronLaunchRecordsFromBranch } from "./branch.js";
export {
	cleanupActiveElectronHostLaunches,
	cleanupTrackedElectronHostLaunches,
} from "./cleanup.js";
export const ELECTRON_POST_COMMAND_STATUS_SETTLE_MS = 250;

function preservesAttachedSession(
	options: Pick<
		ElectronHostObservationInput,
		| "managedSessionName"
		| "managedSessionNamespace"
		| "attachedSessionKeys"
		| "electronLaunchRecords"
	>,
): boolean {
	const currentKey =
		getSessionPageStateKey(options.managedSessionName, options.managedSessionNamespace) ??
		options.managedSessionName;
	return (
		options.attachedSessionKeys.has(currentKey) ||
		[...options.electronLaunchRecords.values()].some(
			(record) =>
				record.sessionName !== undefined &&
				options.attachedSessionKeys.has(
					getSessionPageStateKey(record.sessionName, record.namespace) ?? record.sessionName,
				),
		)
	);
}
async function cleanupElectronHostInput(
	options: Pick<
		ElectronHostInput,
		| "cwd"
		| "implicitSessionCloseTimeoutMs"
		| "attachedSessionKeys"
		| "electronChildProcesses"
		| "electronLaunchRecords"
		| "managedSessionRestoreState"
		| "ownedManagedSessions"
		| "sessionPageState"
	>,
	input: Extract<CompiledAgentBrowserElectron, { action: "cleanup" | "status" }>,
	visibleInput: CompiledAgentBrowserElectron,
): Promise<AgentBrowserToolResult> {
	const selection = selectElectronRecords(input, options.electronLaunchRecords);
	if (selection.error !== undefined && selection.error.length > 0) {
		return buildElectronHostFailureResult({
			compiledElectron: visibleInput,
			errorText: selection.error,
			failureCategory: "validation-error",
		});
	}
	const results = await cleanupTrackedElectronHostLaunches({
		...options,
		records: selection.records ?? [],
		timeoutMs: input.timeoutMs ?? options.implicitSessionCloseTimeoutMs,
	});
	return buildElectronCleanupResult(visibleInput, results);
}
async function handleElectronHostInputInContext(
	options: ElectronHostInput,
): Promise<AgentBrowserToolResult | undefined> {
	const input = options.compiledElectron;
	if (!input) {
		return;
	}
	const visibleInput = options.redactedCompiledElectron ?? input;
	switch (input.action) {
		case "list":
			return discoverElectronHostApps(input, visibleInput);
		case "status": {
			const { inspectElectronHostLaunches } = await import("./status.js");
			return inspectElectronHostLaunches(options, input, visibleInput);
		}
		case "probe": {
			const { probeElectronHost } = await import("./probe.js");
			return probeElectronHost(options, input, visibleInput);
		}
		case "cleanup":
			return cleanupElectronHostInput(options, input, visibleInput);
		case "launch":
			return;
	}
}
export async function handleElectronHostInput(
	options: ElectronHostInput,
): Promise<AgentBrowserToolResult | undefined> {
	return await withAttachedBrowserSessionContext(preservesAttachedSession(options), () =>
		handleElectronHostInputInContext(options),
	);
}
