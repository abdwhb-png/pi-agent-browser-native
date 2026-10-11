import type {
	ProcessBrowserOutputInput,
	PreparedBrowserRun,
	BrowserRunState,
	ElectronHandoffSummary,
} from "./types.js";
import type { LifecycleOutputPhase } from "./process-output-lifecycle-phase-contracts.js";
import { cleanupElectronLaunchResources } from "../../electron/cleanup.js";
import type { ElectronLaunchRecord, ElectronLaunchSuccess } from "../../electron/launch.js";
import { createFreshSessionName } from "../../runtime-session-identity.js";
import { closeManagedSession } from "./managed-session-daemon-policy.js";
import { buildManagedSessionOutcome } from "./session-state.js";
import { collectElectronHandoff } from "./diagnostics.js";

type CollectLaunchHandoffInput = {
	readonly input: Readonly<Pick<ProcessBrowserOutputInput, "cwd" | "signal">> & {
		readonly prepared: Readonly<Pick<PreparedBrowserRun, "compiledElectron" | "executionPlan">>;
	};
};
type RecordElectronOwnershipInput = { readonly input: { readonly state: BrowserRunState } };
type RetireFailedElectronSessionInput = Pick<
	LifecycleOutputPhase,
	| "freshSessionOrdinal"
	| "managedSessionActive"
	| "managedSessionName"
	| "managedSessionNamespace"
	| "networkRoutesBySession"
> & {
	readonly input: {
		readonly prepared: Readonly<Pick<PreparedBrowserRun, "executionPlan">>;
		readonly state: BrowserRunState;
	};
};
type FailedHandoffOutcomeInput = Readonly<
	Pick<
		LifecycleOutputPhase,
		| "managedSessionActive"
		| "managedSessionName"
		| "managedSessionNamespace"
		| "priorManagedSessionActive"
		| "priorManagedSessionName"
		| "priorManagedSessionNamespace"
		| "replacedManagedSessionName"
	>
> &
	Pick<LifecycleOutputPhase, "managedSessionOutcome"> & {
		readonly input: {
			readonly prepared: Readonly<Pick<PreparedBrowserRun, "executionPlan" | "sessionMode">>;
		};
	};
type CleanupFailedHandoffInput = Readonly<
	Pick<
		LifecycleOutputPhase,
		| "priorManagedSessionActive"
		| "priorManagedSessionName"
		| "priorManagedSessionNamespace"
		| "replacedManagedSessionName"
		| "sessionStateKey"
	>
> &
	Pick<
		LifecycleOutputPhase,
		| "electronFailedConnectCleanup"
		| "electronLaunchRecord"
		| "freshSessionOrdinal"
		| "managedSessionActive"
		| "managedSessionName"
		| "managedSessionNamespace"
		| "managedSessionOutcome"
		| "networkRoutesBySession"
	> & {
		readonly input: Readonly<
			Pick<
				ProcessBrowserOutputInput,
				"cwd" | "implicitSessionCloseTimeoutMs" | "preserveAttachedBrowserSession"
			>
		> & {
			readonly prepared: Readonly<
				Pick<
					PreparedBrowserRun,
					| "executionPlan"
					| "managedSessionPolicyLock"
					| "ownedManagedSessionContext"
					| "sessionMode"
				>
			>;
			readonly state: BrowserRunState;
		};
	};
type ApplyHandoffSnapshotInput = Readonly<Pick<LifecycleOutputPhase, "sessionStateKey">> &
	Pick<
		LifecycleOutputPhase,
		"currentRefSnapshot" | "currentRefSnapshotInvalidation" | "currentSessionTabTarget"
	> & {
		readonly input: Readonly<Pick<ProcessBrowserOutputInput, "sessionPageStateUpdate">> & {
			readonly state: BrowserRunState;
		};
	};
type ReconcileElectronHandoffInput = Readonly<
	Pick<
		LifecycleOutputPhase,
		| "priorManagedSessionActive"
		| "priorManagedSessionName"
		| "priorManagedSessionNamespace"
		| "replacedManagedSessionName"
		| "sessionStateKey"
	>
> &
	Pick<
		LifecycleOutputPhase,
		| "currentRefSnapshot"
		| "currentRefSnapshotInvalidation"
		| "currentSessionTabTarget"
		| "electronFailedConnectCleanup"
		| "electronHandoff"
		| "electronLaunchRecord"
		| "freshSessionOrdinal"
		| "managedSessionActive"
		| "managedSessionName"
		| "managedSessionNamespace"
		| "managedSessionOutcome"
		| "networkRoutesBySession"
		| "presentationEnvelope"
		| "succeeded"
	> & {
		readonly input: Readonly<
			Pick<
				ProcessBrowserOutputInput,
				| "cwd"
				| "implicitSessionCloseTimeoutMs"
				| "preserveAttachedBrowserSession"
				| "sessionPageStateUpdate"
				| "signal"
			>
		> & {
			readonly prepared: Readonly<
				Pick<
					PreparedBrowserRun,
					| "compiledElectron"
					| "electronFailedConnectCleanup"
					| "electronHandoff"
					| "electronLaunch"
					| "executionPlan"
					| "managedSessionPolicyLock"
					| "ownedManagedSessionContext"
					| "sessionMode"
				>
			>;
			readonly state: BrowserRunState;
		};
	};

function handoffExceptionMessage(error: unknown): string {
	// Unstructured thrown objects may hold credentials; only an explicit public string is safe to retain.
	return typeof error === "string" ? error : "Electron handoff failed with a non-Error exception.";
}

async function collectLaunchHandoff(
	draft: CollectLaunchHandoffInput,
	sessionName: string,
): Promise<ElectronHandoffSummary> {
	const { prepared, cwd, signal } = draft.input;
	const handoff =
		prepared.compiledElectron?.action === "launch" ? prepared.compiledElectron.handoff : "connect";
	try {
		return await collectElectronHandoff({
			cwd,
			handoff,
			namespace: prepared.executionPlan.namespace,
			sessionName,
			signal,
		});
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : handoffExceptionMessage(error),
			failureCategory: signal?.aborted === true ? "aborted" : "upstream-error",
			handoff,
		};
	}
}

function recordElectronOwnership(
	draft: RecordElectronOwnershipInput,
	launch: ElectronLaunchSuccess,
	record: ElectronLaunchRecord,
): void {
	draft.input.state.electronLaunchRecords.set(record.launchId, record);
	draft.input.state.electronChildProcesses.set(record.launchId, launch.child);
}

function retireFailedElectronSession(
	draft: RetireFailedElectronSessionInput,
	sessionName: string,
	sessionKey: string,
): void {
	draft.input.state.closedManagedSessionNames.add(sessionKey);
	const routes = new Map(draft.networkRoutesBySession);
	routes.delete(sessionKey);
	draft.networkRoutesBySession = routes;
	draft.input.state.sessionPageState.clearSession(sessionKey);
	if (
		draft.managedSessionName !== sessionName ||
		draft.managedSessionNamespace !== draft.input.prepared.executionPlan.namespace
	) {
		return;
	}
	draft.managedSessionActive = false;
	draft.freshSessionOrdinal += 1;
	draft.managedSessionName = createFreshSessionName(
		draft.input.state.managedSessionBaseName,
		draft.input.state.ephemeralSessionSeed,
		draft.freshSessionOrdinal,
	);
	draft.managedSessionNamespace = undefined;
}

function failedHandoffOutcome(draft: FailedHandoffOutcomeInput, sessionName: string): void {
	draft.managedSessionOutcome = buildManagedSessionOutcome({
		activeAfter: draft.managedSessionActive,
		activeBefore: draft.priorManagedSessionActive,
		attemptedSessionName: sessionName,
		command: draft.input.prepared.executionPlan.commandInfo.command,
		currentSessionName: draft.managedSessionName,
		currentSessionNamespace: draft.managedSessionNamespace,
		previousSessionName: draft.priorManagedSessionName,
		replacedSessionName: draft.replacedManagedSessionName,
		replacedSessionNamespace: draft.priorManagedSessionNamespace,
		sessionMode: draft.input.prepared.sessionMode,
		succeeded: false,
	});
}

async function cleanupFailedHandoff(
	draft: CleanupFailedHandoffInput,
	launch: ElectronLaunchSuccess,
	record: ElectronLaunchRecord,
	sessionName: string,
): Promise<void> {
	const sessionKey = draft.sessionStateKey ?? sessionName;
	const { prepared, state, cwd, implicitSessionCloseTimeoutMs } = draft.input;
	const closeError = await closeManagedSession({
		confirmActions:
			state.sessionPageState.get(sessionKey).confirmActions ??
			process.env.AGENT_BROWSER_CONFIRM_ACTIONS,
		cwd,
		headedManagedAutosaveInterval:
			prepared.ownedManagedSessionContext?.headedManagedAutosaveInterval,
		namespace: prepared.executionPlan.namespace,
		policyLock: prepared.managedSessionPolicyLock,
		preserveAttachedBrowserSession: draft.input.preserveAttachedBrowserSession,
		restoreState: state.managedSessionRestoreState,
		sessionName,
		timeoutMs: implicitSessionCloseTimeoutMs,
	});
	draft.electronFailedConnectCleanup = await cleanupElectronLaunchResources({
		child: launch.child,
		record,
		timeoutMs: implicitSessionCloseTimeoutMs,
	});
	draft.electronLaunchRecord = draft.electronFailedConnectCleanup.record;
	if (draft.electronFailedConnectCleanup.partial) {
		recordElectronOwnership(draft, launch, draft.electronLaunchRecord);
	} else {
		state.electronLaunchRecords.delete(draft.electronLaunchRecord.launchId);
		state.electronChildProcesses.delete(draft.electronLaunchRecord.launchId);
	}
	if (closeError === undefined || closeError.length === 0) {
		retireFailedElectronSession(draft, sessionName, sessionKey);
	}
	failedHandoffOutcome(draft, sessionName);
}

function applyHandoffSnapshot(
	draft: ApplyHandoffSnapshotInput,
	sessionName: string,
	handoff: ElectronHandoffSummary,
): void {
	const snapshot = handoff.refSnapshot;
	if (!snapshot) {
		return;
	}
	const sessionKey = draft.sessionStateKey ?? sessionName;
	const { state, sessionPageStateUpdate } = draft.input;
	const refUpdate = state.sessionPageState.applyRefSnapshot({
		sessionName: sessionKey,
		snapshot,
		update: sessionPageStateUpdate,
	});
	draft.currentRefSnapshot = refUpdate.refSnapshot;
	draft.currentRefSnapshotInvalidation = refUpdate.refSnapshotInvalidation;
	if (snapshot.target) {
		const targetUpdate = state.sessionPageState.applyTabTarget({
			sessionName: sessionKey,
			target: snapshot.target,
			update: sessionPageStateUpdate,
		});
		draft.currentSessionTabTarget = targetUpdate.tabTarget;
	}
}

export async function reconcileElectronHandoff(
	draft: ReconcileElectronHandoffInput,
): Promise<void> {
	const { prepared, implicitSessionCloseTimeoutMs } = draft.input;
	draft.electronFailedConnectCleanup = prepared.electronFailedConnectCleanup;
	draft.electronHandoff = prepared.electronHandoff;
	const launch = prepared.electronLaunch;
	if (!launch) {
		return;
	}
	const sessionName = prepared.executionPlan.sessionName;
	if (!draft.succeeded || sessionName === undefined || sessionName.length === 0) {
		draft.electronFailedConnectCleanup = await cleanupElectronLaunchResources({
			child: launch.child,
			record: launch.record,
			timeoutMs: implicitSessionCloseTimeoutMs,
		});
		draft.electronLaunchRecord = draft.electronFailedConnectCleanup.record;
		return;
	}
	const record = { ...launch.record, namespace: prepared.executionPlan.namespace, sessionName };
	draft.electronLaunchRecord = record;
	const handoff = await collectLaunchHandoff(draft, sessionName);
	draft.electronHandoff = handoff;
	if (handoff.error !== undefined && handoff.error.length > 0) {
		draft.succeeded = false;
		draft.presentationEnvelope = { error: handoff.error, success: false };
		await cleanupFailedHandoff(draft, launch, record, sessionName);
		return;
	}
	recordElectronOwnership(draft, launch, record);
	applyHandoffSnapshot(draft, sessionName, handoff);
}
