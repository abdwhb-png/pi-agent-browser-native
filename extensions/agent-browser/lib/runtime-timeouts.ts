import { getAgentBrowserProcessEnvironment } from "./process-environment.js";

const DEFAULT_IMPLICIT_SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
// Native close includes a five-second Chrome exit grace after protocol shutdown.
// Use the normal CLI watchdog budget rather than interrupting that grace.
const DEFAULT_IMPLICIT_SESSION_CLOSE_TIMEOUT_MS = 35_000;

function parseTimeoutMs(rawValue: string | undefined, minimumValue: number): number | undefined {
	if (rawValue === undefined) {
		return;
	}
	const normalizedValue = rawValue.trim();
	if (!/^\d+$/.test(normalizedValue)) {
		return;
	}
	const parsedValue = Number(normalizedValue);
	if (!Number.isSafeInteger(parsedValue) || parsedValue < minimumValue) {
		return;
	}
	return parsedValue;
}

export function getImplicitSessionIdleTimeoutMs(
	env: Readonly<NodeJS.ProcessEnv> = getAgentBrowserProcessEnvironment(),
): number {
	return (
		parseTimeoutMs(env.PI_AGENT_BROWSER_IMPLICIT_SESSION_IDLE_TIMEOUT_MS, 0) ??
		parseTimeoutMs(env.AGENT_BROWSER_IDLE_TIMEOUT_MS, 0) ??
		DEFAULT_IMPLICIT_SESSION_IDLE_TIMEOUT_MS
	);
}

export function getImplicitSessionCloseTimeoutMs(
	env: Readonly<NodeJS.ProcessEnv> = getAgentBrowserProcessEnvironment(),
): number {
	return (
		parseTimeoutMs(env.PI_AGENT_BROWSER_IMPLICIT_SESSION_CLOSE_TIMEOUT_MS, 0) ??
		DEFAULT_IMPLICIT_SESSION_CLOSE_TIMEOUT_MS
	);
}
