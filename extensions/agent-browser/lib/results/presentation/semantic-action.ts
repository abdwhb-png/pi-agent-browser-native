import {
	getCompiledSemanticActionCommandIndex,
	isCompiledSemanticActionFindCommand,
} from "../../input-modes/semantic-action.js";
import type { CompiledAgentBrowserSemanticAction } from "../../input-modes/types.js";
import { isRecord } from "../../parsing.js";
import type { CommandInfo } from "../../argv-descriptor.js";
import {
	formatNavigationSummary,
	getNavigationSummary,
	isNavigationObservableCommand,
} from "./navigation.js";
import { getPageSummary, redactModelFacingText } from "./common.js";

const SEMANTIC_NAVIGATION_PROBE_ACTIONS = new Set(["check", "click"]);

const SEMANTIC_PRESENTATION_ACTIONS = new Set(["check", "click", "fill", "select"]);

function formatSemanticSelectTarget(compiled: CompiledAgentBrowserSemanticAction): string {
	const selector = compiled.selector ?? "selector";
	const values =
		compiled.values !== undefined && compiled.values.length > 0 ? compiled.values.join(", ") : "";
	return values.length > 0 ? `${selector} → ${values}` : selector;
}

function formatSemanticActionTarget(compiled: CompiledAgentBrowserSemanticAction): string {
	if (compiled.action === "select") {
		return formatSemanticSelectTarget(compiled);
	}
	const commandIndex = getCompiledSemanticActionCommandIndex(compiled);
	const locator = compiled.locator ?? compiled.args.at(commandIndex + 1) ?? "locator";
	const locatorValue = compiled.args.at(commandIndex + 2);
	const nameIndex = compiled.args.indexOf("--name");
	const name = nameIndex >= 0 ? compiled.args.at(nameIndex + 1) : undefined;
	const quotedValue = JSON.stringify(locatorValue ?? "");
	const target = `${locator} ${quotedValue}`;
	return name !== undefined && name.length > 0
		? `${target} (name ${JSON.stringify(name)})`
		: target;
}

function formatSemanticActionCompactLine(compiled: CompiledAgentBrowserSemanticAction): string {
	const target = formatSemanticActionTarget(compiled);
	switch (compiled.action) {
		case "click":
			return `Clicked: ${target}`;
		case "fill":
			return `Filled: ${target}`;
		case "check":
			return `Checked: ${target}`;
		case "select":
			return `Selected: ${target}`;
	}
}

function resolveSemanticPresentationCommand(
	compiled: CompiledAgentBrowserSemanticAction | undefined,
): string | undefined {
	if (!compiled || !SEMANTIC_PRESENTATION_ACTIONS.has(compiled.action)) {
		return undefined;
	}
	if (compiled.action === "select") {
		return "select";
	}
	if (isCompiledSemanticActionFindCommand(compiled)) {
		return compiled.action;
	}
	return undefined;
}

export function resolvePresentationCommandInfo(
	commandInfo: CommandInfo,
	compiledSemanticAction?: CompiledAgentBrowserSemanticAction,
): CommandInfo {
	const presentationCommand = resolveSemanticPresentationCommand(compiledSemanticAction);
	if (presentationCommand === undefined) {
		return commandInfo;
	}
	return { ...commandInfo, command: presentationCommand };
}

export function shouldCaptureSemanticActionNavigationSummary(
	compiled: CompiledAgentBrowserSemanticAction | undefined,
	data: unknown,
): boolean {
	if (!compiled || !SEMANTIC_NAVIGATION_PROBE_ACTIONS.has(compiled.action)) {
		return false;
	}
	if (!isCompiledSemanticActionFindCommand(compiled)) {
		return false;
	}
	return !isRecord(data) || (typeof data.title !== "string" && typeof data.url !== "string");
}

export function formatSemanticActionPresentationText(
	compiled: CompiledAgentBrowserSemanticAction,
	data: Readonly<Record<string, unknown>>,
): string | undefined {
	const presentationCommand = resolveSemanticPresentationCommand(compiled);
	if (presentationCommand === undefined) {
		return undefined;
	}

	const actionLine = formatSemanticActionCompactLine(compiled);
	const navigationSummary = getNavigationSummary(data);
	if (navigationSummary && isNavigationObservableCommand(presentationCommand)) {
		const navigationText = formatNavigationSummary(navigationSummary);
		if (navigationText !== undefined && navigationText.length > 0) {
			return `${actionLine}\n\nCurrent page:\n${navigationText}`;
		}
	}

	const pageSummary = getPageSummary(data);
	if (pageSummary !== undefined && pageSummary.length > 0) {
		return `${actionLine}\n\nCurrent page:\n${redactModelFacingText(pageSummary)}`;
	}

	return actionLine;
}

export function formatSemanticActionPresentationSummary(
	compiled: CompiledAgentBrowserSemanticAction,
	data: Readonly<Record<string, unknown>>,
): string | undefined {
	const presentationCommand = resolveSemanticPresentationCommand(compiled);
	if (presentationCommand === undefined) {
		return undefined;
	}

	const navigationSummary = getNavigationSummary(data);
	if (navigationSummary && isNavigationObservableCommand(presentationCommand)) {
		const navigationText = formatNavigationSummary(navigationSummary);
		if (navigationText !== undefined && navigationText.length > 0) {
			return `${presentationCommand} → ${navigationText.split("\n", 1)[0] ?? navigationText}`;
		}
	}

	const pageSummary = getPageSummary(data);
	if (pageSummary !== undefined && pageSummary.length > 0) {
		return `${presentationCommand} → ${pageSummary.split("\n", 1)[0] ?? pageSummary}`;
	}

	return `${presentationCommand} → ${formatSemanticActionTarget(compiled)}`;
}
