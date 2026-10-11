import { isRecord } from "./parsing.js";
import { isBrowserStringArray } from "./browser-value-parsing.js";
export const POLICY_LOCK_MAX_BYTES = 1_048_576;
export interface PolicyLockOwner {
	readonly sessionNames: readonly string[] | null;
	readonly pid: number;
	readonly startIdentity: string;
	readonly token: string;
	readonly version: 4;
}
export interface PolicyLockTicket {
	readonly ticket: number;
	readonly token: string;
	readonly version: 4;
}
export interface PolicyLockClaim {
	readonly owner: PolicyLockOwner;
	readonly path: string;
	readonly ticket: number | null;
}
function claimNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
function claimStartIdentity(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
function validClaimToken(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.includes("/") &&
		!value.includes("\\") &&
		!value.includes("\0")
	);
}
function claimSessionNames(value: unknown): readonly string[] | null | undefined {
	if (value === null) {
		return null;
	}
	return isBrowserStringArray(value) && value.length > 0 ? value : undefined;
}
export function parseOwner(content: string): PolicyLockOwner | undefined {
	if (Buffer.byteLength(content) > POLICY_LOCK_MAX_BYTES) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed) || parsed.version !== 4) {
			return undefined;
		}
		const pid = claimNumber(parsed.pid);
		const sessionNames = claimSessionNames(parsed.sessionNames);
		const startIdentity = claimStartIdentity(parsed.startIdentity);
		if (
			pid === undefined ||
			sessionNames === undefined ||
			startIdentity === undefined ||
			!validClaimToken(parsed.token)
		) {
			return undefined;
		}
		return { sessionNames, pid, startIdentity, token: parsed.token, version: 4 };
	} catch {
		return undefined;
	}
}
export function parseTicket(content: string, token: string): number | undefined {
	if (Buffer.byteLength(content) > POLICY_LOCK_MAX_BYTES) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed) || parsed.version !== 4 || parsed.token !== token) {
			return undefined;
		}
		return claimNumber(parsed.ticket);
	} catch {
		return undefined;
	}
}
