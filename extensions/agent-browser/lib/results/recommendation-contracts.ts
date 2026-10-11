import type {
	AgentBrowserFailureCategory,
	AgentBrowserResultCategory,
	AgentBrowserSuccessCategory,
	FileArtifactMetadata,
} from "./contracts.js";
import type { AgentBrowserRecoveryContext } from "./action-contracts.js";

export interface AgentBrowserNextActionOptions {
	readonly artifacts?: readonly FileArtifactMetadata[];
	readonly args?: readonly string[];
	readonly command?: string;
	readonly confirmationId?: string;
	readonly electron?: {
		readonly launchId?: string;
		readonly sessionName?: string;
		readonly status?: "active" | "cleaned" | "dead" | "failed" | "partial" | "succeeded";
	};
	readonly failureCategory?: AgentBrowserFailureCategory;
	readonly overlayBlockedClick?: boolean;
	readonly resultCategory: AgentBrowserResultCategory;
	readonly recovery?: AgentBrowserRecoveryContext;
	readonly savedFilePath?: string;
	readonly sessionName?: string;
	readonly subcommand?: string;
	readonly successCategory?: AgentBrowserSuccessCategory;
}
