import { lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

import { foldAgentBrowserFilesystemIdentity } from "../../argv-grammar.js";
import { parseWaitCommandTokens } from "../../argv-descriptor.js";
import {
	getRecordCommandOperandIndices,
	getRecordCommandOperands,
} from "../../command-taxonomy.js";

const SCREENSHOT_IMAGE_EXTENSIONS = [".jpeg", ".jpg", ".png", ".webp"];

function isSingleScreenshotPathToken(token: string): boolean {
	const explicitlyRelative = token.startsWith("./") || token.startsWith("../");
	if (
		token.startsWith("#") ||
		token.startsWith("@") ||
		(token.startsWith(".") && !explicitlyRelative && !token.includes("/"))
	) {
		return false;
	}
	return (
		explicitlyRelative ||
		token.includes("/") ||
		SCREENSHOT_IMAGE_EXTENSIONS.some((extension) => token.endsWith(extension))
	);
}

export function getScreenshotPositionalIndices(commandTokens: readonly string[]): number[] {
	if (commandTokens[0] !== "screenshot") {
		return [];
	}
	const positionalIndices: number[] = [];
	for (let index = 1; index < commandTokens.length; index += 1) {
		const token = commandTokens[index];
		if (token === "--full" || token === "-f" || token === "--if-changed") {
			continue;
		}
		if (token === "--threshold") {
			index += 1;
			continue;
		}
		positionalIndices.push(index);
	}

	return positionalIndices;
}

export function getScreenshotPathTokenIndex(commandTokens: readonly string[]): number | undefined {
	const positionalIndices = getScreenshotPositionalIndices(commandTokens);
	if (positionalIndices.length === 0) {
		return undefined;
	}
	const candidateIndex =
		positionalIndices.length >= 2 ? positionalIndices[1] : positionalIndices[0];
	const candidate = commandTokens[candidateIndex];
	if (positionalIndices.length >= 2 || isSingleScreenshotPathToken(candidate)) {
		return candidateIndex;
	}
	return undefined;
}

const DIFF_SCREENSHOT_VALUE_FLAGS = new Set([
	"-b",
	"--baseline",
	"-o",
	"--output",
	"-s",
	"--selector",
	"-t",
	"--threshold",
]);

export function getDiffFilePathIndices(commandTokens: readonly string[]): {
	baseline?: number;
	output?: number;
} {
	if (commandTokens[0] !== "diff" || !["snapshot", "screenshot"].includes(commandTokens[1])) {
		return {};
	}
	const valueFlags =
		commandTokens[1] === "screenshot"
			? DIFF_SCREENSHOT_VALUE_FLAGS
			: new Set(["-b", "--baseline", "-s", "--selector", "-d", "--depth"]);
	const paths: { baseline?: number; output?: number } = {};
	for (let index = 2; index < commandTokens.length; index += 1) {
		const token = commandTokens[index];
		if (!valueFlags.has(token)) {
			continue;
		}
		const value = commandTokens.at(index + 1);
		if (value === undefined) {
			return {};
		}
		if (["-o", "--output"].includes(token)) {
			paths.output = index + 1;
		}
		if (["-b", "--baseline"].includes(token)) {
			paths.baseline = index + 1;
		}
		index += 1;
	}
	return paths;
}

function canonicalFileIdentity(path: string, platform: NodeJS.Platform): string {
	try {
		const stats = statSync(path, { bigint: true });
		if (stats.ino > 0n) {
			return `inode:${stats.dev}:${stats.ino}`;
		}
	} catch {
		// The destination does not exist yet; canonical ancestry still catches aliases.
	}
	return foldAgentBrowserFilesystemIdentity(path, platform);
}

function readSymlinkTarget(path: string): string | undefined {
	try {
		return lstatSync(path).isSymbolicLink()
			? resolve(dirname(path), readlinkSync(path))
			: undefined;
	} catch {
		// Missing ancestry is resolved by walking to the next existing parent.
		return undefined;
	}
}

function canonicalizeArtifactPath(
	absolutePath: string,
	platform: NodeJS.Platform,
	seenSymlinks: ReadonlySet<string>,
): string {
	let cursor = absolutePath;
	const suffix: string[] = [];
	while (true) {
		try {
			const canonicalPath = join(realpathSync.native(cursor), ...suffix);
			return canonicalFileIdentity(canonicalPath, platform);
		} catch {
			// Resolve missing destinations through their existing ancestry below.
		}
		const symlinkTarget = readSymlinkTarget(cursor);
		if (symlinkTarget !== undefined && symlinkTarget !== "") {
			if (seenSymlinks.has(cursor)) {
				throw new Error(`Artifact destination contains a symlink loop: ${absolutePath}`);
			}
			if (seenSymlinks.size >= 32) {
				throw new Error(`Artifact destination has too many symlink hops: ${absolutePath}`);
			}
			return canonicalizeArtifactPath(
				join(symlinkTarget, ...suffix),
				platform,
				new Set([...seenSymlinks, cursor]),
			);
		}
		const parent = dirname(cursor);
		if (parent === cursor) {
			return foldAgentBrowserFilesystemIdentity(absolutePath, platform);
		}
		suffix.unshift(basename(cursor));
		cursor = parent;
	}
}

export function canonicalizeExplicitArtifactDestination(
	cwd: string,
	destination: string,
	platform: NodeJS.Platform = process.platform,
): string {
	return canonicalizeArtifactPath(resolve(cwd, destination), platform, new Set());
}

export function getRecordContactSheetDestination(
	commandTokens: readonly string[],
): string | undefined {
	const path = getRecordCommandOperands(commandTokens).path;
	if (
		path === undefined ||
		path === "" ||
		!commandTokens.some(
			(token) => token === "--contact-sheet" || token === "--contact-sheet-threshold",
		)
	) {
		return undefined;
	}
	const extension = extname(path);
	return extension !== "" ? `${path.slice(0, -extension.length)}.contact-sheet.png` : undefined;
}

function getCompoundArtifactDestinationIndex(commandTokens: readonly string[]): number | undefined {
	const [command, subcommand] = commandTokens;
	if (command === "state" && subcommand === "save") {
		return 2;
	}
	if (command === "diff" && subcommand === "screenshot") {
		return getDiffFilePathIndices(commandTokens).output;
	}
	if (command === "network" && subcommand === "har" && commandTokens[2] === "stop") {
		return 3;
	}
	if (["trace", "profiler"].includes(command) && subcommand === "stop") {
		return 2;
	}
	return undefined;
}

export function getExplicitArtifactDestinationIndex(
	commandTokens: readonly string[],
): number | undefined {
	const command = commandTokens[0];
	if (command === "screenshot") {
		return getScreenshotPathTokenIndex(commandTokens);
	}
	if (command === "download") {
		return 2;
	}
	if (command === "pdf") {
		return 1;
	}
	if (command === "wait") {
		return parseWaitCommandTokens(commandTokens).downloadPathIndex;
	}
	if (command === "record") {
		return getRecordCommandOperandIndices(commandTokens)[0];
	}
	return getCompoundArtifactDestinationIndex(commandTokens);
}

export function getExplicitArtifactDestination(
	commandTokens: readonly string[],
): string | undefined {
	const index = getExplicitArtifactDestinationIndex(commandTokens);
	return index === undefined ? undefined : commandTokens[index];
}
