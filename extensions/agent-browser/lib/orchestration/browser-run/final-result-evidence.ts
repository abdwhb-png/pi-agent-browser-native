import { isRecord } from "../../parsing.js";
import type {
	PublicationInput as FinalResultInput,
	PublicationLifecycle as AgentBrowserLifecycle,
	PublicationWindow as AgentBrowserWindow,
} from "./final-result-contracts.js";

type ReadEvidenceInput = Pick<
	FinalResultInput,
	"executionPlan" | "presentationEnvelope" | "processResult" | "managedSessionOutcome"
>;

export function getReadSource(
	options: Pick<ReadEvidenceInput, "executionPlan" | "presentationEnvelope">,
): string | undefined {
	return options.executionPlan.commandInfo.command === "read" &&
		isRecord(options.presentationEnvelope?.data) &&
		typeof options.presentationEnvelope.data.source === "string"
		? options.presentationEnvelope.data.source
		: undefined;
}

export function formatReadExecutionText(
	options: ReadEvidenceInput,
	lifecycle: AgentBrowserLifecycle | undefined,
): string | undefined {
	const source = getReadSource(options);
	if (source === undefined || source.length === 0) {
		return undefined;
	}
	return `Read execution: source ${source}; CLI started: ${options.processResult.agentBrowserStarted ? "yes" : "no"}; reported browserLaunched: ${lifecycle ? String(lifecycle.effectiveLaunch.browserLaunched) : "unknown"}; managed session outcome: ${options.managedSessionOutcome?.status ?? "not managed"}. An HTTP read does not establish shared-browser liveness; use session info for that.`;
}

function requestedOwnedHeadedWindow(
	options: Pick<
		FinalResultInput,
		"headedLaunch" | "preserveAttachedBrowserSession" | "providerLaunch" | "succeeded"
	>,
): boolean {
	return (
		options.headedLaunch &&
		!options.preserveAttachedBrowserSession &&
		!options.providerLaunch &&
		options.succeeded
	);
}

export function buildBrowserWindowStatus(
	options: Pick<
		FinalResultInput,
		| "headedLaunch"
		| "preserveAttachedBrowserSession"
		| "providerLaunch"
		| "succeeded"
		| "executionPlan"
		| "managedSessionOutcome"
	>,
	lifecycle: AgentBrowserLifecycle | undefined,
): AgentBrowserWindow | undefined {
	if (!requestedOwnedHeadedWindow(options) || lifecycle?.effectiveLaunch.browserLaunched !== true) {
		return undefined;
	}
	const sessionName = options.executionPlan.managedSessionName;
	if (
		sessionName === undefined ||
		sessionName.length === 0 ||
		!options.managedSessionOutcome ||
		!["created", "replaced"].includes(options.managedSessionOutcome.status)
	) {
		return undefined;
	}
	return { mode: "headed", ownership: "wrapper-managed", sessionName, visibility: "unverified" };
}

export function formatBrowserWindowText(
	browserWindow: AgentBrowserWindow | undefined,
): string | undefined {
	return browserWindow
		? "Headed browser handoff: wrapper-managed headed window requested; desktop visibility unverified. If login is needed, ask the user to confirm they can see the window and finish signing in there, then continue with sessionMode auto."
		: undefined;
}
