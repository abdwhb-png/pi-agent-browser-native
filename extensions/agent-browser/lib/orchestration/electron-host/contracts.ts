import type { ChildProcess } from "node:child_process";
import type { ElectronLaunchRecord } from "../../electron/launch.js";
import type { CompiledAgentBrowserElectron } from "../../input-modes/types.js";
import type { ManagedSessionRestoreState } from "../../managed-session-restore.js";
import type { SessionPageState, SessionRefSnapshot } from "../../session-page-state.js";
import type { OwnedManagedSessionReference } from "../browser-run/types.js";

// These stores belong to the extension runtime. Cleanup replaces launch records
// and retires child handles; observations receive readonly views instead.
export type ElectronHostLaunchRecords = Map<string, ElectronLaunchRecord>;
export type ElectronHostChildProcesses = Map<string, ChildProcess>;
export type ElectronManagedSessionOwner = Readonly<
	Pick<
		OwnedManagedSessionReference,
		"headedManagedAutosaveDisabled" | "headedManagedAutosaveInterval" | "socketDir"
	>
>;
export interface ElectronHostLaunchCleanupState {
	readonly sessionPageState: SessionPageState;
	readonly attachedSessionKeys: ReadonlySet<string>;
	readonly electronChildProcesses: ElectronHostChildProcesses;
	readonly electronLaunchRecords: ElectronHostLaunchRecords;
	readonly managedSessionRestoreState: ManagedSessionRestoreState;
	readonly ownedManagedSessions: ReadonlyMap<string, ElectronManagedSessionOwner>;
}
export interface ElectronHostInput extends ElectronHostLaunchCleanupState {
	readonly compiledElectron?: CompiledAgentBrowserElectron;
	readonly cwd: string;
	readonly implicitSessionCloseTimeoutMs: number;
	readonly managedSessionActive: boolean;
	readonly managedSessionName: string;
	readonly managedSessionNamespace?: string;
	readonly redactedCompiledElectron?: CompiledAgentBrowserElectron;
	readonly signal?: AbortSignal;
}
export interface ElectronHostObservationInput {
	readonly electronLaunchRecords: ReadonlyMap<string, ElectronLaunchRecord>;
	readonly cwd: string;
	readonly managedSessionActive: boolean;
	readonly managedSessionName: string;
	readonly managedSessionNamespace?: string;
	readonly managedSessionRestoreState: ManagedSessionRestoreState;
	readonly ownedManagedSessions: ReadonlyMap<string, ElectronManagedSessionOwner>;
	readonly sessionPageState: SessionPageState;
	readonly attachedSessionKeys: ReadonlySet<string>;
	readonly signal?: AbortSignal;
}
export interface ElectronManagedSessionInspection {
	readonly cwd: string;
	readonly namespace?: string;
	readonly sessionName: string;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}
export interface ElectronManagedSessionPolicy extends ElectronManagedSessionInspection {
	readonly confirmActions?: string;
	readonly electronLaunchRecord?: ElectronLaunchRecord;
	readonly headedManagedAutosaveDisabled?: boolean;
	readonly headedManagedAutosaveInterval?: string;
	readonly restoreState: ManagedSessionRestoreState;
}
export interface ElectronProbeContext {
	readonly launchId?: string;
	readonly mode: "current-managed-session" | "launchId";
	readonly note?: string;
	readonly sessionName: string;
}
export interface ElectronProbeFocusedElement {
	readonly ariaLabel?: string;
	readonly id?: string;
	readonly isContentEditable?: boolean;
	readonly name?: string;
	readonly placeholder?: string;
	readonly role?: string;
	readonly tagName?: string;
	readonly textLength?: number;
	readonly textPreview?: string;
	readonly title?: string;
	readonly type?: string;
	readonly valueLength?: number;
}
export interface ElectronProbeTab {
	readonly active?: boolean;
	readonly index?: number;
	readonly tabId?: string;
	readonly title?: string;
	readonly type?: string;
	readonly url?: string;
}
export interface ElectronProbeSnapshotSummary {
	readonly lineCount: number;
	readonly omittedLineCount?: number;
	readonly omittedRefCount?: number;
	readonly refCount: number;
	readonly refIds: readonly string[];
	readonly text?: string;
}
export interface ElectronProbeResult {
	readonly activeTab?: ElectronProbeTab;
	readonly errors?: readonly string[];
	readonly focusedElement?: ElectronProbeFocusedElement;
	readonly refSnapshot?: SessionRefSnapshot;
	readonly sessionName: string;
	readonly snapshot?: ElectronProbeSnapshotSummary;
	readonly status: "partial" | "succeeded";
	readonly summary: string;
	readonly tabs?: {
		readonly omittedCount?: number;
		readonly shown: readonly ElectronProbeTab[];
		readonly total: number;
	};
	readonly title?: string;
	readonly url?: string;
}
