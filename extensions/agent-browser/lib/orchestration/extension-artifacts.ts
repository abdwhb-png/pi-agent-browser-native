import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PersistentSessionArtifactStore } from "../temp.js";
import type { BrowserRunContext } from "./browser-run/types.js";
import { getPersistentSessionArtifactStore } from "./browser-run/session-state.js";
import { loadAgentBrowserConfigSync, resolveArtifactDirectory } from "../config.js";
import { shouldIncludeProjectConfig } from "./extension-prompt.js";
import type { SessionArtifactManifest } from "../results/contracts.js";
import { retirePendingRecordingManifestEntries } from "../results/artifact-manifest.js";
import { mergeBrowserRunArtifactManifest } from "./browser-run/artifact-merge.js";
import { AsyncExecutionQueue } from "./execution-queue.js";

export function captureArtifactStore(
	ctx: BrowserRunContext & Readonly<Pick<ExtensionContext, "isProjectTrusted">>,
): PersistentSessionArtifactStore | undefined {
	const state = loadAgentBrowserConfigSync({
		cwd: ctx.cwd,
		includeProjectConfig: shouldIncludeProjectConfig(ctx),
	});
	if (state.errors.length > 0) {
		throw new Error(
			"Invalid Agent Browser configuration. Inspect the package configuration diagnostics before retrying; the browser command was not dispatched.",
		);
	}
	return getPersistentSessionArtifactStore(ctx, resolveArtifactDirectory(state.config, ctx.cwd));
}

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
