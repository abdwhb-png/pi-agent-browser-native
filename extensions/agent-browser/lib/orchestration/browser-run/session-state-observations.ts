import { isNavigationObservableCommandName } from "../../command-taxonomy.js";
import { isRecord } from "../../parsing.js";
import type { AboutBlankSessionMismatch, NavigationSummary } from "./types.js";

export function extractStringResultField(
	data: unknown,
	fieldName: "result" | "title" | "url" | "value",
): string | undefined {
	if (typeof data === "string") {
		if (fieldName === "value") {
			return data;
		}
		const text = data.trim();
		return text.length > 0 ? text : undefined;
	}
	if (!isRecord(data) || typeof data[fieldName] !== "string") {
		return;
	}
	if (fieldName === "value") {
		return data[fieldName];
	}
	const text = data[fieldName].trim();
	return text.length > 0 ? text : undefined;
}

export function extractNavigationSummaryFromData(data: unknown): NavigationSummary | undefined {
	const result = isRecord(data) && isRecord(data.result) ? data.result : data;
	const title = extractStringResultField(result, "title");
	const url = extractStringResultField(result, "url");
	const urlChanged =
		isRecord(result) && typeof result.urlChanged === "boolean" ? result.urlChanged : undefined;
	return Boolean(title) || Boolean(url) ? { title, url, urlChanged } : undefined;
}

function isConfirmedNavigationWithoutUrl(data: unknown): boolean {
	return (
		isRecord(data) &&
		data.confirmed === true &&
		data.action === "navigate" &&
		isRecord(data.result) &&
		data.result.success === true &&
		extractStringResultField(data.result.data, "url") === undefined
	);
}

export function shouldCaptureNavigationSummary(
	command: string | undefined,
	data: unknown,
	subcommand?: string,
): boolean {
	if (command === "eval") {
		return true;
	}
	// A completed compound action may navigate without returning a URL (e.g. recording restart).
	if (command === "confirm" && isConfirmedNavigationWithoutUrl(data)) {
		return true;
	}
	return (
		isNavigationObservableCommandName(command, subcommand) &&
		(!isRecord(data) || (typeof data.title !== "string" && typeof data.url !== "string"))
	);
}

export function mergeNavigationSummaryIntoData(
	data: unknown,
	navigationSummary: NavigationSummary,
): unknown {
	return isRecord(data) ? { ...data, navigationSummary } : { navigationSummary, result: data };
}

export function buildAboutBlankRecoveryHint(): string {
	return "agent_browser detected that the active tab became about:blank while this session still had a prior intended tab. Run tab list for this session and re-select the intended tab, or retry with sessionMode=fresh if the tab is gone.";
}

export function buildAboutBlankWarning(mismatch: AboutBlankSessionMismatch): string {
	return `Warning: agent_browser detected that this session returned about:blank while the prior intended tab was ${mismatch.targetUrl}. ${mismatch.recoveryApplied ? "The wrapper re-selected the intended tab for the session." : "No matching tab could be re-selected; run tab list for the same session or retry with sessionMode=fresh."}`;
}

export function extractBatchResultCommand(item: Readonly<Record<string, unknown>>): string[] {
	if (!Array.isArray(item.command)) {
		return [];
	}
	const tokens: readonly unknown[] = item.command;
	return tokens.filter((token): token is string => typeof token === "string");
}
