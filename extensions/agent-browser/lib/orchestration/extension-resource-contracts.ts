import type { CompatibilityWorkaround } from "../runtime.js";

export interface OwnedManagedSession {
	readonly branchOwned: boolean;
	readonly compatibilityWorkaround?: CompatibilityWorkaround;
	readonly cwd: string;
	readonly headedManagedAutosaveDisabled?: boolean;
	readonly headedManagedAutosaveInterval?: string;
	readonly namespace?: string;
	readonly sessionName: string;
	readonly socketDir?: string;
}
/** Mutable cleanup registry; entries are readonly and changes belong to its explicit mutators. */
export type OwnedManagedSessionStore = Map<string, OwnedManagedSession>;
/** Successful cwd/PATH probes retained for one extension runtime. */
export type ValidatedUpstreamPaths = Set<string>;
export type ManagedSessionLaunchState = {
	-readonly [K in keyof LaunchSettings]?: LaunchSettings[K];
};
type LaunchSettings = Pick<
	OwnedManagedSession,
	| "cwd"
	| "compatibilityWorkaround"
	| "headedManagedAutosaveDisabled"
	| "headedManagedAutosaveInterval"
	| "socketDir"
>;
export interface BranchManagedResourceEvents {
	readonly electronLaunchActiveRanks: ReadonlyMap<string, number>;
	readonly electronLaunchCleanupRanks: ReadonlyMap<string, number>;
	readonly managedSessionActiveIdentities: ReadonlyMap<
		string,
		Readonly<{ namespace?: string; sessionName: string }>
	>;
	readonly managedSessionActiveRanks: ReadonlyMap<string, number>;
	readonly managedSessionCloseRanks: ReadonlyMap<string, number>;
	readonly managedSessionLaunchState: ReadonlyMap<string, Readonly<ManagedSessionLaunchState>>;
}
export interface ElectronClosedManagedSessionIdentity {
	readonly namespace?: string;
	readonly sessionName: string;
}
