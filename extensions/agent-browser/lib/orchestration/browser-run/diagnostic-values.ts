import { isRecord } from "../../parsing.js";
import { stringifyUnknown } from "../../results/text.js";

export function diagnosticResultRecord(
	data: unknown,
): Readonly<Record<string, unknown>> | undefined {
	const result = isRecord(data) && isRecord(data.result) ? data.result : data;
	return isRecord(result) ? result : undefined;
}

export function rawStringField(
	data: Readonly<Record<string, unknown>>,
	field: string,
): string | undefined {
	const value = data[field];
	return typeof value === "string" ? value : undefined;
}

export function rawNumberField(
	data: Readonly<Record<string, unknown>>,
	field: string,
): number | undefined {
	const value = data[field];
	return typeof value === "number" ? value : undefined;
}

export function diagnosticErrorText(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	switch (typeof error) {
		case "object":
			return error === null ? "null" : stringifyUnknown(error);
		case "string":
		case "number":
		case "bigint":
		case "boolean":
		case "undefined":
		case "symbol":
		case "function":
			return String(error);
	}
}
