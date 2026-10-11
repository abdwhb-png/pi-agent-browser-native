import { isRecord } from "../parsing.js";
import {
	SOURCE_LOOKUP_DEFAULT_MAX_WORKSPACE_FILES,
	SOURCE_LOOKUP_MAX_WORKSPACE_FILES,
} from "./types.js";

function isString(value: unknown): value is string {
	return typeof value === "string";
}

export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isString);
}

export function getSelectValues(
	input: Readonly<Record<string, unknown>>,
	context: string,
): { values: string[]; error?: never } | { values?: never; error: string } {
	const rawValue = input.value;
	const rawValues = input.values;
	if (rawValue !== undefined && rawValues !== undefined) {
		return { error: `${context}.value and ${context}.values cannot both be provided for select.` };
	}
	if (rawValues !== undefined) {
		if (
			!isStringArray(rawValues) ||
			rawValues.length === 0 ||
			rawValues.some((value) => value.trim().length === 0)
		) {
			return {
				error: `${context}.values must be a non-empty array of non-empty strings for select.`,
			};
		}
		return { values: rawValues };
	}
	if (typeof rawValue === "string" && rawValue.trim().length > 0) {
		return { values: [rawValue] };
	}
	return { error: `${context}.value or ${context}.values is required for select.` };
}

export function getBatchResultItems(data: unknown): Array<Record<string, unknown>> {
	return Array.isArray(data) ? data.filter(isRecord) : [];
}

export function getCommandNameFromBatchItem(
	item: Readonly<Record<string, unknown>>,
): string | undefined {
	const command = item.command;
	return Array.isArray(command) && typeof command[0] === "string" ? command[0] : undefined;
}

export function validateLookupMaxWorkspaceFiles(
	value: unknown,
	fieldName: string,
): { value: number; error?: never } | { value?: never; error: string } {
	if (value === undefined) {
		return { value: SOURCE_LOOKUP_DEFAULT_MAX_WORKSPACE_FILES };
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		return { error: `${fieldName} must be a positive integer when provided.` };
	}
	if (value > SOURCE_LOOKUP_MAX_WORKSPACE_FILES) {
		return { error: `${fieldName} must be ${SOURCE_LOOKUP_MAX_WORKSPACE_FILES} or less.` };
	}
	return { value };
}
