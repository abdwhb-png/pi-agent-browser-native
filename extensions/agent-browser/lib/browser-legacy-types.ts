import type { SessionTabTarget } from "./session-page-types.js";
import type { SessionArtifactManifest } from "./results/contracts.js";
export interface LegacySnapshot {
	readonly id: string;
	readonly digest: string;
	readonly usable: boolean;
	readonly candidate: boolean;
}
export interface LegacyPage {
	readonly target?: SessionTabTarget;
	readonly unknown?: true;
	readonly reopenPending?: boolean;
	readonly snapshot?: LegacySnapshot;
	readonly pending?: {
		readonly operationId: string;
		readonly toolCallId: string;
		readonly index: number;
	};
}
export interface LegacyProjection {
	readonly pages: ReadonlyMap<string, LegacyPage>;
	readonly manifest?: SessionArtifactManifest;
	readonly nextIndex: number;
}
/** A conversion owns this cloned projection; its parent and published outputs remain readonly views. */
export interface LegacyProjectionState {
	pages: Map<string, LegacyPage>;
	manifest?: SessionArtifactManifest;
	nextIndex: number;
}
export interface LegacyContext {
	readonly nativeId: string;
	readonly details: Readonly<Record<string, unknown>>;
	readonly key?: string;
	readonly namespace?: string;
	readonly tokens: readonly string[];
	readonly command?: string;
	readonly subcommand?: string;
	readonly isError: boolean;
	readonly toolCallId: string;
	readonly prior: LegacyPage;
	readonly begin: boolean;
	readonly phase: "begin" | "finish" | "state";
	readonly commandIndex: number;
	readonly operationId: string;
}
