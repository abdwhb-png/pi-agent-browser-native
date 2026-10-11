import { buildExecutionPlan, createFreshSessionName } from "../runtime.js";
import type { BrowserRuntime } from "./extension-runtime.js";
import type { AgentBrowserToolResult } from "./browser-run/types.js";
import { runWithLaunchDefaults } from "./extension-execution-locks.js";
import type { BrowserCommandCall } from "./extension-invocation.js";

export function runWithinSessionQueue(
	runtime: BrowserRuntime,
	call: BrowserCommandCall,
): Promise<AgentBrowserToolResult> {
	if (call.closesAllSessions) {
		return runtime.managedSessionExecutionQueue.run(() => {
			const plan = buildExecutionPlan(call.toolArgs, {
				freshSessionName: createFreshSessionName(
					runtime.managed.baseName,
					runtime.ephemeralSessionSeed,
					runtime.managed.freshOrdinal + 1,
				),
				managedSessionActive: runtime.managed.active,
				managedSessionCompatibilityWorkaround: runtime.managed.compatibilityWorkaround,
				managedSessionName: runtime.managed.name,
				managedSessionNamespace: runtime.managed.namespace,
				sessionMode: call.params.sessionMode ?? "auto",
				stdin: call.resolvedInput.toolStdin,
			});
			return runtime.callerOwnedSessionExecutionQueues.runExclusive(plan.namespace, () =>
				runWithLaunchDefaults(runtime, call),
			);
		});
	}
	if (call.serializeBrowserCommand) {
		return runtime.managedSessionExecutionQueue.run(
			() => runWithLaunchDefaults(runtime, call),
			call.signal,
		);
	}
	return call.callerOwnedSessionQueueKey !== undefined && call.callerOwnedSessionQueueKey !== ""
		? runtime.callerOwnedSessionExecutionQueues.run(
				call.callerOwnedSessionQueueKey,
				call.callerOwnedSessionNamespace,
				() => runWithLaunchDefaults(runtime, call),
				call.signal,
			)
		: runWithLaunchDefaults(runtime, call);
}
