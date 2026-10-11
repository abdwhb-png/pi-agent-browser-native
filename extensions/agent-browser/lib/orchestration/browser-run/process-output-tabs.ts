import type { ProcessBrowserOutputInput, PreparedBrowserRun, BrowserRunState } from "./types.js";
import type { PageOutputPhase } from "./process-output-page-phase-contracts.js";
import { inspectElectronLaunchStatus } from "../../electron/cleanup.js";
import {
	commandExplicitlyTargetsAboutBlank,
	isAboutBlankSessionTabTarget,
	normalizeSessionTabTarget,
	type SessionTabTarget,
} from "../../session-page-state.js";
import { extractUpstreamCommandTokens } from "../../argv-descriptor.js";
import {
	applyOpenResultTabCorrection,
	buildAboutBlankRecoveryHint,
	buildElectronPostCommandHealthDiagnostic,
	buildElectronSessionMismatch,
	collectSessionTabSelection,
	findElectronLaunchRecordForSession,
	shouldCorrectSessionTabAfterCommand,
	shouldInspectElectronPostCommandHealth,
} from "./session-state.js";
import { sleepMs } from "./diagnostics.js";

type UnexpectedBlankTargetInput = Readonly<
	Pick<
		PageOutputPhase,
		| "currentSessionTabTarget"
		| "destinationTransition"
		| "dispatchedCommands"
		| "nestedBatchClose"
		| "observedSessionTabTarget"
		| "succeeded"
		| "tabTransition"
	>
> & {
	readonly input: {
		readonly prepared: Readonly<Pick<PreparedBrowserRun, "priorSessionTabTarget">>;
	};
};
type InspectBlankElectronMismatchInput = Pick<
	PageOutputPhase,
	"electronSessionMismatch" | "electronStatusAfterCommand"
> & {
	readonly input: {
		readonly prepared: Readonly<Pick<PreparedBrowserRun, "executionPlan">>;
		readonly state: BrowserRunState;
	};
};
type RecoverUnexpectedBlankTargetInput = Readonly<
	Pick<
		PageOutputPhase,
		| "destinationTransition"
		| "dispatchedCommands"
		| "nestedBatchClose"
		| "observedSessionTabTarget"
		| "succeeded"
		| "tabTransition"
	>
> &
	Pick<
		PageOutputPhase,
		| "aboutBlankSessionMismatch"
		| "currentSessionTabTarget"
		| "electronSessionMismatch"
		| "electronStatusAfterCommand"
		| "sessionTabCorrection"
	> & {
		readonly input: Readonly<Pick<ProcessBrowserOutputInput, "cwd" | "signal">> & {
			readonly prepared: Readonly<
				Pick<PreparedBrowserRun, "executionPlan" | "priorSessionTabTarget" | "sessionTabCorrection">
			>;
			readonly state: BrowserRunState;
		};
	};
type NeedsPostCommandPinningInput = Readonly<
	Pick<PageOutputPhase, "aboutBlankSessionMismatch" | "sessionTabCorrection" | "succeeded">
> & {
	readonly input: {
		readonly prepared: Readonly<
			Pick<
				PreparedBrowserRun,
				"commandTokens" | "executionPlan" | "priorSessionTabTarget" | "sessionTabPinningReason"
			>
		>;
	};
};
type PinPostCommandTargetInput = Readonly<
	Pick<PageOutputPhase, "aboutBlankSessionMismatch" | "observedSessionTabTarget" | "succeeded">
> &
	Pick<PageOutputPhase, "sessionTabCorrection"> & {
		readonly input: Readonly<Pick<ProcessBrowserOutputInput, "cwd" | "signal">> & {
			readonly prepared: Readonly<
				Pick<
					PreparedBrowserRun,
					"commandTokens" | "executionPlan" | "priorSessionTabTarget" | "sessionTabPinningReason"
				>
			>;
		};
	};
type InspectElectronHealthInput = Readonly<
	Pick<PageOutputPhase, "currentSessionTabTarget" | "observedSessionTabTarget">
> &
	Pick<
		PageOutputPhase,
		| "electronPostCommandHealth"
		| "electronRecordForCommand"
		| "electronStatusAfterCommand"
		| "succeeded"
	> & {
		readonly input: Readonly<
			Pick<ProcessBrowserOutputInput, "electronPostCommandStatusSettleMs">
		> & {
			readonly prepared: Readonly<Pick<PreparedBrowserRun, "executionPlan">>;
			readonly state: BrowserRunState;
		};
	};

function unexpectedBlankTarget(draft: UnexpectedBlankTargetInput): boolean {
	const explicitBlank = draft.dispatchedCommands.some((step) =>
		commandExplicitlyTargetsAboutBlank(extractUpstreamCommandTokens(step)),
	);
	return (
		draft.succeeded &&
		!draft.tabTransition &&
		!draft.destinationTransition &&
		!explicitBlank &&
		draft.nestedBatchClose === undefined &&
		draft.input.prepared.priorSessionTabTarget !== undefined &&
		!isAboutBlankSessionTabTarget(draft.input.prepared.priorSessionTabTarget) &&
		isAboutBlankSessionTabTarget(draft.observedSessionTabTarget ?? draft.currentSessionTabTarget)
	);
}

async function inspectBlankElectronMismatch(
	draft: InspectBlankElectronMismatchInput,
	observed: SessionTabTarget | undefined,
): Promise<void> {
	const { prepared, state } = draft.input;
	const record = findElectronLaunchRecordForSession(
		prepared.executionPlan.sessionName,
		state.electronLaunchRecords,
		prepared.executionPlan.namespace,
	);
	const sessionName = prepared.executionPlan.sessionName;
	if (!record || sessionName === undefined || sessionName.length === 0) {
		return;
	}
	draft.electronStatusAfterCommand = await inspectElectronLaunchStatus(record);
	draft.electronSessionMismatch = buildElectronSessionMismatch({
		managedSession: { sessionName, title: observed?.title, url: observed?.url ?? "about:blank" },
		record,
		statusTargets: draft.electronStatusAfterCommand.targets,
	});
}

export async function recoverUnexpectedBlankTarget(
	draft: RecoverUnexpectedBlankTargetInput,
): Promise<void> {
	const { prepared, cwd, signal } = draft.input;
	draft.sessionTabCorrection = prepared.sessionTabCorrection;
	const prior = prepared.priorSessionTabTarget;
	if (!unexpectedBlankTarget(draft) || !prior) {
		return;
	}
	const observed = draft.observedSessionTabTarget ?? draft.currentSessionTabTarget;
	const correction = await collectSessionTabSelection({
		cwd,
		namespace: prepared.executionPlan.namespace,
		sessionName: prepared.executionPlan.sessionName,
		signal,
		target: prior,
	});
	const applied = correction
		? await applyOpenResultTabCorrection({
				correction,
				cwd,
				namespace: prepared.executionPlan.namespace,
				sessionName: prepared.executionPlan.sessionName,
				signal,
			})
		: undefined;
	if (applied) {
		draft.sessionTabCorrection = applied;
		draft.currentSessionTabTarget = prior;
	} else {
		draft.currentSessionTabTarget = observed ?? normalizeSessionTabTarget({ url: "about:blank" });
	}
	draft.aboutBlankSessionMismatch = {
		activeUrl: "about:blank",
		recoveryApplied: applied !== undefined,
		recoveryHint: buildAboutBlankRecoveryHint(),
		targetTitle: prior.title,
		targetUrl: prior.url,
	};
	await inspectBlankElectronMismatch(draft, observed);
}

function needsPostCommandPinning(draft: NeedsPostCommandPinningInput): boolean {
	const { prepared } = draft.input;
	return (
		draft.succeeded &&
		prepared.priorSessionTabTarget !== undefined &&
		!draft.sessionTabCorrection &&
		!draft.aboutBlankSessionMismatch &&
		!commandExplicitlyTargetsAboutBlank(prepared.commandTokens) &&
		shouldCorrectSessionTabAfterCommand({
			command: prepared.executionPlan.commandInfo.command,
			pinningRequired: prepared.sessionTabPinningReason !== undefined,
			sessionName: prepared.executionPlan.sessionName,
		})
	);
}

export async function pinPostCommandTarget(draft: PinPostCommandTargetInput): Promise<void> {
	const target = draft.observedSessionTabTarget;
	if (!needsPostCommandPinning(draft) || !target) {
		return;
	}
	const { prepared, cwd, signal } = draft.input;
	const correction = await collectSessionTabSelection({
		cwd,
		namespace: prepared.executionPlan.namespace,
		sessionName: prepared.executionPlan.sessionName,
		signal,
		target,
	});
	if (!correction) {
		return;
	}
	const applied = await applyOpenResultTabCorrection({
		correction,
		cwd,
		namespace: prepared.executionPlan.namespace,
		sessionName: prepared.executionPlan.sessionName,
		signal,
	});
	// The draft is per-call and is never passed to either helper; no external writer can install a correction here.
	if (applied) {
		draft.sessionTabCorrection = applied;
	}
}

export async function inspectElectronHealth(draft: InspectElectronHealthInput): Promise<void> {
	const { prepared, state } = draft.input;
	draft.electronRecordForCommand = findElectronLaunchRecordForSession(
		prepared.executionPlan.sessionName,
		state.electronLaunchRecords,
		prepared.executionPlan.namespace,
	);
	const record = draft.electronRecordForCommand;
	if (
		!draft.succeeded ||
		!record ||
		!shouldInspectElectronPostCommandHealth(prepared.executionPlan.commandInfo.command)
	) {
		return;
	}
	draft.electronStatusAfterCommand ??= await inspectElectronLaunchStatus(record);
	draft.electronPostCommandHealth = buildElectronPostCommandHealthDiagnostic({
		command: prepared.executionPlan.commandInfo.command,
		record,
		status: draft.electronStatusAfterCommand,
		target: draft.observedSessionTabTarget ?? draft.currentSessionTabTarget,
	});
	if (
		draft.electronPostCommandHealth &&
		draft.electronPostCommandHealth.reason !== "process-dead"
	) {
		await sleepMs(draft.input.electronPostCommandStatusSettleMs);
		draft.electronStatusAfterCommand = await inspectElectronLaunchStatus(record);
		draft.electronPostCommandHealth = buildElectronPostCommandHealthDiagnostic({
			command: prepared.executionPlan.commandInfo.command,
			record,
			status: draft.electronStatusAfterCommand,
			target: draft.observedSessionTabTarget ?? draft.currentSessionTabTarget,
		});
	}
	if (draft.electronPostCommandHealth) {
		draft.succeeded = false;
	}
}
