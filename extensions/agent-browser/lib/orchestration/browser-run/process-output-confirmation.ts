import type { PreparedBrowserRun, BrowserRunState } from "./types.js";
import type { NativeOutputPhase } from "./process-output-native-phase-contracts.js";
import type { PageOutputPhase } from "./process-output-page-phase-contracts.js";
import type { LifecycleOutputPhase } from "./process-output-lifecycle-phase-contracts.js";
import { isStringArray } from "../../results/presentation/content.js";
import { getAgentBrowserSessionIdentityKey } from "../../argv-grammar.js";
import { isCloseCommand } from "../../command-taxonomy.js";
import { isRecord } from "../../parsing.js";
import { detectConfirmationRequired } from "../../results/confirmation.js";
import type { AgentBrowserEnvelope } from "../../results/contracts.js";
import {
	isSuccessfulNativeConfirmedClose,
	nextReadConfirmation,
	parseReadConfirmation,
	type ReadConfirmation,
} from "../../read-confirmation.js";

type ConfirmationRowsInput = Readonly<
	Pick<NativeOutputPhase, "batchCommandSteps" | "presentationEnvelope">
> & {
	readonly input: {
		readonly prepared: Readonly<Pick<PreparedBrowserRun, "commandTokens" | "executionPlan">>;
	};
};
type MatchingGuardedConfirmationInput = Readonly<Pick<NativeOutputPhase, "readConfirmation">>;
type RecordConfirmedEffectInput = Readonly<Pick<NativeOutputPhase, "readConfirmation">> &
	Pick<NativeOutputPhase, "confirmedEffects">;
type ApplyConfirmedFailureInput = Pick<NativeOutputPhase, "presentationEnvelope">;
type FoldReadConfirmationsInput = Readonly<Pick<NativeOutputPhase, "batchCommandSteps">> &
	Pick<
		NativeOutputPhase,
		| "confirmedEffects"
		| "confirmedCommand"
		| "confirmedData"
		| "directClose"
		| "presentationEnvelope"
		| "readConfirmation"
		| "readConfirmationEvent"
	> & {
		readonly input: {
			readonly prepared: Readonly<Pick<PreparedBrowserRun, "commandTokens" | "executionPlan">>;
			readonly state: BrowserRunState;
		};
	};
type ObserveHelperConfirmationInput = Pick<
	PageOutputPhase,
	"confirmationFromHelper" | "readConfirmation" | "readConfirmationEvent" | "succeeded"
> & { readonly input: { readonly state: BrowserRunState } };
type ObserveFinalHelperConfirmationInput = Pick<
	LifecycleOutputPhase,
	"confirmationFromHelper" | "readConfirmationEvent" | "succeeded"
> & { readonly input: { readonly state: BrowserRunState } };
type ObserveDirectConfirmationEffectInput = Readonly<
	Pick<NativeOutputPhase, "confirmedEffects" | "presentationEnvelope" | "readConfirmationEvent">
> &
	Pick<NativeOutputPhase, "confirmedCommand" | "confirmedData" | "directClose"> & {
		readonly input: {
			readonly prepared: Readonly<Pick<PreparedBrowserRun, "commandTokens" | "executionPlan">>;
			readonly state: BrowserRunState;
		};
	};

interface ConfirmationRow {
	readonly tokens: readonly string[];
	readonly data: unknown;
	readonly index: number;
	readonly response: AgentBrowserEnvelope | Readonly<Record<string, unknown>> | undefined;
	readonly succeeded: boolean;
}

function confirmationRows(draft: ConfirmationRowsInput): ConfirmationRow[] {
	const { prepared } = draft.input;
	if (
		prepared.executionPlan.commandInfo.command !== "batch" ||
		!Array.isArray(draft.presentationEnvelope?.data)
	) {
		return [
			{
				tokens: prepared.commandTokens,
				data: draft.presentationEnvelope?.data,
				index: 0,
				response: draft.presentationEnvelope,
				succeeded: draft.presentationEnvelope?.success === true,
			},
		];
	}
	return draft.presentationEnvelope.data.flatMap((row, index) => {
		if (!isRecord(row)) {
			return [];
		}
		const tokens = isStringArray(row.command)
			? row.command
			: (draft.batchCommandSteps[index] ?? []);
		return [{ tokens, data: row.result, index, response: row, succeeded: row.success === true }];
	});
}

function matchesConfirmationDecision(row: ConfirmationRow, id: string): boolean {
	return row.tokens.length === 2 && row.tokens[0] === "confirm" && row.tokens[1] === id;
}

function matchingGuardedConfirmation(
	draft: MatchingGuardedConfirmationInput,
	row: ConfirmationRow,
): ReadConfirmation | undefined {
	const current = draft.readConfirmation;
	if (
		current?.state !== "pending" ||
		current.source !== "native-guarded-action" ||
		typeof current.command !== "string"
	) {
		return;
	}
	if (!matchesConfirmationDecision(row, current.id)) {
		return;
	}
	if (!isRecord(row.data) || row.data.confirmed !== true || row.data.action !== current.action) {
		return;
	}
	return current;
}

function recordConfirmedEffect(draft: RecordConfirmedEffectInput, row: ConfirmationRow): void {
	const current = matchingGuardedConfirmation(draft, row);
	if (!current || typeof current.command !== "string" || !isRecord(row.data)) {
		return;
	}
	if (!isRecord(row.data.result) || detectConfirmationRequired(row.data)) {
		return;
	}
	draft.confirmedEffects = [
		...draft.confirmedEffects,
		{
			command: current.command,
			data: row.data.result.data,
			index: row.index,
			succeeded: row.succeeded && row.data.result.success === true,
		},
	];
}

function applyConfirmedFailure(draft: ApplyConfirmedFailureInput, row: ConfirmationRow): void {
	if (row.tokens.length !== 2 || row.tokens[0] !== "confirm" || !isRecord(row.data)) {
		return;
	}
	if (
		row.data.confirmed !== true ||
		!isRecord(row.data.result) ||
		row.data.result.success !== false
	) {
		return;
	}
	draft.presentationEnvelope = failedConfirmationEnvelope(
		draft.presentationEnvelope,
		row.response,
		row.data.result.error,
	);
}

function failedConfirmationEnvelope(
	envelope: AgentBrowserEnvelope | undefined,
	response: ConfirmationRow["response"],
	error: unknown,
): AgentBrowserEnvelope | undefined {
	if (!envelope || !response) {
		return envelope;
	}
	if (response === envelope) {
		return { ...envelope, success: false, error };
	}
	const data: unknown = envelope.data;
	if (!Array.isArray(data)) {
		return envelope;
	}
	const rows: unknown[] = [];
	for (const item of data) {
		rows.push(item === response ? { ...response, success: false, error } : item);
	}
	return { ...envelope, success: false, data: rows };
}

export function foldReadConfirmations(draft: FoldReadConfirmationsInput): void {
	const { prepared, state } = draft.input;
	const sessionName = prepared.executionPlan.sessionName ?? "default";
	draft.readConfirmation = state.sessionPageState.getReadConfirmation(
		getAgentBrowserSessionIdentityKey(sessionName, prepared.executionPlan.namespace),
	);
	for (const row of confirmationRows(draft)) {
		recordConfirmedEffect(draft, row);
		const transition = nextReadConfirmation({
			commandTokens: row.tokens,
			current: draft.readConfirmation,
			data: row.data,
			namespace: prepared.executionPlan.namespace,
			sessionName,
			succeeded: row.succeeded,
		});
		if (transition) {
			draft.readConfirmationEvent = transition;
			draft.readConfirmation = transition;
		}
		applyConfirmedFailure(draft, row);
	}
	observeDirectConfirmationEffect(draft);
}

export function observeHelperConfirmation(draft: ObserveHelperConfirmationInput): void {
	const helperConfirmation = parseReadConfirmation(
		draft.input.state.observedBrowserEffects?.readConfirmation,
	);
	// Main pending installs this object; helpers can replace it while their awaits are pending.
	draft.confirmationFromHelper =
		draft.input.state.observedBrowserEffects?.readConfirmation !== draft.readConfirmationEvent;
	if (draft.confirmationFromHelper && helperConfirmation?.state === "pending") {
		draft.readConfirmationEvent = helperConfirmation;
		draft.readConfirmation = helperConfirmation;
		draft.succeeded = false;
	}
}

export function observeFinalHelperConfirmation(draft: ObserveFinalHelperConfirmationInput): void {
	const finalHelperConfirmation = parseReadConfirmation(
		draft.input.state.observedBrowserEffects?.readConfirmation,
	);
	if (finalHelperConfirmation?.state === "pending") {
		draft.confirmationFromHelper ||=
			draft.input.state.observedBrowserEffects?.readConfirmation !== draft.readConfirmationEvent;
		draft.readConfirmationEvent = finalHelperConfirmation;
		draft.succeeded = false;
	}
}

function observeDirectConfirmationEffect(draft: ObserveDirectConfirmationEffectInput): void {
	const { prepared, state } = draft.input;
	draft.confirmedData =
		prepared.commandTokens[0] === "confirm" ? draft.confirmedEffects[0]?.data : undefined;
	draft.confirmedCommand =
		prepared.commandTokens[0] === "confirm" ? draft.confirmedEffects[0]?.command : undefined;
	draft.directClose =
		isCloseCommand(prepared.executionPlan.commandInfo.command) ||
		isSuccessfulNativeConfirmedClose(prepared.commandTokens, draft.presentationEnvelope?.data);
	if (draft.readConfirmationEvent?.state === "pending") {
		state.observedBrowserEffects = {
			...state.observedBrowserEffects,
			readConfirmation: draft.readConfirmationEvent,
		};
	}
}
