import { rm } from "node:fs/promises";
import type { BrowserProcessOutputResult } from "./types.js";
import type { NativeOutputPhase } from "./process-output-native-phase-contracts.js";
import type { PageOutputPhase } from "./process-output-page-phase-contracts.js";
import type { LifecycleOutputPhase } from "./process-output-lifecycle-phase-contracts.js";
import type { PublicationOutputPhase } from "./process-output-publication-phase-contracts.js";
import { captureBrowserOutputOwnership } from "./process-output-ownership.js";
import { observeNativeEffects } from "./process-output-native-phase.js";
import { observePageEffects } from "./process-output-page-phase.js";
import { commitLifecycleEffects } from "./process-output-lifecycle-phase.js";
import { publishOutputEffects } from "./process-output-publication-phase.js";
import { buildOutputResult, type BuildOutputResultInput } from "./process-output-publication.js";
type BrowserOutputInvocation = NativeOutputPhase["input"] &
	PageOutputPhase["input"] &
	LifecycleOutputPhase["input"] &
	PublicationOutputPhase["input"] &
	BuildOutputResultInput["input"];
export async function processBrowserOutput(
	input: BrowserOutputInvocation,
): Promise<BrowserProcessOutputResult> {
	const ownership = captureBrowserOutputOwnership(input);
	try {
		const native = await observeNativeEffects(input, ownership);
		const page = await observePageEffects(input, native);
		const lifecycle = await commitLifecycleEffects(input, native, page, ownership);
		const { publication, recovery } = await publishOutputEffects(input, native, page, lifecycle);
		return buildOutputResult({ input, native, page, lifecycle, publication }, recovery);
	} finally {
		const path = input.processResult.stdoutSpillPath;
		if (path !== undefined && path.length > 0) {
			await rm(path, { force: true }).catch(() => {
				// This raw spool is disposable and may already be removed; cleanup must not replace the native outcome or a publication failure.
			});
		}
	}
}
