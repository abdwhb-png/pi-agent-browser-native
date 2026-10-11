import { isRecord } from "../parsing.js";
import { getBatchResultItems } from "./shared.js";
import type { AgentBrowserSourceLookupCandidate } from "./types.js";

interface SourceHint {
	readonly source: "react-inspect" | "dom-attribute";
	readonly evidence: readonly string[];
}

function extractStringField(
	value: Readonly<Record<string, unknown>>,
	names: readonly string[],
): string | undefined {
	for (const name of names) {
		const field = value[name];
		if (typeof field === "string" && field.trim().length > 0) {
			return field;
		}
	}
	return undefined;
}

function extractNumberField(
	value: Readonly<Record<string, unknown>>,
	names: readonly string[],
): number | undefined {
	for (const name of names) {
		const field = value[name];
		if (typeof field === "number" && Number.isFinite(field)) {
			return field;
		}
		if (typeof field === "string" && /^\d+$/.test(field)) {
			return Number(field);
		}
	}
	return undefined;
}

function candidateKey(candidate: AgentBrowserSourceLookupCandidate): string {
	return [
		candidate.source,
		candidate.file ?? "",
		candidate.line ?? "",
		candidate.column ?? "",
		candidate.componentName ?? "",
	].join(":");
}

export function distinctSourceCandidates(
	candidates: readonly AgentBrowserSourceLookupCandidate[],
): AgentBrowserSourceLookupCandidate[] {
	const keys = new Set<string>();
	return candidates.filter((candidate) => {
		const key = candidateKey(candidate);
		if (keys.has(key)) {
			return false;
		}
		keys.add(key);
		return true;
	});
}

function sourceTextCandidates(
	value: string,
	hint: SourceHint,
): AgentBrowserSourceLookupCandidate[] {
	const pattern = /([A-Za-z0-9_./@-]+\.(?:tsx|jsx|ts|js))(?:[:#](\d+))?(?:[:#](\d+))?/g;
	return [...value.matchAll(pattern)].map((match) => ({
		column: match.at(3) !== undefined ? Number(match[3]) : undefined,
		confidence: hint.source === "react-inspect" ? "high" : "medium",
		evidence: hint.evidence,
		file: match[1],
		line: match.at(2) !== undefined ? Number(match[2]) : undefined,
		source: hint.source,
	}));
}

function sourceRecordCandidate(
	value: Readonly<Record<string, unknown>>,
	hint: SourceHint,
): AgentBrowserSourceLookupCandidate[] {
	const file = extractStringField(value, [
		"file",
		"fileName",
		"filename",
		"filePath",
		"path",
		"source",
		"url",
	]);
	if (file === undefined || !/\.(?:tsx|jsx|ts|js)(?:$|[:?#])/.test(file)) {
		return [];
	}
	return [
		{
			column: extractNumberField(value, ["column", "columnNumber", "col"]),
			confidence: hint.source === "react-inspect" ? "high" : "medium",
			evidence: hint.evidence,
			file,
			line: extractNumberField(value, ["line", "lineNumber"]),
			source: hint.source,
		},
	];
}

export function sourceCandidatesFromValue(
	value: unknown,
	hint: SourceHint,
	depth = 0,
): AgentBrowserSourceLookupCandidate[] {
	if (depth > 6 || value === undefined || value === null) {
		return [];
	}
	if (typeof value === "string") {
		return sourceTextCandidates(value, hint);
	}
	if (Array.isArray(value)) {
		return value.flatMap((item: unknown) => sourceCandidatesFromValue(item, hint, depth + 1));
	}
	if (!isRecord(value)) {
		return [];
	}
	return [
		...sourceRecordCandidate(value, hint),
		...Object.values(value).flatMap((nested) => sourceCandidatesFromValue(nested, hint, depth + 1)),
	];
}

function getHtmlAttributeValue(html: string, name: string): string | undefined {
	return new RegExp(`${name}=["']([^"']+)["']`, "i").exec(html)?.[1];
}

function htmlAttributeNumber(html: string, name: string): number | undefined {
	const value = getHtmlAttributeValue(html, name);
	return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

function domSourceCandidates(html: unknown): AgentBrowserSourceLookupCandidate[] {
	if (typeof html !== "string") {
		return [];
	}
	const file = getHtmlAttributeValue(
		html,
		"(?:data-source-file|data-file|data-component-file|data-source)",
	);
	const attributes: AgentBrowserSourceLookupCandidate[] = [];
	if (file !== undefined && /\.(?:tsx|jsx|ts|js)$/.test(file)) {
		attributes.push({
			column: htmlAttributeNumber(html, "(?:data-source-column|data-column)"),
			confidence: "medium",
			evidence: ["selector HTML contained source-like data attributes"],
			file,
			line: htmlAttributeNumber(html, "(?:data-source-line|data-line)"),
			source: "dom-attribute",
		});
	}
	return [
		...attributes,
		...sourceCandidatesFromValue(html, {
			source: "dom-attribute",
			evidence: ["selector HTML contained source-like text"],
		}),
	];
}

export function getLookupResultPayload(item: Readonly<Record<string, unknown>>): unknown {
	return isRecord(item.result) && "data" in item.result ? item.result.data : item.result;
}

export function observeSourceCandidates(data: unknown): {
	readonly candidates: readonly AgentBrowserSourceLookupCandidate[];
	readonly unsupported: boolean;
} {
	const candidates: AgentBrowserSourceLookupCandidate[] = [];
	let unsupported = false;
	for (const item of getBatchResultItems(data)) {
		const command: readonly unknown[] = Array.isArray(item.command) ? item.command : [];
		const result = getLookupResultPayload(item);
		if (item.success === false && command[0] === "react") {
			unsupported = true;
		}
		if (command[0] === "react" && command[1] === "inspect") {
			candidates.push(
				...sourceCandidatesFromValue(result, {
					source: "react-inspect",
					evidence: ["react inspect returned source-like metadata"],
				}),
			);
		}
		if (command[0] === "get" && command[1] === "html") {
			candidates.push(...domSourceCandidates(result));
		}
	}
	return { candidates: distinctSourceCandidates(candidates), unsupported };
}
