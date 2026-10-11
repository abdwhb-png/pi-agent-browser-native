export function isBrowserStringArray(value: unknown): value is readonly string[] {
	if (!Array.isArray(value)) {
		return false;
	}
	const rows: readonly unknown[] = value;
	return rows.every((row) => typeof row === "string");
}

/** Normalize only string rows from an untrusted native/transcript array, retaining their order. */
export function browserStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const rows: readonly unknown[] = value;
	return rows.filter((row): row is string => typeof row === "string");
}
