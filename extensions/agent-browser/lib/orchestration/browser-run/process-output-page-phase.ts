import type { NativeOutputEvidence } from "./process-output-native-phase-contracts.js";
import type { PageOutputPhase, PageOutputEvidence } from "./process-output-page-phase-contracts.js";
import { observeHelperConfirmation } from "./process-output-confirmation.js";
import {
	verifyClickDispatch,
	observeNavigationTarget,
	correctRestoredOpenTab,
	observeWebMcpTarget,
	resolveObservedPageTarget,
} from "./process-output-navigation.js";
import {
	recoverUnexpectedBlankTarget,
	pinPostCommandTarget,
	inspectElectronHealth,
} from "./process-output-tabs.js";
import { collectPageDiagnostics } from "./process-output-diagnostics.js";
import { collectTimeoutPartialProgress } from "./diagnostics.js";
import { normalizeSessionTabTarget } from "../../session-page-state.js";
import { reconcileOutputRefs } from "./process-output-refs.js";
async function recoverTimeoutPageTarget(
	view: Readonly<
		Pick<PageOutputPhase, "input" | "recordingStopRecovery" | "currentSessionTabTarget">
	>,
): Promise<Readonly<Pick<PageOutputPhase, "timeoutPartialProgress" | "currentSessionTabTarget">>> {
	const timeoutPartialProgress =
		view.input.processResult.timedOut &&
		!view.recordingStopRecovery &&
		!view.input.prepared.readConfirmation
			? await collectTimeoutPartialProgress({
					commandTokens: view.input.prepared.commandTokens,
					compiledJob: view.input.prepared.compiledJob,
					cwd: view.input.cwd,
					operationCwd: view.input.operationCwd,
					namespace: view.input.prepared.executionPlan.namespace,
					sessionName: view.input.prepared.executionPlan.sessionName,
					stdin: view.input.prepared.runtimeToolStdin,
				})
			: undefined;
	let currentSessionTabTarget = view.currentSessionTabTarget;
	if (!currentSessionTabTarget && timeoutPartialProgress?.liveUrlRecovered === true) {
		currentSessionTabTarget = normalizeSessionTabTarget(timeoutPartialProgress.currentPage);
	}
	return { timeoutPartialProgress, currentSessionTabTarget };
}

function createPageOutputPhase(
	input: PageOutputPhase["input"],
	native: NativeOutputEvidence,
): PageOutputPhase {
	return {
		input,
		aboutBlankSessionMismatch: undefined,
		activeNetworkRoutes: undefined,
		diagnostics: {
			selectorTextVisibilityDiagnostics: [],
			electronBroadGetTextScopeDiagnostics: [],
		},
		batchCommandSteps: native.batchCommandSteps,
		batchRefSnapshotState: undefined,
		browserIndependentRead: native.browserIndependentRead,
		clickDispatchDiagnostic: undefined,
		confirmationFromHelper: false,
		confirmedCommand: native.confirmedCommand,
		confirmedData: native.confirmedData,
		confirmedEffects: native.confirmedEffects,
		currentRefSnapshot: undefined,
		currentRefSnapshotInvalidation: undefined,
		currentSessionTabTarget: undefined,
		destinationTransition: native.destinationTransition,
		directClose: native.directClose,
		dispatchedCommands: native.dispatchedCommands,
		electronPostCommandHealth: undefined,
		electronRecordForCommand: undefined,
		electronSessionMismatch: undefined,
		electronStatusAfterCommand: undefined,
		failedTransitionReverification: false,
		nativeCommandMayHaveExecuted: native.nativeCommandMayHaveExecuted,
		navigationSummary: undefined,
		nestedBatchClose: native.nestedBatchClose,
		nestedBatchClosed: native.nestedBatchClosed,
		networkRoutesBySession: native.networkRoutesBySession,
		observedSessionTabTarget: undefined,
		openResultTabCorrection: undefined,
		presentationEnvelope: native.presentationEnvelope,
		processSucceeded: native.processSucceeded,
		readConfirmation: native.readConfirmation,
		readConfirmationEvent: native.readConfirmationEvent,
		recordingStopRecovery: native.recordingStopRecovery,
		resultingPageState: { pageTargetMayHaveChanged: false, pageUrlUnknown: false },
		sessionStateKey: native.sessionStateKey,
		sessionTabCorrection: undefined,
		succeeded: native.succeeded,
		tabTransition: false,
		textOutput: native.textOutput,
		timeoutPartialProgress: undefined,
		trustsReportedPageTarget: false,
		unobservedMutation: native.unobservedMutation,
		unsettledWebMcpMutation: false,
	};
}
export async function observePageEffects(
	input: PageOutputPhase["input"],
	native: NativeOutputEvidence,
): Promise<PageOutputEvidence> {
	const draft = createPageOutputPhase(input, native);
	await verifyClickDispatch(draft);
	await observeNavigationTarget(draft);
	await correctRestoredOpenTab(draft);
	observeWebMcpTarget(draft);
	observeHelperConfirmation(draft);
	await resolveObservedPageTarget(draft);
	await recoverUnexpectedBlankTarget(draft);
	await pinPostCommandTarget(draft);
	await inspectElectronHealth(draft);
	const timeoutRecovery = await recoverTimeoutPageTarget(draft);
	draft.timeoutPartialProgress = timeoutRecovery.timeoutPartialProgress;
	draft.currentSessionTabTarget = timeoutRecovery.currentSessionTabTarget;
	const collected = await collectPageDiagnostics({
		input,
		aboutBlankSessionMismatch: draft.aboutBlankSessionMismatch,
		clickDispatchDiagnostic: draft.clickDispatchDiagnostic,
		currentSessionTabTarget: draft.currentSessionTabTarget,
		electronRecordForCommand: draft.electronRecordForCommand,
		navigationSummary: draft.navigationSummary,
		networkRoutesBySession: draft.networkRoutesBySession,
		presentationEnvelope: draft.presentationEnvelope,
		sessionStateKey: draft.sessionStateKey,
		sessionTabCorrection: draft.sessionTabCorrection,
		succeeded: draft.succeeded,
	});
	draft.diagnostics = collected.diagnostics;
	draft.activeNetworkRoutes = collected.activeNetworkRoutes;
	draft.networkRoutesBySession = collected.networkRoutesBySession;
	await reconcileOutputRefs(draft);
	return {
		aboutBlankSessionMismatch: draft.aboutBlankSessionMismatch,
		activeNetworkRoutes: draft.activeNetworkRoutes,
		diagnostics: draft.diagnostics,
		batchRefSnapshotState: draft.batchRefSnapshotState,
		clickDispatchDiagnostic: draft.clickDispatchDiagnostic,
		confirmationFromHelper: draft.confirmationFromHelper,
		confirmedEffects: draft.confirmedEffects,
		currentRefSnapshot: draft.currentRefSnapshot,
		currentRefSnapshotInvalidation: draft.currentRefSnapshotInvalidation,
		currentSessionTabTarget: draft.currentSessionTabTarget,
		directClose: draft.directClose,
		electronPostCommandHealth: draft.electronPostCommandHealth,
		electronSessionMismatch: draft.electronSessionMismatch,
		navigationSummary: draft.navigationSummary,
		nestedBatchClosed: draft.nestedBatchClosed,
		networkRoutesBySession: draft.networkRoutesBySession,
		observedSessionTabTarget: draft.observedSessionTabTarget,
		openResultTabCorrection: draft.openResultTabCorrection,
		presentationEnvelope: draft.presentationEnvelope,
		processSucceeded: draft.processSucceeded,
		readConfirmationEvent: draft.readConfirmationEvent,
		recordingStopRecovery: draft.recordingStopRecovery,
		sessionStateKey: draft.sessionStateKey,
		sessionTabCorrection: draft.sessionTabCorrection,
		succeeded: draft.succeeded,
		textOutput: draft.textOutput,
		timeoutPartialProgress: draft.timeoutPartialProgress,
		unobservedMutation: draft.unobservedMutation,
		unsettledWebMcpMutation: draft.unsettledWebMcpMutation,
	};
}
