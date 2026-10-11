import { constants, type Stats } from "node:fs";
import { open, stat, type FileHandle } from "node:fs/promises";
import type { BrowserJournalManager } from "./browser-journal-contracts.js";
import {
	BROWSER_TRANSITION_ENTRY,
	BROWSER_RESULT_TOOLS,
	applyArtifactChanges,
	getBrowserRecord,
	snapshotFromDefinition,
} from "./browser-transcript.js";
import { isRecord } from "./parsing.js";
import { getErrorCode } from "./process-errors.js";
import {
	projectJson,
	readRange,
	scanJournalMetadata,
	type JournalEntry,
} from "./browser-journal-reader.js";
const REPLAY_CUSTOM_TYPES = new Set([
	BROWSER_TRANSITION_ENTRY,
	"agent-browser-recording-reservation",
	"agent-browser-script-session",
]);

function branchEntries(
	entries: readonly JournalEntry[],
	selectedLeaf: string | null,
): JournalEntry[] {
	const byId = new Map<string, JournalEntry>();
	for (const entry of entries) {
		const id = entry.value.id;
		if (typeof id !== "string" || byId.has(id)) {
			throw new Error("Journal has a missing or duplicate native entry identity.");
		}
		byId.set(id, entry);
	}
	const branch: JournalEntry[] = [];
	const seen = new Set<string>();
	let leaf = selectedLeaf;
	while (leaf !== null) {
		if (seen.has(leaf)) {
			throw new Error("Journal ancestry contains a cycle.");
		}
		seen.add(leaf);
		const entry = byId.get(leaf);
		if (!entry) {
			throw new Error(
				`Selected journal entry ${leaf} is not persisted; browser work requires a committed conversation.`,
			);
		}
		const parent = entry.value.parentId;
		if (parent !== null && typeof parent !== "string") {
			throw new Error("Invalid journal parent identity.");
		}
		branch.push(entry);
		leaf = parent;
	}
	return branch.reverse();
}
function canonicalVersion(entry: Readonly<Record<string, unknown>>): boolean {
	return isRecord(entry.data) && isRecord(entry.data.event) && entry.data.event.version === 1;
}
function legacyCustom(entry: Readonly<Record<string, unknown>>): boolean {
	return (
		entry.type === "custom" &&
		(entry.customType === BROWSER_TRANSITION_ENTRY ||
			entry.customType === "agent-browser-script-session") &&
		!canonicalVersion(entry)
	);
}
function browserMessage(
	entry: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
	const message = isRecord(entry.message) ? entry.message : undefined;
	return message &&
		typeof message.toolName === "string" &&
		BROWSER_RESULT_TOOLS.has(message.toolName)
		? message
		: undefined;
}
function legacyBrowserResult(entry: Readonly<Record<string, unknown>>): boolean {
	const message = browserMessage(entry);
	if (
		!message ||
		!isRecord(message.details) ||
		message.details.browserEventVersion === 1 ||
		canonicalVersion(entry)
	) {
		return false;
	}
	return (
		message.details.sessionName !== undefined ||
		message.details.artifactManifest !== undefined ||
		message.details.electron !== undefined
	);
}
function validateMemoryEntry(entry: unknown): void {
	if (!isRecord(entry)) {
		return;
	}
	if (legacyCustom(entry) && !getBrowserRecord(entry)) {
		throw new Error(
			"Legacy browser records require stopped separate-copy conversion before replay.",
		);
	}
	const message = browserMessage(entry);
	if (
		entry.type === "message" &&
		message &&
		isRecord(message.details) &&
		message.details.browserEventVersion !== 1 &&
		!getBrowserRecord(entry)
	) {
		throw new Error(
			"Legacy browser observations require stopped separate-copy conversion before replay.",
		);
	}
}
function inMemoryEntries(manager: BrowserJournalManager, physical: boolean): unknown[] {
	const entries: unknown[] = physical ? manager.getEntries() : [];
	if (!physical) {
		const seen = new Set<string>();
		let leaf = manager.getLeafId();
		while (leaf !== null) {
			if (seen.has(leaf)) {
				throw new Error("In-memory journal ancestry contains a cycle.");
			}
			seen.add(leaf);
			const entry = manager.getEntry(leaf);
			if (!isRecord(entry) || (entry.parentId !== null && typeof entry.parentId !== "string")) {
				throw new Error("In-memory journal ancestry is incomplete.");
			}
			entries.push(entry);
			leaf = entry.parentId;
		}
		entries.reverse();
	}
	for (const entry of entries) {
		validateMemoryEntry(entry);
	}
	return entries;
}

class PublishedJournalReplay {
	private readonly projected: unknown[] = [];
	private readonly definitions = new Map<string, JournalEntry>();
	constructor(private readonly file: FileHandle) {}
	async project(entries: readonly JournalEntry[]): Promise<void> {
		for (const entry of entries) {
			// Preserve journal order and bound selected envelope memory during replay.
			// oxlint-disable-next-line no-await-in-loop
			await this.projectEntry(entry);
		}
	}
	private async projectEntry(entry: JournalEntry): Promise<void> {
		const { value } = entry;
		const definition =
			isRecord(value.data) && isRecord(value.data.snapshot) ? value.data.snapshot.id : undefined;
		if (typeof definition === "string") {
			if (this.definitions.has(definition)) {
				throw new Error("Browser snapshot identity is defined more than once on this ancestry.");
			}
			this.definitions.set(definition, entry);
		}
		if (legacyCustom(value) || legacyBrowserResult(value)) {
			throw new Error(
				"This session contains legacy browser records. Convert a stopped separate copy with npm exec --package pi-agent-browser-native -- pi-agent-browser-convert before resuming browser work; the original journal is retained.",
			);
		}
		if (!replayRelevant(value, definition)) {
			return;
		}
		const fields =
			value.customType === BROWSER_TRANSITION_ENTRY || value.type === "message"
				? [
						["data", "event"],
						["data", "snapshot", "id"],
					]
				: [["data"]];
		const body = await projectJson(readRange(this.file, entry), fields);
		this.projected.push({ ...value, ...body });
	}
	async resolveWinningDefinitions(physical: boolean): Promise<unknown[]> {
		const { SessionPageState } = await import("./session-page-state.js");
		const reduced = SessionPageState.fromBranch(this.projected);
		const winners = new Set(
			(physical ? [] : [...reduced.views().values()]).flatMap((page) =>
				page.refSnapshot?.snapshotId !== undefined && page.refSnapshot.snapshotId.length > 0
					? [page.refSnapshot.snapshotId]
					: [],
			),
		);
		for (const id of winners) {
			// Each winning snapshot is materialized once, without retaining unrelated historical ref maps.
			// oxlint-disable-next-line no-await-in-loop
			await this.resolveDefinition(id);
		}
		let manifest;
		for (const entry of this.projected) {
			manifest = applyArtifactChanges(manifest, getBrowserRecord(entry)?.event.artifacts);
		}
		return this.projected;
	}
	private async resolveDefinition(id: string): Promise<void> {
		const entry = this.definitions.get(id);
		if (!entry) {
			throw new Error(
				`Browser snapshot ${id} has no ancestral definition; inspect and take a fresh snapshot.`,
			);
		}
		// ponytail: a requested individual snapshot must fit the consumer's memory; upgrade with native per-value paging if needed.
		const body = await projectJson(readRange(this.file, entry), [["data", "snapshot"]], Infinity);
		const destination = this.projected.find(
			(candidate) => isRecord(candidate) && candidate.id === entry.value.id,
		);
		if (!isRecord(destination) || !isRecord(destination.data) || !isRecord(body?.data)) {
			throw new Error("Winning browser snapshot could not be read.");
		}
		destination.data.snapshot = body.data.snapshot;
		if (!isRecord(body.data.snapshot) || body.data.snapshot.id !== id) {
			throw new Error("Winning browser snapshot identity is invalid.");
		}
		snapshotFromDefinition(body.data.snapshot);
	}
}
function replayRelevant(value: Readonly<Record<string, unknown>>, definition: unknown): boolean {
	return (
		(value.type === "custom" &&
			typeof value.customType === "string" &&
			REPLAY_CUSTOM_TYPES.has(value.customType)) ||
		(isRecord(value.data) && isRecord(value.data.event)) ||
		definition !== undefined
	);
}
async function verifyCapturedFile(file: FileHandle, path: string, captured: Stats): Promise<void> {
	const current = await file.stat();
	const currentPath = await stat(path);
	if (
		current.dev !== captured.dev ||
		current.ino !== captured.ino ||
		current.size < captured.size ||
		currentPath.dev !== captured.dev ||
		currentPath.ino !== captured.ino
	) {
		throw new Error("Pi journal replaced or truncated during replay.");
	}
}
function validateJournalHeader(metadata: readonly JournalEntry[], sessionId: string): void {
	const header = metadata.find((entry) => entry.value.type === "session");
	if (header?.value.id !== sessionId) {
		throw new Error("Pi session journal identity does not match the active session.");
	}
}
async function openPublishedJournal(path: string): Promise<FileHandle | undefined> {
	try {
		return await open(path, constants.O_RDONLY);
	} catch (error) {
		if (getErrorCode(error) === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}
export async function readBrowserEntries(
	manager: BrowserJournalManager,
	physical = false,
): Promise<unknown[]> {
	const path = manager.getSessionFile();
	if (path === undefined || path.length === 0) {
		return inMemoryEntries(manager, physical);
	}
	const leaf = physical ? null : manager.getLeafId();
	const file = await openPublishedJournal(path);
	if (!file) {
		return inMemoryEntries(manager, physical);
	}
	try {
		const captured = await file.stat();
		if (!captured.isFile()) {
			throw new Error("Pi session journal is not a regular file.");
		}
		const metadata = await scanJournalMetadata(file, captured.size);
		validateJournalHeader(metadata, manager.getHeader()?.id ?? manager.getSessionId());
		const records = metadata.filter((entry) => entry.value.type !== "session");
		const replay = new PublishedJournalReplay(file);
		await replay.project(physical ? records : branchEntries(records, leaf));
		const entries = await replay.resolveWinningDefinitions(physical);
		await verifyCapturedFile(file, path, captured);
		return entries;
	} finally {
		await file.close();
	}
}
