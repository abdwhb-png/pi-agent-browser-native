import { stat } from "node:fs/promises";
import { getAgentBrowserSessionIdentityKey } from "../../argv-grammar.js";
import { extractUpstreamCommandTokens } from "../../argv-descriptor.js";
import { isCloseCommand } from "../../command-taxonomy.js";
import { isRecord } from "../../parsing.js";
import { isPendingRecordingArtifact } from "../artifact-manifest.js";
import type { FileArtifactMetadata } from "../artifact-contracts.js";
import type { BatchPresentedStepObservation } from "./observation-contracts.js";

async function unverifiedRecordingArtifact(
	artifact: FileArtifactMetadata,
	subcommand: string,
): Promise<FileArtifactMetadata> {
	const {
		recordingState: _recordingState,
		willExistOnStop: _willExistOnStop,
		...terminal
	} = artifact;
	try {
		const file = await stat(artifact.absolutePath);
		return {
			...terminal,
			exists: file.isFile(),
			sizeBytes: file.size,
			status: file.isFile() ? "unverified" : "missing",
			subcommand,
		};
	} catch (error) {
		const missing = isRecord(error) && error.code === "ENOENT";
		return {
			...terminal,
			exists: missing ? false : undefined,
			status: missing ? "missing" : "unverified",
			subcommand,
		};
	}
}

class TerminalBatchRecordings {
	private readonly artifacts: FileArtifactMetadata[] = [];
	private readonly pendingBySession = new Map<string, number[]>();
	private readonly removed = new Set<number>();
	private readonly session: string;

	constructor(sessionName: string | undefined, namespace: string | undefined) {
		this.session =
			sessionName !== undefined && sessionName.length > 0
				? getAgentBrowserSessionIdentityKey(sessionName, namespace)
				: "";
	}

	private removeMatchingPending(
		artifact: FileArtifactMetadata,
		session: string,
	): readonly number[] {
		const pending = this.pendingBySession.get(session) ?? [];
		const matching = pending.map((index) => this.artifacts[index].kind).lastIndexOf(artifact.kind);
		if (matching !== -1) {
			const removed = pending.splice(matching, 1).at(0);
			if (removed !== undefined) {
				this.removed.add(removed);
			}
		}
		return pending;
	}

	private append(artifact: FileArtifactMetadata): readonly number[] | undefined {
		const index = this.artifacts.push(artifact) - 1;
		if (artifact.command !== "record") {
			return undefined;
		}
		const session =
			artifact.session !== undefined && artifact.session.length > 0
				? getAgentBrowserSessionIdentityKey(artifact.session, artifact.namespace)
				: "";
		if (isPendingRecordingArtifact(artifact)) {
			const pending = this.pendingBySession.get(session) ?? [];
			pending.push(index);
			this.pendingBySession.set(session, pending);
			return undefined;
		}
		const pending = this.removeMatchingPending(artifact, session);
		if (artifact.kind !== "video") {
			return undefined;
		}
		// A terminal video also ends its sheet; a native sheet below replaces this unverified row.
		const sheets = pending.filter(
			(position) =>
				this.artifacts[position].kind === "image" &&
				isPendingRecordingArtifact(this.artifacts[position]),
		);
		return sheets.length > 0 ? sheets : undefined;
	}

	private getClosePending(step: BatchPresentedStepObservation): readonly number[] {
		const command = step.details.command;
		if (
			!step.details.success ||
			!command ||
			!isCloseCommand(extractUpstreamCommandTokens(command)[0])
		) {
			return [];
		}
		return (this.pendingBySession.get(this.session) ?? []).filter((index) => {
			const current = this.artifacts.at(index);
			return (
				current !== undefined && isPendingRecordingArtifact(current) && !this.removed.has(index)
			);
		});
	}

	private async abandon(indices: readonly number[], subcommand: string): Promise<void> {
		for (const index of indices) {
			const current = this.artifacts.at(index);
			if (current && isPendingRecordingArtifact(current) && !this.removed.has(index)) {
				// Each replacement must finish before later lifecycle rows inspect the same artifact state.
				// oxlint-disable-next-line no-await-in-loop
				this.artifacts[index] = await unverifiedRecordingArtifact(current, subcommand);
			}
		}
	}

	async fold(steps: readonly BatchPresentedStepObservation[]): Promise<FileArtifactMetadata[]> {
		for (const step of steps) {
			for (const artifact of step.presentation.artifacts ?? []) {
				const sheets = this.append(artifact);
				if (sheets) {
					// Terminal receipt order determines which pending sheet the next row can replace.
					// oxlint-disable-next-line no-await-in-loop
					await this.abandon(sheets, artifact.subcommand ?? "stop");
				}
			}
			const pending = this.getClosePending(step);
			if (pending.length > 0) {
				// Close abandonment must finish before any later recording receipt is folded.
				// oxlint-disable-next-line no-await-in-loop
				await this.abandon(pending, "close-abandoned");
			}
		}
		return this.artifacts.filter((_, index) => !this.removed.has(index));
	}
}

export async function coalesceTerminalBatchRecordingArtifacts(
	steps: readonly BatchPresentedStepObservation[],
	sessionName?: string,
	namespace?: string,
): Promise<FileArtifactMetadata[]> {
	return new TerminalBatchRecordings(sessionName, namespace).fold(steps);
}
