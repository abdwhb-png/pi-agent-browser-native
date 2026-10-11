/** Pi transcript observations and bounded polling for the configured-source lifecycle harness. */
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SENTINEL_CUSTOM_TYPE = "piab-lifecycle-sentinel";

/** @typedef {{readonly [key: string]: unknown, readonly details?: Readonly<Record<string, unknown>>}} LifecycleToolResult */
/** @typedef {{readonly entries: readonly unknown[], readonly result: LifecycleToolResult, readonly results: readonly LifecycleToolResult[], readonly sessionFile: string}} LifecycleResultReport */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {Record<string, unknown> | undefined} */
export function record(value) {
	return isRecord(value) ? value : undefined;
}

/** @param {string} text @returns {unknown[]} */
export function parseJsonl(text) {
	const entries = [];
	for (const [index, line] of text.split("\n").entries()) {
		if (line.trim().length === 0) {
			continue;
		}
		try {
			entries.push(JSON.parse(line));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Invalid JSONL at line ${index + 1}: ${message}`, { cause: error });
		}
	}
	return entries;
}

/** @param {readonly unknown[]} entries @returns {LifecycleToolResult[]} */
export function agentBrowserResults(entries) {
	return entries.flatMap((entry) => {
		const row = record(entry);
		const message = record(row?.message);
		if (
			row?.type !== "message" ||
			message?.role !== "toolResult" ||
			!["agent_browser", "agent_browser_code", "agent_browser_qa"].includes(message.toolName)
		) {
			return [];
		}
		// Keep every matching completed receipt, even malformed details, so polling never skips a failure.
		return [{ ...message, details: record(message.details) }];
	});
}

/** @param {readonly unknown[]} entries @returns {string[]} */
export function sentinelTokens(entries) {
	return entries.flatMap((entry) => {
		const row = record(entry);
		const token = record(row?.data)?.token;
		return row?.type === "custom" &&
			row.customType === SENTINEL_CUSTOM_TYPE &&
			typeof token === "string"
			? [token]
			: [];
	});
}

/** @param {readonly unknown[]} entries @returns {string | undefined} */
export function sessionHeaderId(entries) {
	const header = entries.map(record).find((entry) => entry?.type === "session");
	return typeof header?.id === "string" ? header.id : undefined;
}

/** @param {readonly unknown[]} results @returns {string[]} */
export function collectFullOutputPaths(results) {
	const paths = [];
	for (const result of results) {
		const details = record(record(result)?.details);
		if (typeof details?.fullOutputPath === "string") {
			paths.push(details.fullOutputPath);
		}
		if (Array.isArray(details?.fullOutputPaths)) {
			paths.push(...details.fullOutputPaths.filter((path) => typeof path === "string"));
		}
	}
	return [...new Set(paths)];
}

function normalizeComparableUrl(url) {
	if (typeof url !== "string" || url.trim().length === 0) {
		return;
	}
	try {
		const parsed = new URL(url.trim());
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return url.trim();
	}
}

function pageResultUrl(details, command) {
	const data = record(details?.data);
	return { open: data?.url, snapshot: data?.origin }[command];
}

/** @param {unknown} result @param {string} command @param {string} expectedUrl @returns {boolean} */
export function matchesSuccessfulPageResult(result, command, expectedUrl) {
	const row = record(result);
	const details = record(row?.details);
	const observedUrl = pageResultUrl(details, command);
	return (
		row?.isError === false &&
		details?.resultCategory === "success" &&
		details?.command === command &&
		typeof observedUrl === "string" &&
		normalizeComparableUrl(observedUrl) === normalizeComparableUrl(expectedUrl)
	);
}

export function sleep(ms) {
	return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export async function newestSessionFile(sessionDir) {
	const { stdout } = await execFile("find", [sessionDir, "-type", "f", "-name", "*.jsonl"]);
	const files = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.sort();
	let newest;
	let newestMtime = -1;
	for (const file of files) {
		// Inspect one transcript at a time, preserving last-in-sorted-order ties across native stat variants.
		// oxlint-disable-next-line no-await-in-loop
		const { stdout: timestamp } = await execFile("stat", ["-f", "%m", file]).catch(async () =>
			execFile("stat", ["-c", "%Y", file]),
		);
		const mtime = Number(timestamp.trim());
		if (mtime >= newestMtime) {
			newest = file;
			newestMtime = mtime;
		}
	}
	return newest;
}

/** @template T @param {{describe: string, predicate: () => Promise<T | undefined>, timeoutMs: number, intervalMs?: number, onPoll?: () => Promise<void>}} options @returns {Promise<T>} */
export async function waitFor({ describe, predicate, timeoutMs, intervalMs = 1000, onPoll }) {
	const start = Date.now();
	let lastError;
	while (Date.now() - start <= timeoutMs) {
		try {
			// Each poll must finish before deciding success, retrying, or observing a newer transcript.
			// oxlint-disable-next-line no-await-in-loop
			const result = await predicate();
			if (result) {
				return result;
			}
		} catch (error) {
			lastError = error;
		}
		if (onPoll) {
			// Finish this poll's observation before the next poll can capture another state.
			// oxlint-disable-next-line no-await-in-loop
			await onPoll();
		}
		// Poll backoff follows the completed attempt, not concurrent timers.
		// oxlint-disable-next-line no-await-in-loop
		await sleep(intervalMs);
	}
	const suffix = lastError
		? ` Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
		: "";
	throw new Error(`Timed out waiting for ${describe} after ${timeoutMs}ms.${suffix}`);
}

/** @param {string} sessionFile @returns {Promise<unknown[]>} */
export async function readEntries(sessionFile) {
	return parseJsonl(await readFile(sessionFile, "utf8"));
}

export function resultText(result) {
	const content = record(result)?.content;
	return Array.isArray(content)
		? content
				.map(record)
				.filter((item) => item?.type === "text" && typeof item.text === "string")
				.map((item) => item.text)
				.join("\n")
		: "";
}

/** @param {{describe: string, sessionFile?: string, sessionDir?: string, timeoutMs: number, sinceCount: number, predicate: (result: LifecycleToolResult) => boolean}} options @returns {Promise<LifecycleResultReport>} */
export async function waitForAgentBrowserResult({
	describe,
	sessionFile,
	sessionDir,
	timeoutMs,
	sinceCount,
	predicate,
}) {
	let activeSessionFile = sessionFile;
	const report = await waitFor({
		describe,
		timeoutMs,
		predicate: async () => {
			if (!activeSessionFile && sessionDir) {
				activeSessionFile = await newestSessionFile(sessionDir);
			}
			if (!activeSessionFile) {
				return;
			}
			const entries = await readEntries(activeSessionFile);
			const results = agentBrowserResults(entries);
			const result = results[sinceCount];
			return result ? { entries, result, results, sessionFile: activeSessionFile } : undefined;
		},
	});
	const { result } = report;
	if (!predicate(result)) {
		throw new Error(unexpectedResultMessage(describe, result));
	}
	return report;
}

function unexpectedResultMessage(describe, result) {
	return `Unexpected agent_browser result for ${describe}: call ${result.toolCallId ?? "unknown"}; command ${result.details?.command ?? "missing"}; isError ${result.isError}; category ${result.details?.resultCategory ?? "missing"}/${result.details?.failureCategory ?? result.details?.successCategory ?? "missing"}.`;
}

export async function waitForSentinel({ sessionFile, timeoutMs, token }) {
	return waitFor({
		describe: `sentinel token ${token}`,
		timeoutMs,
		predicate: async () => {
			const entries = await readEntries(sessionFile);
			return sentinelTokens(entries).includes(token) ? entries : undefined;
		},
	});
}

export async function waitForAssistantFinal({ describe, sessionFile, sinceEntryCount, timeoutMs }) {
	return waitFor({
		describe: `${describe} final assistant response`,
		timeoutMs,
		predicate: async () => {
			const entries = await readEntries(sessionFile);
			const finalMessage = entries.slice(sinceEntryCount).find((entry) => {
				const row = record(entry);
				const message = record(row?.message);
				return (
					row?.type === "message" &&
					message?.role === "assistant" &&
					Array.isArray(message.content) &&
					message.content.some(
						(item) => record(item)?.type === "text" && typeof record(item)?.text === "string",
					)
				);
			});
			return finalMessage ? entries : undefined;
		},
	});
}
