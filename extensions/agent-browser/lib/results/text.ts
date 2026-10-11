export function stringifyUnknown(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value === null || value === undefined) {
		return "";
	}
	try {
		const serialized: unknown = JSON.stringify(value, null, 2);
		return typeof serialized === "string" ? serialized : "";
	} catch {
		return stringifyFallback(value);
	}
}

function stringifyFallback(value: unknown): string {
	if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
		return String(value);
	}
	return Object.prototype.toString.call(value);
}

export function countLines(text: string): number {
	return text.length === 0 ? 0 : text.split("\n").length;
}

export function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

export function compareRefIds(left: string, right: string): number {
	const leftMatch = left.match(/^(?:[a-zA-Z]+)?(\d+)$/);
	const rightMatch = right.match(/^(?:[a-zA-Z]+)?(\d+)$/);
	if (leftMatch && rightMatch) {
		return Number(leftMatch[1]) - Number(rightMatch[1]);
	}
	return left.localeCompare(right);
}
