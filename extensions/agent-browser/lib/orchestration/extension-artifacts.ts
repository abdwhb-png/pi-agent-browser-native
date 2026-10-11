import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SessionArtifactManifest } from "../results/contracts.js";
import { retirePendingRecordingManifestEntries } from "../results/artifact-manifest.js";
import { mergeBrowserRunArtifactManifest } from "./browser-run/artifact-merge.js";
import { AsyncExecutionQueue } from "./execution-queue.js";

/** One extension's artifact publication queue and bounded manifest. */
export class BrowserArtifacts {
	readonly queue = new AsyncExecutionQueue();
	manifest: SessionArtifactManifest | undefined;
	constructor(readonly pi: ExtensionAPI) {}
	commit(
		prior: SessionArtifactManifest | undefined,
		rendered: SessionArtifactManifest | undefined,
	): SessionArtifactManifest | undefined {
		this.manifest = mergeBrowserRunArtifactManifest(this.manifest, prior, rendered);
		return this.manifest;
	}
	retireRecording(sessionName: string, namespace?: string): boolean {
		const previous = this.manifest;
		if (this.manifest) {
			this.manifest = retirePendingRecordingManifestEntries(this.manifest, sessionName, namespace);
		}
		return this.manifest !== previous;
	}
}
export interface ObservationResources {
	readonly pi: ExtensionAPI;
	readonly queue: Readonly<Pick<AsyncExecutionQueue, "run">>;
	readonly manifest: SessionArtifactManifest | undefined;
	readonly commit: (
		prior: SessionArtifactManifest | undefined,
		rendered: SessionArtifactManifest | undefined,
	) => SessionArtifactManifest | undefined;
}
export interface RecordingArtifactAccess {
	readonly retireRecording: (sessionName: string, namespace?: string) => boolean;
}
