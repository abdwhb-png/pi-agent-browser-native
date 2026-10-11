import type { AgentBrowserNextAction } from "./action-contracts.js";
import type { AgentBrowserNextActionOptions } from "./recommendation-contracts.js";
import type { FileArtifactMetadata } from "./contracts.js";
import { isPendingRecordingArtifact } from "./artifact-manifest.js";
import { buildNextToolAction } from "./next-actions.js";

function buildArtifactAction(path: string): AgentBrowserNextAction {
	return {
		artifactPath: path,
		id: "use-saved-artifact",
		reason:
			"Use the saved artifact path from the structured result instead of scraping it from text.",
		safety: "Verify artifact metadata such as exists/status before treating the file as durable.",
		tool: "agent_browser",
	};
}

function buildArtifactVerificationAction(artifact: FileArtifactMetadata): AgentBrowserNextAction {
	return {
		artifactPath: artifact.path,
		id: "verify-artifact-path",
		reason: "The wrapper has artifact metadata but did not verify this file as present on disk.",
		safety:
			"Check details.artifactVerification and the filesystem before treating the artifact as durable.",
		tool: "agent_browser",
	};
}

function buildMissingArtifactAction(
	artifact: FileArtifactMetadata,
	afterFailure: boolean,
): AgentBrowserNextAction {
	if (artifact.kind !== "download") {
		return buildArtifactVerificationAction(artifact);
	}
	return buildNextToolAction({
		args: ["wait", "--download", artifact.path],
		id: "wait-for-download",
		reason: afterFailure
			? "The requested download artifact was not found on disk after upstream reported completion."
			: "Upstream reported a download path, but the wrapper did not verify the file on disk.",
		safety:
			"Use an explicit wait timeout; if you set top-level timeoutMs, keep it above the wait duration plus a small grace window.",
	});
}

export function buildSavedArtifactNextActions(
	options: AgentBrowserNextActionOptions,
): AgentBrowserNextAction[] {
	const artifacts = options.artifacts ?? [];
	const savedFilePath = options.savedFilePath;
	const actions: AgentBrowserNextAction[] = [];
	if (
		savedFilePath !== undefined &&
		savedFilePath.length > 0 &&
		artifacts.find((artifact) => artifact.path === savedFilePath)?.exists !== false
	) {
		actions.push(buildArtifactAction(savedFilePath));
	}
	for (const artifact of artifacts) {
		if (isPendingRecordingArtifact(artifact)) {
			continue;
		}
		if (artifact.exists === false) {
			actions.push(buildMissingArtifactAction(artifact, false));
		} else if (artifact.path !== savedFilePath) {
			actions.push(buildArtifactAction(artifact.path));
		}
	}
	return actions;
}

export function buildMissingArtifactNextActions(
	artifacts: readonly FileArtifactMetadata[] | undefined,
): AgentBrowserNextAction[] {
	return (artifacts ?? [])
		.filter(
			(artifact) =>
				!isPendingRecordingArtifact(artifact) &&
				(artifact.exists === false || artifact.status === "stale"),
		)
		.map((artifact) => buildMissingArtifactAction(artifact, true));
}

export function buildPendingRecordingNextActions(
	artifacts: readonly FileArtifactMetadata[] | undefined,
): AgentBrowserNextAction[] {
	return (artifacts ?? []).some(isPendingRecordingArtifact)
		? [
				buildNextToolAction({
					args: ["record", "stop"],
					id: "stop-pending-recording",
					reason:
						"Stop the active recording so the requested video can be finalized and verified on disk.",
					safety:
						"The file remains pending until record stop succeeds; verify details.artifactVerification afterward.",
				}),
			]
		: [];
}
