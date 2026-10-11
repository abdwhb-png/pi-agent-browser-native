import { isRecord } from "./parsing.js";
import { isBrowserStringArray } from "./browser-value-parsing.js";
import { isSessionArtifactManifest } from "./results/artifact-manifest.js";
import {
	normalizeSessionTabTarget,
	type SessionRefSnapshot,
	type SessionRefSnapshotInvalidation,
	type SessionTabTarget,
} from "./session-page-observation.js";
import type {
	BrowserEvent,
	BrowserPageChange,
	BrowserRefDisposition,
	BrowserArtifactChanges,
	BrowserSnapshotReference,
} from "./browser-transcript-contracts.js";

function validRefText(value: Readonly<Record<string, unknown>>): boolean {
	return (
		(value.role === undefined || typeof value.role === "string") &&
		(value.name === undefined || typeof value.name === "string")
	);
}
function validRefFlags(value: Readonly<Record<string, unknown>>): boolean {
	return (
		(value.isEditable === undefined || typeof value.isEditable === "boolean") &&
		(value.isContentEditable === undefined || typeof value.isContentEditable === "boolean")
	);
}
export function isBrowserSnapshotReference(value: unknown): value is BrowserSnapshotReference {
	return isRecord(value) && validRefText(value) && validRefFlags(value);
}
export function isNamedBrowserSnapshotReference(
	value: unknown,
): value is NonNullable<SessionRefSnapshot["refs"]>[string] {
	return (
		isBrowserSnapshotReference(value) &&
		typeof value.name === "string" &&
		typeof value.role === "string"
	);
}

function invalidEvent(): never {
	throw new Error(
		"Invalid browser event; inspect or convert the retained session before browser work.",
	);
}
function invalidPage(): never {
	throw new Error("Invalid browser page disposition; refs cannot be restored.");
}
function parseInvalidation(value: unknown): SessionRefSnapshotInvalidation | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (
		!isRecord(value) ||
		(value.reason !== "page-transition" && value.reason !== "no-active-page") ||
		typeof value.summary !== "string"
	) {
		return invalidPage();
	}
	return { ...value, reason: value.reason, summary: value.summary };
}
function parseRefs(value: unknown): BrowserRefDisposition {
	if (!isRecord(value)) {
		return invalidPage();
	}
	if (value.kind === "reuse" || value.kind === "replace") {
		if (typeof value.snapshotId !== "string" || value.snapshotId.length === 0) {
			return invalidPage();
		}
		return { ...value, kind: value.kind, snapshotId: value.snapshotId };
	}
	if (value.kind !== "unknown" && value.kind !== "invalidate") {
		return invalidPage();
	}
	const invalidation = parseInvalidation(value.invalidation);
	return { ...value, kind: value.kind, ...(invalidation ? { invalidation } : {}) };
}
export function decodeBrowserTarget(value: unknown): SessionTabTarget | undefined {
	if (!isRecord(value) || typeof value.url !== "string") {
		return undefined;
	}
	if (
		(value.title !== undefined && typeof value.title !== "string") ||
		(value.targetId !== undefined && typeof value.targetId !== "string")
	) {
		return undefined;
	}
	const target = { ...value, url: value.url };
	return normalizeSessionTabTarget(target) === undefined ? undefined : target;
}
function parseBrowserTarget(value: unknown): SessionTabTarget | undefined {
	if (value === undefined) {
		return undefined;
	}
	return decodeBrowserTarget(value) ?? invalidPage();
}
function pageScalarsValid(value: Readonly<Record<string, unknown>>): boolean {
	return (
		(value.confirmActions === undefined ||
			value.confirmActions === null ||
			typeof value.confirmActions === "string") &&
		(value.unknown === undefined || value.unknown === true) &&
		(value.clear === undefined || value.clear === true)
	);
}
function pagePolicyValid(value: Readonly<Record<string, unknown>>): boolean {
	return (
		(value.reopenPending === undefined || typeof value.reopenPending === "boolean") &&
		(value.pinningReason === undefined ||
			value.pinningReason === "restore" ||
			value.pinningReason === "drift")
	);
}
function parsePage(value: unknown): BrowserPageChange {
	if (
		!isRecord(value) ||
		typeof value.key !== "string" ||
		!pageScalarsValid(value) ||
		!pagePolicyValid(value)
	) {
		return invalidPage();
	}
	const target = parseBrowserTarget(value.target);
	return { ...value, key: value.key, refs: parseRefs(value.refs), ...(target ? { target } : {}) };
}
function parsePages(value: unknown): readonly BrowserPageChange[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		return invalidPage();
	}
	const pages: readonly unknown[] = value;
	return pages.map(parsePage);
}
function parseArtifacts(value: unknown): BrowserArtifactChanges | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value) || !isBrowserStringArray(value.removals)) {
		throw new Error("Invalid browser artifact changes; inspect the retained journal.");
	}
	const manifest = {
		version: 1,
		entries: value.upserts,
		maxEntries: value.maxEntries,
		updatedAtMs: value.updatedAtMs,
		liveCount: 0,
		evictedCount: 0,
	};
	if (!isSessionArtifactManifest(manifest)) {
		throw new Error("Invalid browser artifact changes; inspect the retained journal.");
	}
	return {
		...value,
		upserts: manifest.entries,
		removals: value.removals,
		maxEntries: manifest.maxEntries,
		updatedAtMs: manifest.updatedAtMs,
	};
}
function eventIdentity(
	value: Readonly<Record<string, unknown>>,
): Pick<BrowserEvent, "operationId" | "toolCallId" | "commandIndex" | "isError"> {
	if (
		typeof value.operationId !== "string" ||
		typeof value.toolCallId !== "string" ||
		typeof value.commandIndex !== "number" ||
		!Number.isSafeInteger(value.commandIndex) ||
		value.commandIndex < 0 ||
		typeof value.isError !== "boolean"
	) {
		return invalidEvent();
	}
	return {
		operationId: value.operationId,
		toolCallId: value.toolCallId,
		commandIndex: value.commandIndex,
		isError: value.isError,
	};
}
export function parseBrowserEvent(value: Readonly<Record<string, unknown>>): BrowserEvent {
	const phase = value.phase;
	if (phase !== "begin" && phase !== "finish" && phase !== "state") {
		return invalidEvent();
	}
	if (!isRecord(value.state)) {
		return invalidEvent();
	}
	const identity = eventIdentity(value);
	const pages = parsePages(value.pages);
	const artifacts = parseArtifacts(value.artifacts);
	return {
		...value,
		...identity,
		version: 1,
		phase,
		state: value.state,
		...(pages ? { pages } : {}),
		...(artifacts ? { artifacts } : {}),
	};
}
