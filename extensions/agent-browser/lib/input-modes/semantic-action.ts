import { isRecord } from "../parsing.js";
import { getSelectValues } from "./shared.js";
import {
	AGENT_BROWSER_SEMANTIC_ACTIONS,
	AGENT_BROWSER_SEMANTIC_LOCATORS,
	type AgentBrowserSemanticActionName,
	type AgentBrowserSemanticLocator,
	type CompiledAgentBrowserSemanticAction,
} from "./types.js";

type Input = Readonly<Record<string, unknown>>;
type Compilation = { compiled?: CompiledAgentBrowserSemanticAction; error?: string };
type NonSelectAction = Exclude<AgentBrowserSemanticActionName, "select">;
type SemanticActionCommand = {
	readonly args: readonly string[];
	readonly action: AgentBrowserSemanticActionName;
};

export function getCompiledSemanticActionCommandIndex(compiled: SemanticActionCommand): number {
	return compiled.args[0] === "--session" ? 2 : 0;
}
export function getCompiledSemanticActionSessionPrefix(compiled: SemanticActionCommand): string[] {
	const commandIndex = getCompiledSemanticActionCommandIndex(compiled);
	return commandIndex > 0 ? compiled.args.slice(0, commandIndex) : [];
}
export function isCompiledSemanticActionFindCommand(
	compiled: SemanticActionCommand | undefined,
): boolean {
	return (
		compiled !== undefined &&
		compiled.action !== "select" &&
		compiled.args[getCompiledSemanticActionCommandIndex(compiled)] === "find"
	);
}

function sessionArgs(session: unknown, args: readonly string[]): string[] {
	return typeof session === "string" ? ["--session", session, ...args] : [...args];
}

function textError(action: NonSelectAction, text: unknown): string | undefined {
	if (text !== undefined && typeof text !== "string") {
		return "semanticAction.text must be a string when provided.";
	}
	if (action === "fill" && (typeof text !== "string" || text.length === 0)) {
		return `semanticAction.text is required for ${action}.`;
	}
	if (action !== "fill" && text !== undefined) {
		return "semanticAction.text is only supported for fill actions.";
	}
	return undefined;
}

function directAction(input: Input, action: NonSelectAction, selector: string): Compilation {
	if (
		input.locator !== undefined ||
		input.value !== undefined ||
		input.role !== undefined ||
		input.name !== undefined
	) {
		return {
			error:
				"semanticAction.selector cannot be combined with locator, value, role, or name; use selector for a direct click/check/fill target or locator fields for find-based actions.",
		};
	}
	const error = textError(action, input.text);
	if (error !== undefined) {
		return { error };
	}
	const args = sessionArgs(input.session, [action, selector]);
	if (action === "fill" && typeof input.text === "string") {
		args.push(input.text);
	}
	return { compiled: { action, selector, args } };
}

function roleSelect(input: Input): Compilation {
	const { role, name } = input;
	if (typeof role !== "string" || !/^(?:combobox|listbox)$/i.test(role)) {
		return { error: "semanticAction.role must be combobox or listbox for locator=role select." };
	}
	if (typeof name !== "string" || name.trim().length === 0) {
		return { error: "semanticAction.name is required for locator=role select." };
	}
	const options = getSelectValues({ value: input.value, values: input.values }, "semanticAction");
	if (options.error !== undefined) {
		return { error: options.error };
	}
	return {
		compiled: {
			action: "select",
			locator: "role",
			values: options.values,
			args: sessionArgs(input.session, [
				"find",
				"role",
				role,
				"select",
				...options.values,
				"--name",
				name,
			]),
		},
	};
}

function labelSelect(input: Input): Compilation {
	if (typeof input.value !== "string" || input.value.trim().length === 0) {
		return {
			error: "semanticAction.value must be the accessible label text for locator=label select.",
		};
	}
	if (input.role !== undefined || input.name !== undefined) {
		return { error: "semanticAction.role and name are only supported for locator=role select." };
	}
	const options = getSelectValues({ values: input.values }, "semanticAction");
	if (options.error !== undefined) {
		return {
			error: options.error.includes("required")
				? "semanticAction.values is required for locator=label select (value is the label text)."
				: options.error,
		};
	}
	return {
		compiled: {
			action: "select",
			locator: "label",
			values: options.values,
			args: sessionArgs(input.session, ["find", "label", input.value, "select", ...options.values]),
		},
	};
}

function selectAction(input: Input): Compilation {
	if (input.text !== undefined) {
		return {
			error:
				"semanticAction.text is not supported for select; use value or values for option values.",
		};
	}
	if (typeof input.selector === "string" && input.selector.trim().length > 0) {
		return directSelect(input, input.selector);
	}
	if (input.selector !== undefined) {
		return { error: "semanticAction.selector must be a non-empty string when provided." };
	}
	if (input.locator === undefined) {
		return { error: "semanticAction.selector or semanticAction.locator is required for select." };
	}
	if (input.locator !== "role" && input.locator !== "label") {
		return {
			error:
				"semanticAction select locator must be role or label; use selector plus value/values for other targets.",
		};
	}
	return input.locator === "role" ? roleSelect(input) : labelSelect(input);
}

function directSelect(input: Input, selector: string): Compilation {
	if (input.locator !== undefined || input.role !== undefined || input.name !== undefined) {
		return {
			error:
				"semanticAction.selector cannot be combined with locator, role, or name for select; use selector plus value/values, or locator fields plus values.",
		};
	}
	const options = getSelectValues(input, "semanticAction");
	if (options.error !== undefined) {
		return { error: options.error };
	}
	return {
		compiled: {
			action: "select",
			selector,
			values: options.values,
			args: sessionArgs(input.session, ["select", selector, ...options.values]),
		},
	};
}

function locatorValueError(input: Input): string | undefined {
	if (
		input.value !== undefined &&
		(typeof input.value !== "string" || input.value.trim().length === 0)
	) {
		return "semanticAction.value must be a non-empty string when provided.";
	}
	if (
		input.role !== undefined &&
		(typeof input.role !== "string" || input.role.trim().length === 0)
	) {
		return "semanticAction.role must be a non-empty string when provided.";
	}
	return undefined;
}

function roleFieldsError(input: Input, locator: AgentBrowserSemanticLocator): string | undefined {
	if (input.role !== undefined && locator !== "role") {
		return "semanticAction.role is only supported for locator=role.";
	}
	if (input.role !== undefined && input.value !== undefined && input.role !== input.value) {
		return "semanticAction.role must match value when both are provided for locator=role.";
	}
	if (
		input.name !== undefined &&
		(locator !== "role" || typeof input.name !== "string" || input.name.length === 0)
	) {
		return "semanticAction.name is only supported as a non-empty string for locator=role.";
	}
	return undefined;
}

function findAction(input: Input, action: NonSelectAction): Compilation {
	const locator = AGENT_BROWSER_SEMANTIC_LOCATORS.find((value) => value === input.locator);
	if (locator === undefined) {
		return {
			error: `semanticAction.locator must be one of: ${AGENT_BROWSER_SEMANTIC_LOCATORS.join(", ")}.`,
		};
	}
	const valueError = locatorValueError(input);
	if (valueError !== undefined) {
		return { error: valueError };
	}
	const locatorValue =
		locator === "role" && typeof input.role === "string" ? input.role : input.value;
	if (typeof locatorValue !== "string" || locatorValue.trim().length === 0) {
		return {
			error:
				locator === "role"
					? "semanticAction.value or semanticAction.role must be a non-empty string for locator=role."
					: "semanticAction.value must be a non-empty string.",
		};
	}
	const error = textError(action, input.text) ?? roleFieldsError(input, locator);
	if (error !== undefined) {
		return { error };
	}
	return {
		compiled: { action, locator, args: findActionArgs(input, { action, locator, locatorValue }) },
	};
}

function findActionArgs(
	input: Input,
	target: {
		readonly action: NonSelectAction;
		readonly locator: AgentBrowserSemanticLocator;
		readonly locatorValue: string;
	},
): string[] {
	const args = sessionArgs(input.session, [
		"find",
		target.locator,
		target.locatorValue,
		target.action,
	]);
	if (target.action === "fill" && typeof input.text === "string") {
		args.push(input.text);
	}
	if (target.locator === "role" && typeof input.name === "string") {
		args.push("--name", input.name);
	}
	return args;
}

function nonSelectAction(input: Input, action: NonSelectAction): Compilation {
	if (input.values !== undefined) {
		return { error: "semanticAction.values is only supported for select actions." };
	}
	if (input.selector === undefined) {
		return findAction(input, action);
	}
	if (typeof input.selector !== "string" || input.selector.trim().length === 0) {
		return { error: "semanticAction.selector must be a non-empty string when provided." };
	}
	return directAction(input, action, input.selector);
}

export function compileAgentBrowserSemanticAction(input: unknown): Compilation {
	if (!isRecord(input)) {
		return { error: "semanticAction must be an object." };
	}
	const action = AGENT_BROWSER_SEMANTIC_ACTIONS.find((value) => value === input.action);
	if (action === undefined) {
		return {
			error: `semanticAction.action must be one of: ${AGENT_BROWSER_SEMANTIC_ACTIONS.join(", ")}.`,
		};
	}
	if (
		input.session !== undefined &&
		(typeof input.session !== "string" || input.session.trim().length === 0)
	) {
		return { error: "semanticAction.session must be a non-empty string when provided." };
	}
	const normalized = {
		...input,
		name: typeof input.name === "string" && input.name.trim().length === 0 ? undefined : input.name,
	};
	return action === "select" ? selectAction(normalized) : nonSelectAction(normalized, action);
}
