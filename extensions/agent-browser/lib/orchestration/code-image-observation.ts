import { isRecord } from "../parsing.js";
import type { ImageObservation, ScreenshotSample } from "../results/contracts.js";

function finite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}
function size(value: unknown): ImageObservation["pixels"] {
	if (!isRecord(value) || !finite(value.width) || !finite(value.height)) {
		return undefined;
	}
	return { width: value.width, height: value.height };
}
function point(value: unknown): ScreenshotSample["scroll"] | undefined {
	if (!isRecord(value) || !finite(value.x) || !finite(value.y)) {
		return undefined;
	}
	return { x: value.x, y: value.y };
}
function rectangle(value: unknown): ScreenshotSample["element"] {
	const dimensions = size(value);
	const coordinates = point(value);
	return dimensions && coordinates ? { ...dimensions, ...coordinates } : undefined;
}
function visualViewport(value: unknown): ScreenshotSample["visualViewport"] | undefined {
	const coordinates = point(value);
	if (!isRecord(value) || !coordinates || !finite(value.scale)) {
		return undefined;
	}
	return { ...coordinates, scale: value.scale };
}
function rendering(value: unknown): value is ImageObservation["rendering"] {
	return value === undefined || value === "text";
}
function sample(value: unknown): ScreenshotSample | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const viewport = size(value.viewport);
	const document = size(value.document);
	const scroll = point(value.scroll);
	const visual = visualViewport(value.visualViewport);
	if (!viewport || !document || !scroll || !visual) {
		return undefined;
	}
	const element = rectangle(value.element);
	if (value.element !== undefined && element === undefined) {
		return undefined;
	}
	if (!validSampleIdentity(value)) {
		return undefined;
	}
	return {
		url: value.url,
		frame: value.frame,
		childFrameCount: value.childFrameCount,
		dpr: value.dpr,
		rendering: value.rendering,
		viewport,
		document,
		scroll,
		visualViewport: visual,
		element,
	};
}
interface SampleIdentity {
	readonly url: string;
	readonly frame: "main" | "child";
	readonly childFrameCount: number;
	readonly dpr: number;
	readonly rendering?: "text";
}
function validSampleIdentity(
	value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & SampleIdentity {
	return (
		typeof value.url === "string" &&
		(value.frame === "main" || value.frame === "child") &&
		finite(value.childFrameCount) &&
		finite(value.dpr) &&
		rendering(value.rendering)
	);
}
function geometry(value: unknown): ImageObservation["geometry"] | undefined {
	if (!isRecord(value) || typeof value.reason !== "string") {
		return undefined;
	}
	if (value.status !== "measured" && value.status !== "unknown") {
		return undefined;
	}
	const before = sample(value.before);
	const after = sample(value.after);
	const crop = rectangle(value.crop);
	const pixelsPerCssPixel = point(value.pixelsPerCssPixel);
	const invalid = [
		[value.before, before],
		[value.after, after],
		[value.crop, crop],
		[value.pixelsPerCssPixel, pixelsPerCssPixel],
	].some(([supplied, parsed]) => supplied !== undefined && parsed === undefined);
	if (invalid) {
		return undefined;
	}
	return { status: value.status, reason: value.reason, before, after, crop, pixelsPerCssPixel };
}
export function parseCodeImageObservation(value: unknown): ImageObservation | undefined {
	if (!isRecord(value) || typeof value.path !== "string" || typeof value.mimeType !== "string") {
		return undefined;
	}
	const captures: readonly ImageObservation["capture"][] = [
		"viewport",
		"full-page",
		"element",
		"unknown",
	];
	const capture = captures.find((candidate) => candidate === value.capture);
	const measuredGeometry = geometry(value.geometry);
	if (capture === undefined || !measuredGeometry || !rendering(value.rendering)) {
		return undefined;
	}
	const pixels = size(value.pixels);
	if (value.pixels !== undefined && pixels === undefined) {
		return undefined;
	}
	return {
		path: value.path,
		mimeType: value.mimeType,
		capture,
		geometry: measuredGeometry,
		pixels,
		rendering: value.rendering,
	};
}
