import { isRecord } from "../parsing.js";
import type { RecordingReceipt } from "./evidence-contracts.js";

const RECORDING_QUALITY_WARNING =
	"Capture quality warning: repaint-driven capture, held/repeated or static frames, and late/final-state-only frames cannot establish UI smoothness. Output FPS is not captured-frame rate; inspect the recording and capture window before judging motion.";

export type { RecordingReceipt } from "./evidence-contracts.js";

function getRecordingOutcome(value: unknown, outcome: boolean | undefined): boolean | null {
	if (typeof value === "boolean" || value === null) {
		return value;
	}
	return outcome ?? null;
}

function formatRecordingOutcome(receipt: RecordingReceipt): string {
	let outcome = "pending/unknown";
	if (receipt.success !== null) {
		outcome = receipt.success ? "succeeded" : "failed";
	}
	const error = receipt.error !== null && receipt.error.length > 0 ? ` — ${receipt.error}` : "";
	return `Native recording outcome: ${outcome}${error}`;
}

function recordOrEmpty(value: unknown): Readonly<Record<string, unknown>> {
	return isRecord(value) ? value : {};
}

function number(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function getRecordingReceipt(
	value: unknown,
	outcome?: boolean,
): RecordingReceipt | undefined {
	if (!isRecord(value) || typeof value.path !== "string" || value.path.length === 0) {
		return undefined;
	}
	const capture = recordOrEmpty(value.capture);
	const output = recordOrEmpty(value.output);
	const file = recordOrEmpty(value.file);
	return {
		warning: RECORDING_QUALITY_WARNING,
		recordingId: text(value.recordingId),
		path: value.path,
		success: getRecordingOutcome(value.success, outcome),
		error: text(value.error),
		frames: number(value.frames),
		capturedFrames: number(value.capturedFrames),
		fps: number(value.fps),
		capture: {
			startedAt: text(capture.startedAt),
			endedAt: text(capture.endedAt),
			durationMs: number(capture.durationMs),
			firstFrameAt: text(capture.firstFrameAt),
			lastFrameAt: text(capture.lastFrameAt),
			firstFrameAfterMs: number(capture.firstFrameAfterMs),
			lastFrameAfterMs: number(capture.lastFrameAfterMs),
			averageFps: number(capture.averageFps),
			maxFrameGapMs: number(capture.maxFrameGapMs),
			timestampSource: text(capture.timestampSource),
		},
		output: {
			frames: number(output.frames ?? value.frames),
			fps: number(output.fps ?? value.fps),
			encodedFrames: number(output.encodedFrames),
			durationMs: number(output.durationMs),
			durationSource: text(output.durationSource),
			heldFrames: number(output.heldFrames),
			droppedFrames: number(output.droppedFrames),
			skippedFrames: number(output.skippedFrames),
			encoderSucceeded:
				typeof output.encoderSucceeded === "boolean" ? output.encoderSucceeded : null,
		},
		file: {
			exists: typeof file.exists === "boolean" ? file.exists : null,
			sizeBytes: number(file.sizeBytes),
		},
	};
}

export function formatRecordingReceipt(receipt: RecordingReceipt): string {
	const metric = (value: string | number | null, unit = "") =>
		value === null ? "unknown" : `${value}${unit}`;
	return [
		`Recording ID: ${metric(receipt.recordingId)}`,
		formatRecordingOutcome(receipt),
		`Capture started: ${metric(receipt.capture.startedAt)}; ended: ${metric(receipt.capture.endedAt)}`,
		`Wall-clock capture duration: ${metric(receipt.capture.durationMs, " ms")}`,
		`Captured frames (received, not pixel-unique): ${metric(receipt.capturedFrames)}`,
		`Captured-frame rate: ${metric(receipt.capture.averageFps, " fps")}`,
		`First frame: ${metric(receipt.capture.firstFrameAt)}; after start: ${metric(receipt.capture.firstFrameAfterMs, " ms")}`,
		`Last frame: ${metric(receipt.capture.lastFrameAt)}; after start: ${metric(receipt.capture.lastFrameAfterMs, " ms")}`,
		`Maximum frame gap: ${metric(receipt.capture.maxFrameGapMs, " ms")}; timestamp source: ${metric(receipt.capture.timestampSource)}`,
		`Written frames: ${metric(receipt.output.frames)}; Encoded frames: ${metric(receipt.output.encodedFrames)}`,
		`Held frames: ${metric(receipt.output.heldFrames)}; dropped frames: ${metric(receipt.output.droppedFrames)}; skipped frames: ${metric(receipt.output.skippedFrames)}`,
		`Nominal/output FPS: ${metric(receipt.output.fps)}; output duration (encoded frames/fps): ${metric(receipt.output.durationMs, " ms")}`,
		receipt.warning,
	].join("\n");
}
