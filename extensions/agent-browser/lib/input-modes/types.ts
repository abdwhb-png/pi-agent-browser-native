export const DEFAULT_SESSION_MODE = "auto";

export const AGENT_BROWSER_CODE_MAX_TIMEOUT_MS = 300_000;

export const AGENT_BROWSER_SEMANTIC_ACTIONS = ["check", "click", "fill", "select"] as const;

export const AGENT_BROWSER_SEMANTIC_LOCATORS = [
	"alt",
	"label",
	"placeholder",
	"role",
	"testid",
	"text",
	"title",
] as const;

const AGENT_BROWSER_JOB_STEP_ACTIONS = [
	"open",
	"click",
	"fill",
	"type",
	"select",
	"wait",
	"assertText",
	"assertUrl",
	"waitForDownload",
	"screenshot",
	"snapshot",
] as const;

export const AGENT_BROWSER_QA_LOAD_STATES = ["domcontentloaded", "load", "networkidle"] as const;

export const AGENT_BROWSER_ELECTRON_ACTIONS = [
	"list",
	"launch",
	"status",
	"cleanup",
	"probe",
] as const;

export const AGENT_BROWSER_ELECTRON_HANDOFFS = ["connect", "tabs", "snapshot"] as const;

export const AGENT_BROWSER_ELECTRON_TARGET_TYPES = ["page", "webview", "any"] as const;

export const AGENT_BROWSER_ELECTRON_LIST_FIELDS: readonly string[] = [
	"action",
	"query",
	"maxResults",
];

export const AGENT_BROWSER_ELECTRON_PROBE_FIELDS: readonly string[] = [
	"action",
	"launchId",
	"timeoutMs",
];

export const AGENT_BROWSER_ELECTRON_RESERVED_APP_ARGS = [
	"--user-data-dir",
	"--remote-debugging-port",
	"--remote-debugging-address",
	"--remote-debugging-pipe",
] as const;

export const SOURCE_LOOKUP_WORKSPACE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

export const SOURCE_LOOKUP_IGNORED_DIRECTORIES = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"coverage",
	".next",
	"out",
	"tmp",
	"temp",
]);

export const SOURCE_LOOKUP_DEFAULT_MAX_WORKSPACE_FILES = 2_000;

export const SOURCE_LOOKUP_MAX_WORKSPACE_FILES = 5_000;

export type AgentBrowserSemanticActionName = (typeof AGENT_BROWSER_SEMANTIC_ACTIONS)[number];

export type AgentBrowserSemanticLocator = (typeof AGENT_BROWSER_SEMANTIC_LOCATORS)[number];

export type AgentBrowserJobStepAction = (typeof AGENT_BROWSER_JOB_STEP_ACTIONS)[number];

export type AgentBrowserQaLoadState = (typeof AGENT_BROWSER_QA_LOAD_STATES)[number];

export type AgentBrowserElectronAction = (typeof AGENT_BROWSER_ELECTRON_ACTIONS)[number];

export type AgentBrowserSourceLookupStatus = "candidates-found" | "no-candidates" | "unsupported";

export type AgentBrowserNetworkSourceLookupStatus =
	| "failed-requests-found"
	| "no-failed-requests"
	| "no-candidates";

export type CompiledAgentBrowserElectron =
	| {
			readonly action: "list";
			readonly maxResults?: number;
			readonly query?: string;
	  }
	| {
			readonly action: "launch";
			readonly allow?: readonly string[];
			readonly appArgs?: readonly string[];
			readonly deny?: readonly string[];
			readonly appName?: string;
			readonly appPath?: string;
			readonly bundleId?: string;
			readonly executablePath?: string;
			readonly handoff: "connect" | "snapshot" | "tabs";
			readonly targetType: "any" | "page" | "webview";
			readonly timeoutMs?: number;
	  }
	| {
			readonly action: "cleanup" | "status";
			readonly all?: boolean;
			readonly launchId?: string;
			readonly timeoutMs?: number;
	  }
	| {
			readonly action: "probe";
			readonly launchId?: string;
			readonly timeoutMs?: number;
	  };

export interface CompiledAgentBrowserSemanticAction {
	readonly action: AgentBrowserSemanticActionName;
	readonly locator?: AgentBrowserSemanticLocator;
	readonly selector?: string;
	readonly values?: readonly string[];
	readonly args: readonly string[];
}

export interface CompiledAgentBrowserJobStep {
	readonly action: AgentBrowserJobStepAction;
	readonly args: readonly string[];
	readonly generatedFrom?: string;
}

export interface CompiledAgentBrowserJob {
	readonly args: readonly string[];
	readonly failFast: boolean;
	readonly stdin: string;
	readonly steps: readonly CompiledAgentBrowserJobStep[];
}

export interface CompiledAgentBrowserQaPreset extends CompiledAgentBrowserJob {
	readonly checks: {
		readonly checkConsole: boolean;
		readonly checkErrors: boolean;
		readonly checkNetwork: boolean;
		readonly diagnosticsResetAtStart: boolean;
		readonly loadState: AgentBrowserQaLoadState;
		readonly expectedText: readonly string[];
		readonly expectedSelector?: string;
		readonly screenshotPath?: string;
		readonly attached: boolean;
		readonly url?: string;
	};
}

export interface CompiledAgentBrowserSourceLookupStep {
	readonly action: "dom" | "react";
	readonly args: readonly string[];
}

export interface CompiledAgentBrowserSourceLookup {
	readonly args: readonly string[];
	readonly stdin: string;
	readonly steps: readonly CompiledAgentBrowserSourceLookupStep[];
	readonly query: {
		readonly componentName?: string;
		readonly includeDomHints: boolean;
		readonly maxWorkspaceFiles: number;
		readonly reactFiberId?: string;
		readonly selector?: string;
	};
}

export interface AgentBrowserSourceLookupCandidate {
	readonly column?: number;
	readonly componentName?: string;
	readonly confidence: "high" | "medium" | "low";
	readonly evidence: readonly string[];
	readonly file?: string;
	readonly line?: number;
	readonly source: "react-inspect" | "dom-attribute" | "workspace-search";
}

export interface AgentBrowserSourceLookupElectronContext {
	readonly appName?: string;
	readonly appPath?: string;
	readonly executablePath?: string;
	readonly launchId?: string;
	readonly sessionName?: string;
	readonly url?: string;
}

export interface AgentBrowserSourceLookupAnalysis {
	readonly candidates: readonly AgentBrowserSourceLookupCandidate[];
	readonly electronContext?: AgentBrowserSourceLookupElectronContext;
	readonly limitations: readonly string[];
	readonly status: AgentBrowserSourceLookupStatus;
	readonly summary: string;
	readonly workspaceRoot?: string;
}

export interface AgentBrowserSourceLookupAnalysisContext {
	readonly electronContext?: AgentBrowserSourceLookupElectronContext;
	readonly workspaceRoot: string;
}

export interface CompiledAgentBrowserNetworkSourceLookup {
	readonly args: readonly string[];
	readonly stdin: string;
	readonly steps: ReadonlyArray<{ readonly action: "network"; readonly args: readonly string[] }>;
	readonly query: {
		readonly filter?: string;
		readonly maxWorkspaceFiles: number;
		readonly namespace?: string;
		readonly requestId?: string;
		readonly session?: string;
		readonly url?: string;
	};
}

export interface AgentBrowserNetworkSourceLookupRequest {
	readonly error?: string;
	readonly method?: string;
	readonly requestId?: string;
	readonly status?: number;
	readonly url?: string;
}

export interface AgentBrowserNetworkSourceLookupCandidate {
	readonly confidence: "high" | "medium" | "low";
	readonly evidence: readonly string[];
	readonly file?: string;
	readonly line?: number;
	readonly requestUrl?: string;
	readonly source: "initiator" | "workspace-search";
}

export interface AgentBrowserNetworkSourceLookupAnalysis {
	readonly candidates: readonly AgentBrowserNetworkSourceLookupCandidate[];
	readonly failedRequests: readonly AgentBrowserNetworkSourceLookupRequest[];
	readonly limitations: readonly string[];
	readonly status: AgentBrowserNetworkSourceLookupStatus;
	readonly summary: string;
}

export interface AgentBrowserQaPresetAnalysis {
	readonly failedChecks: readonly string[];
	readonly notRunChecks: readonly string[];
	readonly passed: boolean;
	readonly summary: string;
	readonly warnings: readonly string[];
}
