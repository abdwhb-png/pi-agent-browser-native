import type { AgentBrowserNextAction } from "./action-contracts.js";
import type { AgentBrowserNextActionOptions } from "./recommendation-contracts.js";
import { buildNextToolAction } from "./next-actions.js";

function buildElectronToolAction(options: {
	readonly action: "cleanup" | "probe" | "status";
	readonly id: string;
	readonly launchId: string;
	readonly reason: string;
	readonly safety?: string;
}): AgentBrowserNextAction {
	return {
		id: options.id,
		params: { action: options.action, launchId: options.launchId },
		reason: options.reason,
		...(options.safety !== undefined && options.safety.length > 0
			? { safety: options.safety }
			: {}),
		tool: "agent_browser_electron",
	};
}

function buildActiveLaunchActions(launchId: string): AgentBrowserNextAction[] {
	return [
		buildElectronToolAction({
			action: "status",
			id: "status-electron-launch",
			launchId,
			reason:
				"Check the wrapper-tracked Electron launch liveness and current CDP targets without mutating the app.",
		}),
		buildElectronToolAction({
			action: "probe",
			id: "probe-electron-launch",
			launchId,
			reason:
				"Probe the attached Electron managed session and carry the wrapper launchId for follow-up diagnostics.",
		}),
		buildElectronToolAction({
			action: "cleanup",
			id: "cleanup-electron-launch",
			launchId,
			reason:
				"Clean the wrapper-owned Electron process and isolated userDataDir when the run is complete.",
			safety:
				"Only operates on the launchId created by electron.launch; explicit artifacts and manually launched apps remain host-owned.",
		}),
	];
}

function buildElectronSessionActions(sessionName: string | undefined): AgentBrowserNextAction[] {
	if (sessionName === undefined || sessionName.length === 0) {
		return [];
	}
	return [
		buildNextToolAction({
			args: ["--session", sessionName, "tab", "list"],
			id: "list-electron-tabs",
			reason: "Inspect attached Electron page/webview targets before choosing the active tab.",
		}),
		buildNextToolAction({
			args: ["--session", sessionName, "snapshot", "-i"],
			id: "snapshot-electron-session",
			reason: "Refresh interactive refs for the attached Electron session.",
			safety: "Use current Electron refs only after a fresh snapshot for this session.",
		}),
	];
}

export function buildElectronNextActions(
	options: AgentBrowserNextActionOptions,
): AgentBrowserNextAction[] {
	const launchId = options.electron?.launchId;
	if (launchId === undefined || launchId.length === 0) {
		return [];
	}
	if (options.resultCategory === "success" && options.electron?.status !== "cleaned") {
		return [
			...buildActiveLaunchActions(launchId),
			...buildElectronSessionActions(options.electron?.sessionName),
		];
	}
	if (options.resultCategory === "failure" && options.failureCategory === "cleanup-failed") {
		return [
			buildElectronToolAction({
				action: "status",
				id: "status-electron-launch",
				launchId,
				reason: "Inspect which wrapper-tracked Electron resources remain after partial cleanup.",
			}),
			buildElectronToolAction({
				action: "cleanup",
				id: "retry-electron-cleanup",
				launchId,
				reason:
					"Retry cleanup for the same wrapper-owned Electron launch after reviewing remaining resources.",
				safety:
					"Only retry for the same launchId; do not use cleanup for manually launched Electron apps.",
			}),
		];
	}
	return [];
}
