import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BrowserRuntime } from "./lib/orchestration/extension-runtime.js";
import { registerBrowserLifecycle } from "./lib/orchestration/extension-lifecycle.js";
import { registerBrowserTools } from "./lib/orchestration/extension-tool-boundary.js";
import { loadAgentBrowserConfigSync } from "./lib/config.js";
export default function agentBrowserExtension(
	pi: ExtensionAPI,
	{
		beforeExecute,
	}: { readonly beforeExecute?: (toolCallId: string, ctx: ExtensionContext) => Promise<void> } = {},
): void {
	const runtime = new BrowserRuntime(pi, beforeExecute);
	runtime.prompt.register();
	registerBrowserLifecycle(runtime);
	registerBrowserTools(runtime);
	runtime.prompt.registerWebSearch(
		loadAgentBrowserConfigSync({ cwd: process.cwd(), includeProjectConfig: false }),
	);
}
