import { getScreenshotCapture } from "../../orchestration/browser-run/screenshot-capture.js";
import { isRecord } from "../../parsing.js";
import type { FileArtifactMetadata } from "../artifact-contracts.js";
import type { ToolPresentation } from "../contracts.js";
import {
	applyArtifactManifest,
	attachInlineImage,
	buildArtifactVerificationSummary,
	buildManifestEntriesForFileArtifacts,
	extractFileArtifacts,
	extractImagePath,
	isManifestFileArtifact,
} from "./artifacts.js";
import { getPresentationPaths } from "./content.js";
import type { BuildToolPresentationOptions } from "./input-contracts.js";
import { compactLargePresentationOutput } from "./large-output.js";
import type { PresentationSource } from "./source.js";

type OutputOptions = Pick<
	BuildToolPresentationOptions,
	| "artifactManifest"
	| "artifactRequest"
	| "commandInfo"
	| "cwd"
	| "modelVisible"
	| "persistentArtifactStore"
>;
type ArtifactExtractionOptions = Pick<
	BuildToolPresentationOptions,
	| "artifactManifest"
	| "artifactMaxUpdatedAtMs"
	| "artifactMinUpdatedAtMs"
	| "artifactRequest"
	| "cwd"
	| "envelope"
	| "namespace"
	| "recordingPending"
	| "previousRecordingContactSheetPath"
	| "sessionName"
>;

export async function extractPresentationArtifacts(
	options: ArtifactExtractionOptions,
	source: PresentationSource,
): Promise<readonly FileArtifactMetadata[]> {
	return extractFileArtifacts({
		artifactManifest: options.artifactManifest,
		artifactMaxUpdatedAtMs: options.artifactMaxUpdatedAtMs,
		artifactMinUpdatedAtMs: options.artifactMinUpdatedAtMs,
		artifactRequest: options.artifactRequest,
		commandInfo: source.presentationCommandInfo,
		cwd: options.cwd,
		data: source.data,
		namespace: options.namespace,
		recordingOutcome: source.recordingCommand ? options.envelope?.success : undefined,
		recordingPending: options.recordingPending,
		previousRecordingContactSheetPath: options.previousRecordingContactSheetPath,
		sessionName: options.sessionName,
	});
}

function getAttachableImage(
	options: OutputOptions,
	source: PresentationSource,
	artifacts: readonly FileArtifactMetadata[],
): string | undefined {
	const path = getImagePath(options, source, artifacts);
	if (
		path === undefined ||
		path.length === 0 ||
		(isRecord(source.data) && source.data.changed === false)
	) {
		return undefined;
	}
	return artifacts.some(
		(artifact) =>
			artifact.absolutePath === path &&
			["missing", "stale", "failed"].includes(artifact.status ?? ""),
	)
		? undefined
		: path;
}

function getImagePath(
	options: OutputOptions,
	source: PresentationSource,
	artifacts: readonly FileArtifactMetadata[],
): string | undefined {
	return (
		options.artifactRequest?.absolutePath ??
		extractImagePath(options.commandInfo, options.cwd, source.data) ??
		(source.recordingCommand
			? artifacts.find((artifact) => artifact.kind === "image" && artifact.status === "saved")
					?.absolutePath
			: undefined)
	);
}

async function attachPresentationImage(
	draft: ToolPresentation,
	options: OutputOptions,
	source: PresentationSource,
	artifacts: readonly FileArtifactMetadata[],
): Promise<ToolPresentation> {
	const imagePath = getAttachableImage(options, source, artifacts);
	const withImage =
		imagePath === undefined
			? draft
			: await attachInlineImage(draft, imagePath, options.modelVisible);
	if (options.commandInfo.command === "screenshot" && withImage.imageObservations) {
		const capture = getScreenshotCapture(source.commandInfo.commandTokens ?? []).kind;
		withImage.imageObservations = withImage.imageObservations.map((image) =>
			Object.assign({}, image, { capture }),
		);
	}
	return withImage;
}

export async function completePresentationOutput(
	draft: ToolPresentation,
	options: OutputOptions,
	source: PresentationSource,
	artifacts: readonly FileArtifactMetadata[],
): Promise<ToolPresentation> {
	if (artifacts.length > 0 && !draft.artifacts) {
		draft.artifacts = artifacts;
	}
	draft.artifactVerification ??= buildArtifactVerificationSummary(artifacts);
	const withImage = await attachPresentationImage(draft, options, source, artifacts);
	const compacted =
		options.modelVisible === false
			? withImage
			: await compactLargePresentationOutput({
					artifactManifest: options.artifactManifest,
					commandInfo: options.commandInfo,
					data: source.presentationData,
					persistentArtifactStore: options.persistentArtifactStore,
					presentation: withImage,
				});
	const withManifest = applyArtifactManifest(
		compacted,
		compacted.artifactManifest ?? options.artifactManifest,
		buildManifestEntriesForFileArtifacts(artifacts.filter(isManifestFileArtifact)),
	);
	const currentSpillPaths = new Set(
		getPresentationPaths({
			primaryPath: withManifest.fullOutputPath,
			secondaryPaths: withManifest.fullOutputPaths,
		}),
	);
	withManifest.artifactVerification =
		buildArtifactVerificationSummary(artifacts, withManifest.artifactManifest, currentSpillPaths) ??
		withManifest.artifactVerification;
	return withManifest;
}
