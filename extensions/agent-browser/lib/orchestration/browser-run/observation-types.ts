import type { ElectronLaunchStatus } from "../../electron/cleanup.js";
import type { ElectronCdpTarget } from "../../electron/launch.js";
import type { AgentBrowserNextAction } from "../../results/contracts.js";
import type {
	SessionRefSnapshot,
	SessionRefSnapshotInvalidation,
	SessionTabTarget,
} from "../../session-page-state.js";

export interface SemanticActionVisibleRefResolution {
	readonly args: readonly string[];
	readonly snapshot: SessionRefSnapshot;
}

export interface NavigationSummary {
	readonly title?: string;
	readonly url?: string;
	readonly urlChanged?: boolean;
}

export interface OverlayBlockerCandidate {
	readonly args: readonly string[];
	readonly name?: string;
	readonly reason: string;
	readonly ref: string;
	readonly role?: string;
}

export interface OverlayBlockerDiagnostic {
	readonly candidates: readonly OverlayBlockerCandidate[];
	readonly snapshot: SessionRefSnapshot;
	readonly summary: string;
}

export type ClickDispatchProbeTarget =
	| { readonly kind: "selector"; readonly selector: string }
	| { readonly kind: "xpath"; readonly selector: string }
	| {
			readonly kind: "accessible";
			readonly name: string;
			readonly refId: string;
			readonly role: string;
	  };

export interface ClickDispatchProbe {
	cleaned?: boolean;
	readonly marker: string;
	readonly target: ClickDispatchProbeTarget;
}

export interface ClickDispatchScrollContainerDiagnostic {
	readonly selector?: string;
	readonly summary: string;
	readonly targetOutsideContainer?: boolean;
	readonly targetOutsideViewport?: boolean;
}

export interface ClickDispatchDiagnostic {
	readonly nativeEventCount: number;
	readonly reason: "native-click-produced-no-target-dom-event";
	readonly scrollContainer?: ClickDispatchScrollContainerDiagnostic;
	readonly status: "no-native-event-observed";
	readonly summary: string;
	readonly target: ClickDispatchProbeTarget;
}

export interface SelectorTextVisibilityCandidate {
	readonly index: number;
	readonly role?: string;
	readonly tagName: string;
	readonly textPreview?: string;
}

export interface SelectorTextVisibilityDiagnostic {
	readonly firstMatchVisible?: boolean;
	readonly firstVisibleTextPreview?: string;
	readonly matchCount: number;
	readonly selector: string;
	readonly summary: string;
	readonly visibleCandidates?: readonly SelectorTextVisibilityCandidate[];
	readonly visibleCount: number;
}

export interface ElectronBroadGetTextScopeDiagnostic {
	readonly electronContext: {
		readonly launchId?: string;
		readonly sessionName?: string;
		readonly url?: string;
	};
	readonly selector: string;
	readonly summary: string;
}

export interface QaAttachedTarget {
	readonly error?: string;
	readonly sessionName: string;
	readonly title?: string;
	readonly url?: string;
}

export interface QaAttachedPreconditionFailure {
	readonly error: string;
	readonly nextActions: readonly AgentBrowserNextAction[];
}

export type {
	TimeoutArtifactEvidence,
	TimeoutProgressStep,
	TimeoutPartialProgress,
	TimeoutPartialProgressDetails,
} from "./timeout-progress.js";

export interface EvalStdinHint {
	readonly reason: string;
	readonly suggestion: string;
}

export interface EvalResultWarning {
	readonly reason: string;
	readonly suggestion: string;
}

export interface ArtifactCleanupGuidance {
	readonly explicitArtifactPaths: readonly string[];
	readonly note: string;
	readonly owner: "host-file-tools";
	readonly summary: string;
}

export interface ManagedSessionOutcome {
	readonly activeAfter: boolean;
	readonly activeBefore: boolean;
	readonly attemptedSessionName?: string;
	readonly currentSessionName: string;
	readonly currentSessionNamespace?: string;
	readonly previousSessionName: string;
	readonly replacedSessionClosed?: boolean;
	readonly replacedSessionName?: string;
	readonly replacedSessionNamespace?: string;
	readonly sessionMode: "auto" | "fresh";
	readonly status: "abandoned" | "closed" | "created" | "preserved" | "replaced" | "unchanged";
	readonly succeeded: boolean;
	readonly summary: string;
}

export interface ScrollPositionSnapshot {
	readonly containerCount: number;
	readonly containers: readonly {
		readonly id: string;
		readonly scrollLeft: number;
		readonly scrollTop: number;
	}[];
	readonly innerHeight: number;
	readonly innerWidth: number;
	readonly scrollHeight: number;
	readonly scrollWidth: number;
	readonly scrollX: number;
	readonly scrollY: number;
}

export interface ScrollNoopDiagnostic {
	readonly after: ScrollPositionSnapshot;
	readonly before: ScrollPositionSnapshot;
	readonly message: string;
	readonly reason: "no-observed-scroll-position-change";
	readonly recommendations: readonly string[];
}

export interface ComboboxFocusDiagnostic {
	readonly activeElement: {
		readonly expanded?: string;
		readonly hasPopup?: string;
		readonly name?: string;
		readonly role?: string;
		readonly tagName?: string;
	};
	readonly message: string;
	readonly reason: "focused-combobox-without-visible-options";
	readonly recommendations: readonly string[];
	readonly visibleListboxCount: number;
	readonly visibleOptionCount: number;
}

export interface RecordingDependencyWarning {
	readonly command: "record start" | "record restart";
	readonly dependency: "ffmpeg";
	readonly message: string;
	readonly reason: "ffmpeg-missing-for-recording";
	readonly recommendations: readonly string[];
}

export interface ScreenshotPathRequest {
	readonly absolutePath: string;
	readonly path: string;
}

export interface PreparedAgentBrowserArgs {
	readonly args: readonly string[];
	readonly batchScreenshotPathRequests?: readonly (ScreenshotPathRequest | undefined)[];
	readonly screenshotPathRequest?: ScreenshotPathRequest;
	readonly stdin?: string;
}

export interface ScreenshotArtifactRequest extends ScreenshotPathRequest {
	readonly status?: "missing" | "repaired-from-temp" | "saved" | "upstream-temp-only";
	readonly tempPath?: string;
}

export interface StaleRefPreflight {
	readonly message: string;
	readonly refIds: readonly string[];
	readonly snapshot?: SessionRefSnapshot;
	readonly snapshotInvalidation?: SessionRefSnapshotInvalidation;
}

export interface AboutBlankSessionMismatch {
	readonly activeUrl: "about:blank";
	readonly recoveryApplied: boolean;
	readonly recoveryHint: string;
	readonly targetTitle?: string;
	readonly targetUrl: string;
}

export interface ElectronHandoffSummary {
	readonly error?: string;
	readonly failureCategory?: "aborted" | "upstream-error" | "validation-error";
	readonly handoff: "connect" | "snapshot" | "tabs";
	readonly refSnapshot?: SessionRefSnapshot;
	readonly snapshot?: unknown;
	readonly snapshotRetryCount?: number;
	readonly tabs?: unknown;
}

export interface ElectronManagedSessionTarget {
	readonly error?: string;
	readonly namespace?: string;
	readonly sessionName: string;
	readonly title?: string;
	readonly url?: string;
}

export type ElectronSessionMismatchReason =
	| "launch-session-not-current"
	| "managed-session-about-blank-while-launch-target-live"
	| "managed-session-target-not-in-launch-status";

export interface ElectronSessionMismatch {
	readonly launchId: string;
	readonly liveTarget?: ElectronCdpTarget;
	readonly managedSession: ElectronManagedSessionTarget;
	readonly nextActionIds: readonly string[];
	readonly reason: ElectronSessionMismatchReason;
	readonly sessionName?: string;
	readonly statusTargets: readonly ElectronCdpTarget[];
	readonly summary: string;
}

export type ElectronPostCommandHealthReason =
	| "about-blank-no-live-target"
	| "debug-port-dead"
	| "process-dead";

export interface ElectronPostCommandHealthDiagnostic {
	readonly appName: string;
	readonly command?: string;
	readonly launchId: string;
	readonly nextActionIds: readonly string[];
	readonly reason: ElectronPostCommandHealthReason;
	readonly sessionName?: string;
	readonly status: ElectronLaunchStatus;
	readonly summary: string;
	readonly target?: SessionTabTarget;
}

export interface FillVerificationDiagnostic {
	readonly actual?: string;
	readonly expected: string;
	readonly method: "text" | "value";
	readonly nextActionIds: readonly string[];
	readonly reason: "contenteditable-fill-mismatch" | "value-fill-mismatch";
	readonly selector: string;
	readonly status: "mismatch";
	readonly summary: string;
}

export interface ElectronRefFreshnessDiagnostic {
	readonly command?: string;
	readonly launchId: string;
	readonly nextActionIds: readonly string[];
	readonly sessionName?: string;
	readonly summary: string;
}
