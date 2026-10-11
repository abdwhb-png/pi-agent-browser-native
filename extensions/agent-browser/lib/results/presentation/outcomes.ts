import { buildReadConfirmationNextActions } from "../../read-confirmation.js";
import { buildAgentBrowserNextActions } from "../action-recommendations.js";
import { buildAgentBrowserResultCategoryDetails } from "../categories.js";
import type { AgentBrowserNextAction, ToolPresentation } from "../contracts.js";
import {
	classifyPresentationSuccessCategory,
	formatMissingArtifactFailureText,
	hasMissingFileArtifact,
} from "./artifacts.js";
import { buildNetworkRequestsNextActions, buildStreamNextActions } from "./diagnostics.js";
import { isOverlayBlockedClickError } from "./errors.js";
import type { BuildToolPresentationOptions } from "./input-contracts.js";
import { buildPageChangeSummary } from "./navigation.js";
import type { PresentationSource } from "./source.js";
import type { ToolPresentationObservation } from "./observation-contracts.js";

type OutcomeOptions = Pick<
	BuildToolPresentationOptions,
	"args" | "envelope" | "errorText" | "modelVisible" | "sessionName"
>;

function markFailure(
	draft: ToolPresentation,
	category: "artifact-missing" | "upstream-error",
	text: string,
	prepend: boolean,
): void {
	draft.resultCategory = "failure";
	draft.failureCategory = category;
	draft.successCategory = undefined;
	draft.summary = text;
	if (!prepend && draft.content[0]?.type === "text") {
		draft.content[0] = { ...draft.content[0], text: `${text}\n\n${draft.content[0].text}` };
	} else {
		draft.content.unshift({ type: "text", text });
	}
}

function applyArtifactFailures(draft: ToolPresentation, options: OutcomeOptions): void {
	const missing = formatMissingArtifactFailureText(draft.artifacts);
	const hasError = options.errorText !== undefined && options.errorText.length > 0;
	if (hasError) {
		return;
	}
	if (missing !== undefined && missing.length > 0 && hasMissingFileArtifact(draft.artifacts)) {
		markFailure(draft, "artifact-missing", missing, false);
	}
	const recording = draft.artifacts?.find(
		(artifact) =>
			artifact.recording?.success === false ||
			artifact.recording?.output.encoderSucceeded === false,
	);
	if (recording) {
		markFailure(
			draft,
			"upstream-error",
			`Recording failed: ${recording.recording?.error ?? "native capture/encoder failure"}`,
			true,
		);
	}
}

function classifyOutcome(
	draft: ToolPresentation,
	options: OutcomeOptions,
	source: PresentationSource,
): void {
	if (source.readConfirmation?.state === "pending") {
		draft.readConfirmation = source.readConfirmation;
		draft.resultCategory = "failure";
		draft.failureCategory = "confirmation-required";
		draft.successCategory = undefined;
	}
	if (draft.resultCategory === undefined) {
		const categories = buildAgentBrowserResultCategoryDetails({
			artifacts: draft.artifacts,
			command: source.presentationCommandInfo.command,
			confirmationRequired: source.confirmationRequired !== undefined,
			errorText: options.envelope?.success === false ? draft.summary : undefined,
			savedFile: draft.savedFile,
			succeeded: options.envelope?.success !== false && source.confirmationRequired === undefined,
		});
		draft.resultCategory = categories.resultCategory;
		draft.successCategory = categories.successCategory;
		draft.failureCategory = categories.failureCategory;
	}
	if (draft.resultCategory === "success") {
		draft.successCategory = classifyPresentationSuccessCategory({
			artifactVerification: draft.artifactVerification,
			artifacts: draft.artifacts,
			savedFile: draft.savedFile,
		});
	}
}

function getGenericNextActions(
	draft: ToolPresentationObservation,
	options: OutcomeOptions,
	source: PresentationSource,
): readonly AgentBrowserNextAction[] | undefined {
	if (draft.nextActions) {
		return undefined;
	}
	return buildAgentBrowserNextActions({
		artifacts: draft.artifacts,
		args: options.args,
		command: source.presentationCommandInfo.command,
		confirmationId: source.confirmationRequired?.id,
		failureCategory: draft.failureCategory,
		overlayBlockedClick: isOverlayBlockedClickError(
			source.presentationCommandInfo.command,
			options.envelope?.success === false ? draft.summary : undefined,
			options.args ?? source.presentationCommandInfo.commandTokens,
		),
		resultCategory: draft.resultCategory ?? "success",
		savedFilePath: draft.savedFilePath,
		sessionName: options.sessionName,
		subcommand: source.presentationCommandInfo.subcommand,
		successCategory: draft.successCategory,
	});
}

function applyNextActions(
	draft: ToolPresentation,
	options: OutcomeOptions,
	source: PresentationSource,
): void {
	const generic = getGenericNextActions(draft, options, source);
	const network =
		source.commandInfo.command === "network" &&
		source.commandInfo.subcommand === "requests" &&
		draft.resultCategory === "success"
			? buildNetworkRequestsNextActions(
					source.data,
					options.sessionName,
					draft.networkRouteDiagnostics,
				)
			: undefined;
	const stream =
		draft.resultCategory === "success"
			? buildStreamNextActions(source.commandInfo, source.data, options.sessionName)
			: undefined;
	const merged = [draft.nextActions, generic, network, stream].flatMap((group) => group ?? []);
	const fallback = merged.length > 0 ? merged : undefined;
	draft.nextActions = source.readConfirmation
		? buildReadConfirmationNextActions(source.readConfirmation, true)
		: fallback;
}

export function applyPresentationOutcome(
	draft: ToolPresentation,
	options: OutcomeOptions,
	source: PresentationSource,
): void {
	applyArtifactFailures(draft, options);
	classifyOutcome(draft, options, source);
	applyNextActions(draft, options, source);
	draft.pageChangeSummary ??= buildPageChangeSummary({
		artifacts: draft.artifacts,
		commandInfo: source.presentationCommandInfo,
		data: source.data,
		nextActions: draft.nextActions,
		savedFilePath: draft.savedFilePath,
		summary: draft.summary,
	});
	if (
		draft.pageChangeSummary?.observed === false &&
		source.presentationCommandInfo.command !== "batch" &&
		draft.content[0]?.type === "text"
	) {
		draft.content[0] = {
			...draft.content[0],
			text: `${draft.content[0].text}\n\nAction dispatched; application change unverified. Verify the expected URL, text, state, or external receipt before relying on it.`,
		};
	}
	if (options.modelVisible === false) {
		draft.content = [];
	}
}
