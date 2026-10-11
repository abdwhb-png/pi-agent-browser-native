import { isOpenNavigationCommand, isPageMutationCommand } from "../command-taxonomy.js";
import type { AgentBrowserNextAction } from "./action-contracts.js";
import type { AgentBrowserNextActionOptions } from "./recommendation-contracts.js";
import { applySessionToNextActions, buildNextToolAction } from "./next-actions.js";
import { buildRecoveryNextActions } from "./recovery-actions.js";
import { buildElectronNextActions } from "./electron-recommendations.js";
import {
	buildPendingRecordingNextActions,
	buildSavedArtifactNextActions,
} from "./artifact-recommendations.js";
import { buildFailureNextActions } from "./failure-recommendations.js";

function buildSuccessNavigationActions(
	options: AgentBrowserNextActionOptions,
): AgentBrowserNextAction[] {
	if (isOpenNavigationCommand(options.command)) {
		return [
			buildNextToolAction({
				args: ["snapshot", "-i"],
				id: "inspect-opened-page",
				reason: "Inspect the opened page before choosing interactive refs.",
			}),
		];
	}
	return isPageMutationCommand(options.command, options.subcommand)
		? [
				buildNextToolAction({
					args: ["snapshot", "-i"],
					id: "inspect-after-mutation",
					reason:
						"Refresh interactive refs after a browser mutation, navigation, scroll, or rerender.",
					safety: "Do not reuse prior @refs until a fresh snapshot confirms they still exist.",
				}),
			]
		: [];
}

export function buildAgentBrowserNextActions(
	options: AgentBrowserNextActionOptions,
): readonly AgentBrowserNextAction[] | undefined {
	const actions = [
		...(options.recovery ? buildRecoveryNextActions(options.recovery) : []),
		...buildElectronNextActions(options),
		...(options.resultCategory === "success"
			? [...buildSuccessNavigationActions(options), ...buildSavedArtifactNextActions(options)]
			: buildFailureNextActions(options)),
		...buildPendingRecordingNextActions(options.artifacts),
	];
	return applySessionToNextActions(actions.length > 0 ? actions : undefined, options.sessionName);
}
