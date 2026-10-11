import type { ElectronAppDiscovery, ElectronDiscoveryResult } from "../../electron/discovery.js";
import type { CompiledAgentBrowserElectron } from "../../input-modes/types.js";
import { buildAgentBrowserResultCategoryDetails } from "../../results/categories.js";
import { redactSensitiveText } from "../../runtime-redaction.js";
import { normalizeProcessError } from "../../process-errors.js";
import { redactToolDetails } from "../browser-run/final-result-redaction.js";
import type { AgentBrowserToolResult } from "../browser-run/types.js";

const ELECTRON_PROFILE_ISOLATION_NOTE =
	"Profile note: electron.launch starts an isolated temporary profile; it does not reuse the app's normal signed-in profile or attach to an already-running authenticated app.";
const ELECTRON_EXISTING_AUTH_GUIDANCE =
	"For already-authenticated desktop app content, do not stop here: if host tools are allowed and the app is not running, launch the normal app with --remote-debugging-port=<port>, verify the port, then run agent_browser connect <port>; if it is already running without a debug port, ask before relaunching it.";
export const ELECTRON_PROFILE_ISOLATION_DETAILS = {
	attachesToAlreadyRunningApp: false,
	existingAuthenticatedAppGuidance: ELECTRON_EXISTING_AUTH_GUIDANCE,
	hostDebugLaunchExample:
		"macOS: open -a <App Name> --args --remote-debugging-port=9222 --remote-allow-origins='*'; then agent_browser connect 9222 with sessionMode=fresh",
	isolatedLaunch: true,
	note: ELECTRON_PROFILE_ISOLATION_NOTE,
	reusesExistingSignedInProfile: false,
} as const;

function formatApp(app: ElectronAppDiscovery): string {
	const identifier = app.bundleId ?? app.desktopId;
	const path = app.appPath ?? app.executablePath;
	const sensitivity = app.sensitivity
		? ` [likely sensitive: ${app.sensitivity.categories.join(", ")}]`
		: "";
	return `- ${app.name}${identifier !== undefined && identifier.length > 0 ? ` (${identifier})` : ""}${sensitivity} — ${path}`;
}
function formatElectronListVisibleText(result: ElectronDiscoveryResult): string {
	const visibleApps = result.apps.slice(0, 10);
	const visibleOmittedCount = Math.max(0, result.apps.length - visibleApps.length);
	const header =
		result.omittedCount > 0
			? `Electron apps (${result.apps.length} shown, ${result.omittedCount} omitted):`
			: `Electron apps (${result.apps.length} found):`;
	const lines = [header];
	if (visibleApps.length === 0) {
		lines.push(
			result.query !== undefined && result.query.length > 0
				? `No Electron apps matched query "${result.query}".`
				: "No Electron apps found in the supported scan locations.",
		);
	} else {
		lines.push(...visibleApps.map(formatApp));
	}
	if (visibleOmittedCount > 0) {
		lines.push(
			`${visibleOmittedCount} additional app(s) omitted from visible output; see details.electron.apps.`,
		);
	}
	if (result.omittedCount > 0) {
		lines.push(`${result.omittedCount} app(s) omitted by maxResults=${result.maxResults}.`);
	}
	if (result.apps.some((app) => app.sensitivity?.level === "likely-sensitive")) {
		lines.push(
			"Review likely-sensitive apps and use caller-owned allow/deny policy before launch.",
			ELECTRON_PROFILE_ISOLATION_NOTE,
			ELECTRON_EXISTING_AUTH_GUIDANCE,
		);
	}
	return lines.join("\n");
}
function buildElectronListSuccessResult(
	compiledElectron: CompiledAgentBrowserElectron,
	discovery: ElectronDiscoveryResult,
): AgentBrowserToolResult {
	const text = redactSensitiveText(formatElectronListVisibleText(discovery));
	const sensitiveAppCount = discovery.apps.filter(
		(app) => app.sensitivity?.level === "likely-sensitive",
	).length;
	const details = {
		args: [],
		compiledElectron,
		electron: {
			action: "list" as const,
			apps: discovery.apps,
			maxResults: discovery.maxResults,
			omittedCount: discovery.omittedCount === 0 ? undefined : discovery.omittedCount,
			platform: discovery.platform,
			profileIsolation: ELECTRON_PROFILE_ISOLATION_DETAILS,
			query: discovery.query,
			sensitiveAppCount: sensitiveAppCount === 0 ? undefined : sensitiveAppCount,
			skippedCount: discovery.skippedCount,
			status: "succeeded" as const,
		},
		...buildAgentBrowserResultCategoryDetails({ args: [], succeeded: true }),
		summary:
			discovery.omittedCount > 0
				? `Electron app discovery found ${discovery.apps.length} app(s) and omitted ${discovery.omittedCount}.`
				: `Electron app discovery found ${discovery.apps.length} app(s).`,
	};
	return {
		content: [{ type: "text", text }],
		details: redactToolDetails(details, []),
		isError: false,
	};
}
function buildElectronListFailureResult(
	compiledElectron: CompiledAgentBrowserElectron,
	error: unknown,
): AgentBrowserToolResult {
	const errorText = normalizeProcessError(error).message;
	const text = redactSensitiveText(`Electron app discovery failed: ${errorText}`);
	const details = {
		args: [],
		compiledElectron,
		electron: { action: "list" as const, error: errorText, status: "failed" as const },
		...buildAgentBrowserResultCategoryDetails({ args: [], errorText, succeeded: false }),
		summary: "Electron app discovery failed.",
	};
	return {
		content: [{ type: "text", text }],
		details: redactToolDetails(details, []),
		isError: true,
	};
}
export async function discoverElectronHostApps(
	compiledElectron: Extract<CompiledAgentBrowserElectron, { action: "list" }>,
	visibleInput: CompiledAgentBrowserElectron,
): Promise<AgentBrowserToolResult> {
	try {
		const { discoverElectronApps } = await import("../../electron/discovery.js");
		const discovery = await discoverElectronApps({
			maxResults: compiledElectron.maxResults,
			query: compiledElectron.query,
		});
		return buildElectronListSuccessResult(visibleInput, discovery);
	} catch (error) {
		return buildElectronListFailureResult(visibleInput, error);
	}
}
