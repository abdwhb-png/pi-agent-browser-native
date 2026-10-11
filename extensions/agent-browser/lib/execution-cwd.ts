import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, SourceInfo } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./parsing.js";

interface DirectoryOwnerSurface {
	readonly name: string;
	readonly sourceInfo: SourceInfo;
}

interface ExecutionDirectoryApi {
	readonly events: { readonly emit: ExtensionAPI["events"]["emit"] };
	readonly getAllTools: () => readonly DirectoryOwnerSurface[];
	readonly getCommands: () => readonly DirectoryOwnerSurface[];
}

function isDirectoryOwner(source: SourceInfo): boolean {
	if (
		/^(?:npm:pi-change-working-dir|git:github\.com\/fitchmultz\/pi-change-working-dir(?:\.git)?)(?:@.+)?$/.test(
			source.source,
		)
	) {
		return true;
	}
	const directories = [source.baseDir, isAbsolute(source.path) ? dirname(source.path) : undefined];
	return directories.some((directory) => {
		if (directory === undefined || directory.length === 0 || !isAbsolute(directory)) {
			return false;
		}
		try {
			const manifest: unknown = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
			return isRecord(manifest) && manifest.name === "pi-change-working-dir";
		} catch {
			return false;
		}
	});
}

function validateDirectoryReply(result: unknown): string {
	const invalid =
		"pi-change-working-dir returned an invalid execution directory. Update the extension and restart Pi.";
	if (!isRecord(result) || Array.isArray(result)) {
		throw new Error(invalid);
	}
	if (result.error !== undefined) {
		throw new Error(
			typeof result.error === "string" && result.error.length > 0 ? result.error : invalid,
		);
	}
	if (typeof result.cwd !== "string" || !isAbsolute(result.cwd) || result.cwd.includes("\0")) {
		throw new Error(invalid);
	}
	return result.cwd;
}

/** The synchronous owner reply is captured before any browser policy, queue, or child await. */
export function resolveExecutionCwd(
	pi: ExecutionDirectoryApi,
	ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
): string {
	const request: { sessionManager: ExtensionContext["sessionManager"]; result?: unknown } = {
		sessionManager: ctx.sessionManager,
	};
	pi.events.emit("pi-change-working-dir:resolve-execution-cwd", request);
	const result = request.result;
	if (result !== undefined) {
		return validateDirectoryReply(result);
	}
	if (
		pi
			.getAllTools()
			.some((tool) => tool.name === "change_dir" && isDirectoryOwner(tool.sourceInfo)) ||
		pi
			.getCommands()
			.some(
				(command) => /^cwd(?::\d+)?$/.test(command.name) && isDirectoryOwner(command.sourceInfo),
			)
	) {
		throw new Error(
			"Update pi-change-working-dir and restart Pi to use agent_browser with the selected working directory.",
		);
	}
	return ctx.cwd;
}

export function getBrowserCwdError(cwd: string): string | undefined {
	try {
		if (statSync(cwd).isDirectory()) {
			return undefined;
		}
	} catch (error) {
		if (!isRecord(error) || (error.code !== "ENOENT" && error.code !== "ENOTDIR")) {
			throw error;
		}
	}
	return `Browser launch directory is unavailable: ${cwd}. Restore that directory, or explicitly use sessionMode: "fresh" without --session, or --config from the selected execution directory. The existing browser was left untouched.`;
}
