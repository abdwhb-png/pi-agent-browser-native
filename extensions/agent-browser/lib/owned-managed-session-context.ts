import { AsyncLocalStorage } from "node:async_hooks";
import {
	canonicalizeAgentBrowserNamespace,
	extractExplicitSessionName,
	resolveAgentBrowserNamespace,
} from "./argv-grammar.js";
import type { ManagedSessionRestoreState } from "./managed-session-restore-state.js";

export type OwnedManagedSessionContext = {
	/** Carry existing daemon settings without browser launch policy or sticky restore changes. */
	readonly reuseOnly?: boolean;
	readonly compatibilityUserAgent?: string;
	readonly headedManagedAutosaveDisabled?: boolean;
	readonly headedManagedAutosaveInterval?: string;
	readonly cwd?: string;
	readonly expectedDaemonRestoreKey?: string | null;
	readonly namespace?: string;
	readonly protectedStorageEnv?: Readonly<NodeJS.ProcessEnv>;
	readonly restoreDecision?: "enabled" | "incompatible" | "opted-out";
	readonly restoreKey?: string;
	readonly restoreScope?: string;
	readonly restoreSuppressed?: boolean;
	readonly restoreState: ManagedSessionRestoreState;
	readonly sessionName: string;
};
export interface OwnedContextResolutionOptions {
	readonly currentManagedSessionName?: string;
	readonly currentManagedSessionNamespace?: string;
	readonly cwd?: string;
	readonly managedSessionName?: string;
	readonly namespace?: string;
	readonly recordedOwnedSession?: {
		readonly cwd: string;
		readonly namespace?: string;
		readonly sessionName: string;
	};
	readonly restoreState: ManagedSessionRestoreState;
	readonly sessionName?: string;
}
const ownedManagedSessionStorage = new AsyncLocalStorage<OwnedManagedSessionContext | undefined>();
export async function withOwnedManagedSessionContext<T>(
	context: OwnedManagedSessionContext | undefined,
	run: () => Promise<T>,
): Promise<T> {
	return await ownedManagedSessionStorage.run(context, run);
}
export function resolveOwnedManagedSessionContext(
	options: OwnedContextResolutionOptions,
): OwnedManagedSessionContext | undefined {
	const namespace = canonicalizeAgentBrowserNamespace(options.namespace);
	const currentNamespace = canonicalizeAgentBrowserNamespace(
		options.currentManagedSessionNamespace,
	);
	const recordedNamespace = canonicalizeAgentBrowserNamespace(
		options.recordedOwnedSession?.namespace,
	);
	if (
		options.recordedOwnedSession &&
		options.sessionName === options.recordedOwnedSession.sessionName &&
		namespace === recordedNamespace
	) {
		return {
			cwd: options.recordedOwnedSession.cwd,
			namespace,
			restoreState: options.restoreState,
			sessionName: options.sessionName,
		};
	}
	if (options.managedSessionName !== undefined && options.managedSessionName.length > 0) {
		return {
			cwd: options.cwd,
			namespace,
			restoreState: options.restoreState,
			sessionName: options.managedSessionName,
		};
	}
	if (
		options.sessionName !== undefined &&
		options.sessionName.length > 0 &&
		matchesCurrentContext(options, namespace, currentNamespace)
	) {
		return {
			cwd: options.cwd,
			namespace,
			restoreState: options.restoreState,
			sessionName: options.sessionName,
		};
	}
	return undefined;
}
function matchesCurrentContext(
	options: OwnedContextResolutionOptions,
	namespace: string | undefined,
	currentNamespace: string | undefined,
): boolean {
	return (
		options.sessionName === options.currentManagedSessionName && namespace === currentNamespace
	);
}
export function ownedContextMatches(
	sessionName: string | undefined,
	args: readonly string[],
): OwnedManagedSessionContext | undefined {
	const owned = ownedManagedSessionStorage.getStore();
	return owned &&
		sessionName === owned.sessionName &&
		canonicalizeAgentBrowserNamespace(resolveAgentBrowserNamespace(args, owned.namespace)) ===
			owned.namespace
		? owned
		: undefined;
}
export function isOwnedManagedSessionTarget(args: readonly string[]): boolean {
	return ownedContextMatches(extractExplicitSessionName(args), args) !== undefined;
}
