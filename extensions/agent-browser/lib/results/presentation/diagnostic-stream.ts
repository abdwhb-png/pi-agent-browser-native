import type { CommandInfo } from "../../argv-descriptor.js";
import { isRecord } from "../../parsing.js";
import type { AgentBrowserNextAction } from "../action-contracts.js";
import { withOptionalSessionArgs } from "../next-actions.js";

type Data = Readonly<Record<string, unknown>>;

function streamPortLines(data: Data): string[] {
	return typeof data.port === "number"
		? [`Port: ${data.port}`, `WebSocket URL: ${getStreamWebSocketUrl(data.port)}`]
		: [];
}

export function getStreamSummary(data: Data): string | undefined {
	if (data.alreadyEnabled === true) {
		return [
			"Stream already enabled (idempotent no-op).",
			...streamPortLines(data),
			"Run stream status for current connection details or stream disable when streaming is no longer needed.",
		].join("\n");
	}
	if (typeof data.enabled !== "boolean" || typeof data.connected !== "boolean") {
		return undefined;
	}
	const lines = [
		`Enabled: ${data.enabled}`,
		`Connected: ${data.connected}`,
		`Screencasting: ${data.screencasting === true}`,
		...streamPortLines(data),
	];
	if (typeof data.port === "number") {
		lines.push("Frame format: JSON messages with base64 JPEG frame data");
	}
	return lines.join("\n");
}

function getStreamWebSocketUrl(port: number): string {
	return `ws://127.0.0.1:${port}`;
}

export function enrichStreamStatusData(command: CommandInfo, data: unknown): unknown {
	if (
		command.command !== "stream" ||
		command.subcommand !== "status" ||
		!isRecord(data) ||
		typeof data.port !== "number"
	) {
		return data;
	}
	return {
		...data,
		frameFormat: "JSON messages with base64 JPEG frame data",
		wsUrl: getStreamWebSocketUrl(data.port),
	};
}

export function buildStreamNextActions(
	command: CommandInfo,
	data: unknown,
	sessionName: string | undefined,
): AgentBrowserNextAction[] | undefined {
	if (
		command.command !== "stream" ||
		command.subcommand !== "enable" ||
		!isRecord(data) ||
		data.alreadyEnabled !== true
	) {
		return undefined;
	}
	return [
		{
			id: "check-stream-status-after-noop",
			params: { args: withOptionalSessionArgs(sessionName, ["stream", "status"]) },
			reason: "Read current stream port and connection details after the idempotent enable no-op.",
			safety: "Read-only stream diagnostic.",
			tool: "agent_browser",
		},
		{
			id: "disable-existing-stream-when-done",
			params: { args: withOptionalSessionArgs(sessionName, ["stream", "disable"]) },
			reason: "Disable the existing stream when it is no longer needed.",
			safety: "Only run when no other workflow is relying on the current stream.",
			tool: "agent_browser",
		},
	];
}
