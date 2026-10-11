import type { ProcessBrowserOutputInput, PreparedBrowserRun, BrowserRunState } from "./types.js";
import type { LifecycleOutputPhase } from "./process-output-lifecycle-phase-contracts.js";
import type { PublicationOutputPhase } from "./process-output-publication-phase-contracts.js";
export type ResolveOutputErrorInput = Readonly<
	Pick<
		LifecycleOutputPhase,
		| "commandClosesSession"
		| "managedSessionOutcome"
		| "parseError"
		| "plainTextInspection"
		| "plainTextUpgrade"
		| "recordingStopRecovery"
		| "sessionTabCorrection"
		| "succeeded"
		| "textOutput"
	>
> &
	Pick<
		LifecycleOutputPhase,
		| "errorText"
		| "presentationEnvelope"
		| "resultHeadedManagedAutosaveDisabled"
		| "resultHeadedManagedAutosaveInterval"
	> & {
		readonly input: Readonly<Pick<ProcessBrowserOutputInput, "processResult">> & {
			readonly prepared: Readonly<
				Pick<
					PreparedBrowserRun,
					| "commandTokens"
					| "executionPlan"
					| "ownedManagedSessionContext"
					| "redactedProcessArgs"
					| "runtimeToolStdin"
				>
			>;
		};
	};
export type RenderNativePresentationInput = Readonly<
	Pick<
		PublicationOutputPhase,
		| "activeNetworkRoutes"
		| "artifactManifest"
		| "batchScreenshotArtifactRequests"
		| "confirmationFromHelper"
		| "electronHandoff"
		| "errorText"
		| "inspectionText"
		| "diagnostics"
		| "operationCwd"
		| "parseError"
		| "persistentArtifactStore"
		| "plainTextInspection"
		| "plainTextUpgrade"
		| "presentationEnvelope"
		| "readConfirmationEvent"
		| "recordingStopRecovery"
		| "screenshotArtifactRequest"
		| "sessionStateKey"
		| "succeeded"
		| "textOutput"
	>
> &
	Pick<PublicationOutputPhase, "presentation"> & {
		readonly input: Readonly<
			Pick<ProcessBrowserOutputInput, "artifactRunStartedAtMs" | "modelVisible" | "processResult">
		> & {
			readonly prepared: Readonly<
				Pick<
					PreparedBrowserRun,
					| "commandTokens"
					| "compiledSemanticAction"
					| "executionPlan"
					| "processStdin"
					| "readConfirmation"
					| "redactedArgs"
					| "redactedProcessArgs"
				>
			>;
		} & { readonly state: BrowserRunState };
	};
export type ReclassifyPresentationInput = Readonly<
	Pick<PublicationOutputPhase, "parseFailureOutput" | "diagnostics" | "sessionStateKey">
> &
	Pick<
		PublicationOutputPhase,
		| "artifactManifest"
		| "networkRoutesBySession"
		| "presentation"
		| "presentationEnvelope"
		| "succeeded"
	>;
export type ResolveNativeErrorTextInput = Readonly<
	Pick<
		LifecycleOutputPhase,
		| "parseError"
		| "plainTextInspection"
		| "presentationEnvelope"
		| "recordingStopRecovery"
		| "sessionTabCorrection"
	>
> &
	Pick<LifecycleOutputPhase, "errorText"> & {
		readonly input: Readonly<Pick<ProcessBrowserOutputInput, "processResult">> & {
			readonly prepared: Readonly<
				Pick<
					PreparedBrowserRun,
					"commandTokens" | "executionPlan" | "redactedProcessArgs" | "runtimeToolStdin"
				>
			>;
		};
	};
export type ApplyErrorEnvelopeFallbackInput = Readonly<Pick<LifecycleOutputPhase, "errorText">> &
	Pick<LifecycleOutputPhase, "presentationEnvelope">;
export type RedactClipboardErrorInput = Pick<
	LifecycleOutputPhase,
	"errorText" | "presentationEnvelope"
> & {
	readonly input: {
		readonly prepared: Readonly<Pick<PreparedBrowserRun, "commandTokens" | "executionPlan">>;
	};
};
export type ApplyTextErrorEnvelopeInput = Readonly<
	Pick<LifecycleOutputPhase, "errorText" | "plainTextUpgrade" | "textOutput">
> &
	Pick<LifecycleOutputPhase, "presentationEnvelope">;
export type ObserveResultLaunchPolicyInput = Readonly<
	Pick<LifecycleOutputPhase, "commandClosesSession" | "managedSessionOutcome" | "succeeded">
> &
	Pick<
		LifecycleOutputPhase,
		"resultHeadedManagedAutosaveDisabled" | "resultHeadedManagedAutosaveInterval"
	> & {
		readonly input: {
			readonly prepared: Readonly<Pick<PreparedBrowserRun, "ownedManagedSessionContext">>;
		};
	};
export type ClassifyMalformedNativeFailureInput = Readonly<
	Pick<PublicationOutputPhase, "parseError">
> &
	Pick<PublicationOutputPhase, "presentation"> & {
		readonly input: Readonly<Pick<ProcessBrowserOutputInput, "processResult">>;
	};
export type RenderPresentationConfirmationInput = Readonly<
	Pick<
		PublicationOutputPhase,
		"confirmationFromHelper" | "presentationEnvelope" | "readConfirmationEvent"
	>
> &
	Pick<PublicationOutputPhase, "presentation"> & {
		readonly input: { readonly prepared: Readonly<Pick<PreparedBrowserRun, "readConfirmation">> };
	};
export type RenderUpgradeFailureInput = Readonly<
	Pick<
		PublicationOutputPhase,
		| "artifactManifest"
		| "persistentArtifactStore"
		| "plainTextUpgrade"
		| "presentationEnvelope"
		| "succeeded"
		| "textOutput"
	>
> &
	Pick<PublicationOutputPhase, "presentation"> & {
		readonly input: Readonly<Pick<ProcessBrowserOutputInput, "modelVisible">> & {
			readonly prepared: Readonly<Pick<PreparedBrowserRun, "executionPlan">>;
		};
	};
export type ReclassifyScrollNoopInput = Readonly<Pick<PublicationOutputPhase, "diagnostics">> &
	Pick<PublicationOutputPhase, "presentation" | "presentationEnvelope" | "succeeded">;
export type RenderParseFailureArtifactsInput = Readonly<
	Pick<PublicationOutputPhase, "parseFailureOutput">
> &
	Pick<PublicationOutputPhase, "artifactManifest" | "presentation">;
export type RenderPendingHelperConfirmationInput = Readonly<
	Pick<PublicationOutputPhase, "presentationEnvelope" | "readConfirmationEvent">
> &
	Pick<PublicationOutputPhase, "presentation">;
export type InspectionPresentationInput = Readonly<
	Pick<PublicationOutputPhase, "inspectionText">
> & { readonly input: { readonly prepared: Readonly<Pick<PreparedBrowserRun, "redactedArgs">> } };
export type PreviousContactSheetPathInput = Readonly<
	Pick<PublicationOutputPhase, "sessionStateKey">
> & { readonly input: { readonly state: BrowserRunState } };
export type PresentationCleanupOwnershipInput = Readonly<
	Pick<PublicationOutputPhase, "sessionStateKey">
> & {
	readonly input: { readonly prepared: Readonly<Pick<PreparedBrowserRun, "executionPlan">> } & {
		readonly state: BrowserRunState;
	};
};
export type BuildNativePresentationInput = Readonly<
	Pick<
		PublicationOutputPhase,
		| "activeNetworkRoutes"
		| "artifactManifest"
		| "batchScreenshotArtifactRequests"
		| "errorText"
		| "inspectionText"
		| "diagnostics"
		| "operationCwd"
		| "persistentArtifactStore"
		| "plainTextInspection"
		| "presentationEnvelope"
		| "recordingStopRecovery"
		| "screenshotArtifactRequest"
		| "sessionStateKey"
		| "textOutput"
	>
> & {
	readonly input: Readonly<
		Pick<ProcessBrowserOutputInput, "artifactRunStartedAtMs" | "modelVisible">
	> & {
		readonly prepared: Readonly<
			Pick<
				PreparedBrowserRun,
				| "commandTokens"
				| "compiledSemanticAction"
				| "executionPlan"
				| "processStdin"
				| "redactedArgs"
				| "redactedProcessArgs"
			>
		>;
	} & { readonly state: BrowserRunState };
};
export type PreparedSessionRetainedInput = Readonly<
	Pick<LifecycleOutputPhase, "managedSessionOutcome">
>;
export type RenderParseFailureNoticeInput = Readonly<
	Pick<PublicationOutputPhase, "parseFailureOutput" | "presentation">
>;
export type ApplyBatchNetworkRouteStateInput = Readonly<
	Pick<PublicationOutputPhase, "presentationEnvelope" | "sessionStateKey" | "succeeded">
> &
	Pick<PublicationOutputPhase, "networkRoutesBySession">;
