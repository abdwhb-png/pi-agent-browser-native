import type { SessionArtifactManifest } from "../../results/contracts.js";
import {
	getSessionArtifactManifestEntryKey,
	isPendingRecordingCommand,
	mergeSessionArtifactManifest,
} from "../../results/artifact-manifest.js";

export function mergeBrowserRunArtifactManifest(
	current: SessionArtifactManifest | undefined,
	initial: SessionArtifactManifest | undefined,
	updated: SessionArtifactManifest | undefined,
): SessionArtifactManifest | undefined {
	if (!updated || updated === initial) {
		return current;
	}
	if (current === initial) {
		return updated;
	}
	const initialEntries = new Map(
		(initial?.entries ?? []).map((entry) => [getSessionArtifactManifestEntryKey(entry), entry]),
	);
	const changedEntries = updated.entries
		.map((entry, index) => ({ entry, index }))
		.filter(({ entry }) => initialEntries.get(getSessionArtifactManifestEntryKey(entry)) !== entry)
		.sort((left, right) => {
			const timestampOrder = left.entry.createdAtMs - right.entry.createdAtMs;
			if (timestampOrder !== 0 && !Number.isNaN(timestampOrder)) {
				return timestampOrder;
			}
			const pendingOrder =
				Number(
					isPendingRecordingCommand(left.entry.command, left.entry.subcommand, left.entry.kind),
				) -
				Number(
					isPendingRecordingCommand(right.entry.command, right.entry.subcommand, right.entry.kind),
				);
			return pendingOrder !== 0 ? pendingOrder : left.index - right.index;
		})
		.map(({ entry }) => entry);
	return changedEntries.length === 0
		? current
		: mergeSessionArtifactManifest({
				base: current,
				entries: changedEntries,
				nowMs: Math.max(Date.now(), (current?.updatedAtMs ?? 0) + 1, updated.updatedAtMs),
			});
}
