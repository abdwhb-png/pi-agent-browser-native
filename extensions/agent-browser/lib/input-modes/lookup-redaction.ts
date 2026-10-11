import { isRecord } from "../parsing.js";
import { redactInvocationArgs, redactSensitiveText } from "../runtime-redaction.js";
import type { AgentBrowserNetworkSourceLookupAnalysis } from "./types.js";

export function redactNetworkSourceLookupUrl(value: string | undefined): string | undefined {
	if (value === undefined || value.length === 0) {
		return value;
	}
	try {
		const isRelative = value.startsWith("/");
		const url = new URL(value, isRelative ? "https://redacted.invalid" : undefined);
		url.username = url.username.length > 0 ? "[REDACTED]" : "";
		url.password = url.password.length > 0 ? "[REDACTED]" : "";
		// Snapshot keys before set() collapses duplicates and changes iterator positions.
		for (const key of Array.from(url.searchParams.keys())) {
			url.searchParams.set(key, "[REDACTED]");
		}
		if (/(?:token|secret|password|passwd|pwd|key|auth|session|jwt|credential)/i.test(url.hash)) {
			url.hash = "#[REDACTED]";
		}
		return isRelative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
	} catch {
		return redactSensitiveText(
			value
				.replace(/([a-z][a-z0-9+.-]*:\/\/)\S+:\S+@/gi, "$1[REDACTED]@")
				.replace(/([?&][^=]+)=([^&#\s"'\]]+)/g, "$1=[REDACTED]"),
		);
	}
}

export function redactNetworkSourceLookupArgs(args: readonly string[]): string[] {
	return redactInvocationArgs(args).map((arg) => redactNetworkSourceLookupUrl(arg) ?? arg);
}

export function redactNetworkSourceLookupSurface(value: unknown): unknown {
	if (typeof value === "string") {
		return redactNetworkSourceLookupUrl(value) ?? value;
	}
	if (Array.isArray(value)) {
		return value.map((item: unknown) => redactNetworkSourceLookupSurface(item));
	}
	if (!isRecord(value)) {
		return value;
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, redactNetworkSourceLookupSurface(item)]),
	);
}

export function redactNetworkSourceLookupAnalysis(
	analysis: AgentBrowserNetworkSourceLookupAnalysis,
): AgentBrowserNetworkSourceLookupAnalysis {
	return {
		...analysis,
		candidates: analysis.candidates.map((candidate) => ({
			...candidate,
			evidence: candidate.evidence.map(
				(item) => redactNetworkSourceLookupUrl(item) ?? redactSensitiveText(item),
			),
			file: redactNetworkSourceLookupUrl(candidate.file),
			requestUrl: redactNetworkSourceLookupUrl(candidate.requestUrl),
		})),
		failedRequests: analysis.failedRequests.map((request) => ({
			...request,
			error: redactNetworkSourceLookupUrl(request.error),
			url: redactNetworkSourceLookupUrl(request.url),
		})),
	};
}
