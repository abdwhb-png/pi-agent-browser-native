import { getBrowserRecord, type BrowserRecord } from "../browser-transcript.js";

class PendingOwnedBrowserIntents {
	readonly begins = new Map<string, BrowserRecord["event"]>();
	constructor(readonly ownerSessionId: string | undefined) {}
	clearPage(key: string): void {
		for (const [id, begin] of this.begins) {
			if (begin.pages?.some((page) => page.key === key) === true) {
				this.begins.delete(id);
			}
		}
	}
	apply(event: BrowserRecord["event"]): void {
		if (
			event.phase === "begin" &&
			event.state.ownerSessionId === this.ownerSessionId &&
			event.state.wrapperManaged === true
		) {
			this.begins.set(event.operationId, event);
		} else if (event.phase === "finish") {
			this.begins.delete(event.operationId);
		}
		for (const page of event.pages ?? []) {
			if (page.clear) {
				this.clearPage(page.key);
			}
		}
	}
}
/** Interrupted owned intents retain cleanup scope, never proof of a successful launch. */
export function collectPendingOwnedBrowserIntents(
	branch: readonly unknown[],
	ownerSessionId: string | undefined,
): readonly BrowserRecord["event"][] {
	const pending = new PendingOwnedBrowserIntents(ownerSessionId);
	for (const entry of branch) {
		const event = getBrowserRecord(entry)?.event;
		if (event) {
			pending.apply(event);
		}
	}
	return [...pending.begins.values()];
}
