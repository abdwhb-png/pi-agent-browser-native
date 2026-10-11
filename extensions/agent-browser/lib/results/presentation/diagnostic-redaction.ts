import type { CommandInfo } from "../../argv-descriptor.js";
import { isRecord } from "../../parsing.js";
import { getUpstreamEffectiveBatchSteps } from "../../orchestration/batch-stdin.js";
import { redactSensitiveText, redactSensitiveValue } from "../../runtime.js";
import { formatStorageValue, redactStorageData } from "./diagnostic-storage.js";

function redactStatefulValues(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item: unknown) => redactStatefulValues(item));
	}
	if (!isRecord(value)) {
		return redactSensitiveValue(value);
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, entryValue]) => [
			key,
			key.toLowerCase() === "value" ? "[REDACTED]" : redactStatefulValues(entryValue),
		]),
	);
}

function storageTextKey(command: CommandInfo): string | undefined {
	const operation = command.commandTokens?.[2];
	if (operation === "get") {
		return command.commandTokens?.[3];
	}
	return operation === "set" || operation === "clear" ? undefined : operation;
}

function redactStorageText(command: CommandInfo, text: string): string {
	const key = storageTextKey(command);
	if (key !== undefined && text.startsWith(`${key}: `)) {
		const suffix = text.endsWith("\n") ? "\n" : "";
		const value = text.slice(key.length + 2, suffix.length > 0 ? -1 : undefined);
		return `${key}: ${formatStorageValue(key, value)}${suffix}`;
	}
	// ponytail: native all-entry/raw-batch text does not escape multiline values.
	// Format heuristics cannot separate lookalike entries; use structured JSON for sensitive storage.
	return text.replace(
		/^([^\r\n]*?): ([^\r\n]*)/gm,
		(_line, entryKey: string, value: string) =>
			`${entryKey}: ${formatStorageValue(entryKey, value)}`,
	);
}

function redactNativeContextText(command: CommandInfo, text: string, stdin?: string): string {
	if (command.command === "batch") {
		const steps = getUpstreamEffectiveBatchSteps(command.commandTokens ?? ["batch"], stdin);
		const cookieRedacted = steps.some((step) => step[0] === "cookies")
			? redactNativeContextText({ command: "cookies" }, text)
			: text;
		return steps.some((step) => step[0] === "storage")
			? redactNativeContextText({ command: "storage" }, cookieRedacted)
			: cookieRedacted;
	}
	if (command.command === "cookies") {
		return text.replace(/^([^=\r\n]*)=([^\r\n]*)/gm, "$1=[REDACTED]");
	}
	return command.command === "storage" ? redactStorageText(command, text) : text;
}

export function redactPresentationData(
	command: CommandInfo,
	data: unknown,
	stdin?: string,
): unknown {
	if (typeof data === "string") {
		return redactSensitiveText(redactNativeContextText(command, data, stdin));
	}
	if (command.command === "cookies") {
		return redactStatefulValues(data);
	}
	if (command.command === "storage") {
		return redactStorageData(data);
	}
	if (command.command === "state" && command.subcommand === "show") {
		return redactStatefulValues(data);
	}
	return redactSensitiveValue(data);
}
