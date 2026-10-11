import { isRecord } from "../../parsing.js";
import { redactSensitiveText, redactSensitiveValue } from "../../runtime.js";
import {
	getArrayField,
	getStringField,
	redactModelFacingText,
	stringifyModelFacing,
} from "./common.js";

type Data = Readonly<Record<string, unknown>>;
const STORAGE_VALUE_PREVIEW_MAX_CHARS = 160;
const STORAGE_SECRET_KEY_PATTERN =
	/(?:access(?:_|-)?token|account|api(?:_|-)?key|auth(?:orization)?|bearer|client(?:_|-)?secret|cookie|credential|csrf|email|id(?:_|-)?token|jwt|pass(?:word)?|private(?:_|-)?key|profile|refresh(?:_|-)?token|secret|session|sid|sig(?:nature)?|token|user(?:name)?|x(?:_|-)?api(?:_|-)?key|xsrf)/i;
const STORAGE_BENIGN_KEY_PATTERN =
	/^(?:color(?:scheme)?|debug|dev|experiment|feature(?:flag)?|flag|language|layout|locale|mode|onboarding|sort|tab|theme|timezone|tour|variant|view)$/i;
const STORAGE_TOKEN_VALUE_PATTERN =
	/(?:\bBearer\s+[A-Za-z0-9._~-]+|\bBasic\s+[A-Za-z0-9+/=]+|^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$|(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_~+/=-]{32,})/;
const STORAGE_SECRET_VALUE_WORD_PATTERN =
	/(?:secret|token|password|passwd|bearer|credential|authorization|cookie|session[-_ ]?id)/i;
const STORAGE_EMAIL_VALUE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STORAGE_IDENTITY_VALUE_PATTERN =
	/(?:^|[\s:=/_-])(?:account|profile|session|sid|user(?:id|name)?)(?:[\s:=/_-]|$)/i;

function storageTextContainsSecret(text: string): boolean {
	if (
		STORAGE_TOKEN_VALUE_PATTERN.test(text) ||
		STORAGE_SECRET_VALUE_WORD_PATTERN.test(text) ||
		STORAGE_EMAIL_VALUE_PATTERN.test(text) ||
		STORAGE_IDENTITY_VALUE_PATTERN.test(text)
	) {
		return true;
	}
	if (storageTextIsSensitiveUrl(text) || redactSensitiveText(text) !== text) {
		return true;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		return valueContainsStorageSecret(parsed);
	} catch {
		// Non-JSON primitives remain eligible for the bounded benign-key preview.
		return false;
	}
}

function storageTextIsSensitiveUrl(text: string): boolean {
	try {
		const url = new URL(text);
		return (
			url.protocol === "http:" ||
			url.protocol === "https:" ||
			url.username.length > 0 ||
			url.password.length > 0 ||
			url.search.length > 0
		);
	} catch {
		// Ordinary storage text need not be a URL; continue the other secret checks.
		return false;
	}
}

function valueContainsStorageSecret(value: unknown): boolean {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 && storageTextContainsSecret(trimmed);
	}
	if (Array.isArray(value)) {
		return value.some((item: unknown) => valueContainsStorageSecret(item));
	}
	if (!isRecord(value)) {
		return false;
	}
	return Object.entries(value).some(
		([key, entryValue]) =>
			STORAGE_SECRET_KEY_PATTERN.test(key) || valueContainsStorageSecret(entryValue),
	);
}

function shouldRevealStorageValue(key: string | undefined, value: unknown): boolean {
	if (
		key === undefined ||
		key.length === 0 ||
		STORAGE_SECRET_KEY_PATTERN.test(key) ||
		!STORAGE_BENIGN_KEY_PATTERN.test(key)
	) {
		return false;
	}
	if (valueContainsStorageSecret(value)) {
		return false;
	}
	if (typeof value === "string") {
		return value.length <= STORAGE_VALUE_PREVIEW_MAX_CHARS;
	}
	return value === null || typeof value === "number" || typeof value === "boolean";
}

export function formatStorageValue(key: string | undefined, value: unknown): string {
	if (!shouldRevealStorageValue(key, value)) {
		return "[REDACTED]";
	}
	return typeof value === "string" ? redactModelFacingText(value) : stringifyModelFacing(value);
}

function storageRedactionReason(key: string | undefined): string {
	return key !== undefined && key.length > 0 && STORAGE_SECRET_KEY_PATTERN.test(key)
		? "sensitive-key"
		: "sensitive-value";
}

function redactStorageEntryValue(item: Data): unknown {
	const key = getStringField(item, "key") ?? getStringField(item, "name");
	if (!Object.hasOwn(item, "value") || shouldRevealStorageValue(key, item.value)) {
		return redactSensitiveValue(item);
	}
	const redacted = redactSensitiveValue({ ...item, value: undefined });
	if (!isRecord(redacted)) {
		throw new Error("Storage record redaction did not return a record");
	}
	return {
		...redacted,
		value: "[REDACTED]",
		valueRedacted: true,
		valueRedactionReason: storageRedactionReason(key),
	};
}

function redactStorageField(owner: Data, key: string, value: unknown): unknown {
	if (key === "data" && isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([storageKey, storageValue]) => [
				storageKey,
				shouldRevealStorageValue(storageKey, storageValue)
					? redactSensitiveValue(storageValue)
					: "[REDACTED]",
			]),
		);
	}
	if ((key === "entries" || key === "items") && Array.isArray(value)) {
		return value.map((item: unknown) =>
			isRecord(item) ? redactStorageEntryValue(item) : redactSensitiveValue(item),
		);
	}
	if (key === "value") {
		const itemKey = getStringField(owner, "key") ?? getStringField(owner, "name");
		return shouldRevealStorageValue(itemKey, value) ? redactSensitiveValue(value) : "[REDACTED]";
	}
	return redactSensitiveValue(value);
}

export function redactStorageData(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item: unknown) => redactStorageData(item));
	}
	if (!isRecord(value)) {
		return redactSensitiveValue(value);
	}
	const entries = Object.fromEntries(
		Object.entries(value).map(([key, entryValue]) => [
			key,
			redactStorageField(value, key, entryValue),
		]),
	);
	const key = getStringField(value, "key") ?? getStringField(value, "name");
	if (Object.hasOwn(value, "value") && !shouldRevealStorageValue(key, value.value)) {
		entries.valueRedacted = true;
		entries.valueRedactionReason = storageRedactionReason(key);
	}
	return entries;
}

function formatStorageEntry(item: unknown, index: number): string {
	if (!isRecord(item)) {
		return `${index + 1}. [REDACTED]`;
	}
	const rawKey =
		getStringField(item, "key") ?? getStringField(item, "name") ?? `(entry ${index + 1})`;
	const key = redactModelFacingText(rawKey);
	return Object.hasOwn(item, "value") ? `${key}: ${formatStorageValue(rawKey, item.value)}` : key;
}

function formatStorageMutationText(data: Data, type: string): string | undefined {
	const key = getStringField(data, "key");
	if (key !== undefined && Object.hasOwn(data, "value")) {
		return `${type} ${redactModelFacingText(key)}: ${formatStorageValue(key, data.value)}`;
	}
	if (key !== undefined && data.set === true) {
		return `${type} set: ${redactModelFacingText(key)}`;
	}
	return data.cleared === true || data.clear === true ? `${type} cleared.` : undefined;
}

export function formatStorageText(data: Data): string | undefined {
	const type = getStringField(data, "type") ?? getStringField(data, "storage") ?? "storage";
	if (isRecord(data.data)) {
		const text = Object.entries(data.data)
			.map(([key, value]) => `${redactModelFacingText(key)}: ${formatStorageValue(key, value)}`)
			.join("\n");
		return text.length > 0 ? text : `${type}: no entries.`;
	}
	const entries = getArrayField(data, "entries") ?? getArrayField(data, "items");
	if (entries) {
		return entries.length === 0
			? `${type}: no entries.`
			: entries.map(formatStorageEntry).join("\n");
	}
	return formatStorageMutationText(data, type);
}

function formatCookieRecordText(item: Data, fallbackName: string): string {
	const name = redactModelFacingText(getStringField(item, "name") ?? fallbackName);
	const domain = getStringField(item, "domain");
	const path = getStringField(item, "path");
	const flags = [
		item.httpOnly === true ? "httpOnly" : undefined,
		item.secure === true ? "secure" : undefined,
	]
		.filter(Boolean)
		.join(", ");
	const location = [domain, path].filter(Boolean).join("");
	return [
		name,
		location.length > 0 ? `(${redactModelFacingText(location)})` : undefined,
		flags.length > 0 ? `[${flags}]` : undefined,
	]
		.filter(Boolean)
		.join(" ");
}

export function formatCookiesText(data: Data): string | undefined {
	const cookies = getArrayField(data, "cookies");
	if (cookies) {
		return cookies.length === 0
			? "No cookies."
			: cookies
					.map((item, index) =>
						isRecord(item)
							? formatCookieRecordText(item, `(cookie ${index + 1})`)
							: `${index + 1}. [REDACTED]`,
					)
					.join("\n");
	}
	if (
		getStringField(data, "name") !== undefined ||
		getStringField(data, "domain") !== undefined ||
		getStringField(data, "path") !== undefined ||
		Object.hasOwn(data, "value")
	) {
		return formatCookieRecordText(data, "cookie");
	}
	if (data.set === true) {
		return "Cookie set.";
	}
	return data.cleared === true || data.clear === true ? "Cookies cleared." : undefined;
}
