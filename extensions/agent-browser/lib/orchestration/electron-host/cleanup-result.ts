import type { ElectronCleanupResult } from "../../electron/cleanup.js";
import type { CompiledAgentBrowserElectron } from "../../input-modes/types.js";
import { buildAgentBrowserNextActions } from "../../results/action-recommendations.js";
import { buildAgentBrowserResultCategoryDetails } from "../../results/categories.js";
import { redactSensitiveText } from "../../runtime-redaction.js";
import { redactToolDetails } from "../browser-run/final-result-redaction.js";
import type { AgentBrowserToolResult } from "../browser-run/types.js";
function formatElectronCleanupVisibleText(results: readonly ElectronCleanupResult[]): string {
	if (results.length === 0) {
		return "Electron cleanup: no active wrapper-tracked launches.";
	}
	const lines = [
		`Electron cleanup: ${results.filter((result) => !result.partial).length}/${results.length} launch(es) fully cleaned.`,
	];
	for (const result of results) {
		lines.push(`- ${result.summary}`);
		for (const step of result.steps) {
			lines.push(
				`  - ${step.resource}: ${step.state}${step.error !== undefined && step.error.length > 0 ? ` (${step.error})` : ""}`,
			);
		}
	}
	return lines.join("\n");
}
export function buildElectronCleanupResult(
	compiledElectron: CompiledAgentBrowserElectron,
	cleanupResults: readonly ElectronCleanupResult[],
): AgentBrowserToolResult {
	const partial = cleanupResults.some((result) => result.partial);
	const records = cleanupResults.map((result) => result.record);
	const nextActions = cleanupResults.flatMap(
		(result) =>
			buildAgentBrowserNextActions({
				electron: {
					launchId: result.launchId,
					sessionName: result.record.sessionName,
					status: result.record.cleanupState,
				},
				failureCategory: partial ? "cleanup-failed" : undefined,
				resultCategory: partial ? "failure" : "success",
				successCategory: partial ? undefined : "completed",
			}) ?? [],
	);
	const errorText = partial ? cleanupResults.map((result) => result.summary).join("\n") : undefined;
	const details = {
		args: [],
		compiledElectron,
		electron: {
			action: "cleanup" as const,
			cleanup: { partial, records, results: cleanupResults },
			status: partial ? "partial" : "succeeded",
		},
		nextActions: nextActions.length > 0 ? nextActions : undefined,
		...buildAgentBrowserResultCategoryDetails({
			args: [],
			errorText,
			failureCategory: partial ? "cleanup-failed" : undefined,
			succeeded: !partial,
		}),
		summary: partial ? "Electron cleanup was partial." : "Electron cleanup completed.",
	};
	return {
		content: [
			{ type: "text", text: redactSensitiveText(formatElectronCleanupVisibleText(cleanupResults)) },
		],
		details: redactToolDetails(details, []),
		isError: partial,
	};
}
