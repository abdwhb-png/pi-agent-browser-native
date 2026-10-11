import { inspect } from "node:util";
import { isRecord } from "./parsing.js";

/** Read native errno evidence without asserting that an arbitrary caught value is an Error. */
export function normalizeProcessError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	if (typeof error === "string") {
		return new Error(error);
	}
	if (
		typeof error === "number" ||
		typeof error === "boolean" ||
		typeof error === "bigint" ||
		typeof error === "symbol" ||
		error === undefined ||
		error === null
	) {
		return new Error(String(error));
	}
	return new Error(inspect(error));
}

export function getErrorCode(error: unknown): string | undefined {
	return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}
