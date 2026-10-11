import { isRecord } from "../../parsing.js";
import type { CommandInfo } from "../../argv-descriptor.js";
import type { ToolPresentation } from "../contracts.js";
import { getSavedFileDetails } from "./artifacts.js";
import { formatWebMcpCatalogUpdate } from "./common.js";
import { formatNetworkRouteDiagnosticsText } from "./diagnostics.js";
import { buildErrorPresentation } from "./errors.js";
import type { BuildToolPresentationOptions } from "./input-contracts.js";
import type { PresentationSource } from "./source.js";

type NoticeOptions = Pick<
	BuildToolPresentationOptions,
	"args" | "commandInfo" | "errorText" | "networkRouteDiagnostics" | "sessionName"
>;

function appendNotice(draft: ToolPresentation, text: string | undefined): void {
	if (text !== undefined && text.length > 0 && draft.content[0]?.type === "text") {
		draft.content[0] = { ...draft.content[0], text: `${draft.content[0].text}\n\n${text}` };
	}
}

function getKeyboardInsertTextWarning(commandInfo: CommandInfo): string | undefined {
	if (commandInfo.command !== "keyboard" || commandInfo.subcommand !== "inserttext") {
		return undefined;
	}
	return "Input dispatch warning: keyboard inserttext skips key events. A DOM value change does not prove a framework-controlled editor accepted it; verify application state before saving, or use keyboard type when real key events are required.";
}

function applyRecordingError(
	draft: ToolPresentation,
	options: NoticeOptions,
	source: PresentationSource,
): void {
	if (
		options.errorText === undefined ||
		options.errorText.length === 0 ||
		(!source.recordingCommand && !source.recordingBatch)
	) {
		return;
	}
	const failure = buildErrorPresentation({
		args: options.args,
		commandInfo: options.commandInfo,
		errorText: options.errorText,
		presentationCommand: source.presentationCommandInfo.command,
		sessionName: options.sessionName,
	});
	draft.resultCategory = "failure";
	draft.failureCategory = failure.failureCategory;
	draft.summary = failure.summary;
	draft.content = [
		{
			type: "text",
			text: `${failure.content[0]?.type === "text" ? failure.content[0].text : options.errorText}\n\n${draft.content[0]?.type === "text" ? draft.content[0].text : ""}`,
		},
	];
}

function applyNetworkNotices(draft: ToolPresentation, options: NoticeOptions): void {
	const diagnostics = options.networkRouteDiagnostics;
	if (diagnostics && diagnostics.length > 0 && draft.content[0]?.type === "text") {
		const text = formatNetworkRouteDiagnosticsText(diagnostics);
		if (text !== undefined && text.length > 0) {
			draft.content[0] = { ...draft.content[0], text: `${text}\n\n${draft.content[0].text}` };
		}
		draft.networkRouteDiagnostics = diagnostics;
	}
}

function applySavedFile(
	draft: ToolPresentation,
	source: PresentationSource,
	commandInfo: CommandInfo,
): void {
	if (!isRecord(source.data)) {
		return;
	}
	const savedFile = getSavedFileDetails(commandInfo, source.data);
	if (savedFile) {
		draft.savedFile = savedFile;
		draft.savedFilePath = savedFile.path;
	}
}

export function applyPresentationNotices(
	draft: ToolPresentation,
	options: NoticeOptions,
	source: PresentationSource,
): void {
	applyRecordingError(draft, options, source);
	applyNetworkNotices(draft, options);
	applySavedFile(draft, source, options.commandInfo);
	const data = source.presentationData;
	if (
		isRecord(data) &&
		isRecord(data.webmcp) &&
		(Array.isArray(data.webmcp.tools) || data.webmcp.status === "unavailable")
	) {
		appendNotice(draft, formatWebMcpCatalogUpdate(data.webmcp));
	}
	if (
		options.commandInfo.command === "screenshot" &&
		(options.args?.includes("--annotate") ?? false)
	) {
		appendNotice(
			draft,
			"Annotated screenshot note: dense pages can produce overlapping labels. If the labels are noisy, capture a scoped element screenshot, take a non-annotated screenshot, or use snapshot -i high-value refs as the machine-readable map.",
		);
	}
	appendNotice(draft, getKeyboardInsertTextWarning(source.commandInfo));
}
