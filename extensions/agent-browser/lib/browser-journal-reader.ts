import type { FileHandle } from "node:fs/promises";
import { projectJson } from "./browser-journal-projection.js";
export { projectJson } from "./browser-journal-projection.js";
export interface JournalRange {
	readonly offset: number;
	readonly length: number;
}
export interface JournalEntry extends JournalRange {
	readonly value: Readonly<Record<string, unknown>>;
}
const CHUNK_BYTES = 64 * 1024;

export async function* readRange(
	file: FileHandle,
	range: JournalRange,
): AsyncGenerator<Uint8Array> {
	let position = range.offset;
	const end = range.offset + range.length;
	while (position < end) {
		const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, end - position));
		// The next range read depends on the bytes actually returned by this read.
		// oxlint-disable-next-line no-await-in-loop
		const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
		if (bytesRead === 0) {
			throw new Error("Journal changed or truncated during read.");
		}
		position += bytesRead;
		yield buffer.subarray(0, bytesRead);
	}
}

/** Byte framing, not readline: even one discarded value can exceed V8's string limit. */
class JournalLineFramer {
	private start: number;
	private nonblank = false;
	constructor(offset: number) {
		this.start = offset;
	}
	*accept(buffer: Uint8Array, position: number): Generator<JournalRange> {
		for (let index = 0; index < buffer.length; index++) {
			const byte = buffer[index];
			if (byte === 10) {
				if (this.nonblank) {
					yield { offset: this.start, length: position + index + 1 - this.start };
				}
				this.start = position + index + 1;
				this.nonblank = false;
			} else if (![9, 13, 32].includes(byte)) {
				this.nonblank = true;
			}
		}
	}
	final(end: number, sealed: boolean): JournalRange | undefined {
		return this.nonblank && sealed ? { offset: this.start, length: end - this.start } : undefined;
	}
}
export async function* journalRanges(
	file: FileHandle,
	end: number,
	sealed = false,
	offset = 0,
): AsyncGenerator<JournalRange> {
	let position = offset;
	const framer = new JournalLineFramer(offset);
	while (position < end) {
		const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, end - position));
		// Byte offsets and line framing depend on the preceding read's actual length.
		// oxlint-disable-next-line no-await-in-loop
		const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
		if (bytesRead === 0) {
			throw new Error("Journal truncated during read.");
		}
		yield* framer.accept(buffer.subarray(0, bytesRead), position);
		position += bytesRead;
	}
	const final = framer.final(end, sealed);
	if (final) {
		yield final;
	}
}

const STRUCTURAL_FIELDS = [
	["type"],
	["id"],
	["parentId"],
	["timestamp"],
	["version"],
	["customType"],
	["data", "event", "version"],
	["data", "snapshot", "id"],
	["message", "toolName"],
	["message", "details", "browserEventVersion"],
	["message", "details", "sessionName"],
	["message", "details", "artifactManifest", "version"],
	["message", "details", "electron", "action"],
];
export async function scanJournalMetadata(
	file: FileHandle,
	end: number,
	sealed = false,
): Promise<JournalEntry[]> {
	const entries: JournalEntry[] = [];
	for await (const range of journalRanges(file, end, sealed)) {
		const value = await projectJson(readRange(file, range), STRUCTURAL_FIELDS);
		if (!value) {
			throw new Error(`Expected a journal object at byte ${range.offset}.`);
		}
		entries.push({ ...range, value });
	}
	return entries;
}
