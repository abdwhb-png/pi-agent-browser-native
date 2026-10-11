import { lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";
import { canonicalizeAgentBrowserNamespace } from "./argv-grammar.js";
import { isTrustedPosixDirectory } from "./managed-session-posix-storage.js";
import { getCurrentProcessUid } from "./process-identity.js";
import { getErrorCode } from "./process-errors.js";
export {
	isManagedSessionRestoreKey,
	createManagedSessionRestoreKey,
	getManagedSessionRestoreScope,
	hasManagedSessionRestoreProjectIdentity,
	resolveManagedSessionRestoreCheckoutRoot,
} from "./managed-session-project-identity.js";

function validHomeCandidate(candidate: string, platform: NodeJS.Platform): boolean {
	return (
		candidate.length > 0 &&
		candidate.trim() === candidate &&
		(platform === "win32" ? win32.isAbsolute(candidate) : isAbsolute(candidate))
	);
}
export function resolveManagedSessionRestoreHome(
	parentEnv: NodeJS.ProcessEnv,
	platform: NodeJS.Platform = process.platform,
): string | undefined {
	const configuredHome = platform === "win32" ? parentEnv.USERPROFILE : parentEnv.HOME;
	const candidate = configuredHome ?? homedir();
	if (!validHomeCandidate(candidate, platform)) {
		return undefined;
	}
	if (platform === "win32") {
		return candidate;
	}
	try {
		const canonical = realpathSync(candidate);
		return isTrustedPosixDirectory(canonical, true, platform) ? canonical : undefined;
	} catch {
		return undefined;
	}
}
export function ensureOwnerOnlyDirectory(
	path: string,
	platform: NodeJS.Platform = process.platform,
): boolean {
	try {
		try {
			mkdirSync(path, { mode: 0o700 });
		} catch (error) {
			if (getErrorCode(error) !== "EEXIST") {
				return false;
			}
		}
		const entry = lstatSync(path);
		if (entry.isSymbolicLink() || !entry.isDirectory()) {
			return false;
		}
		if (platform === "win32") {
			return true;
		}
		const uid = getCurrentProcessUid();
		return uid !== undefined && entry.uid === uid && (entry.mode & 0o077) === 0;
	} catch {
		return false;
	}
}
export function directoryContainsSymlink(path: string): boolean {
	try {
		return readdirSync(path, { withFileTypes: true }).some((entry) => entry.isSymbolicLink());
	} catch {
		return true;
	}
}
function hasValidEncryptionKey(parentEnv: NodeJS.ProcessEnv): boolean {
	const value = parentEnv.AGENT_BROWSER_ENCRYPTION_KEY;
	return typeof value === "string" && /^[a-f\d]{64}$/i.test(value);
}
export function getManagedRestoreSessionsDirectory(home: string, namespace?: string): string {
	const canonicalNamespace = canonicalizeAgentBrowserNamespace(namespace);
	return canonicalNamespace !== undefined && canonicalNamespace.length > 0
		? join(home, ".agent-browser", "namespaces", canonicalNamespace, "state", "sessions")
		: join(home, ".agent-browser", "sessions");
}
function ensureRestoreStateDirectory(
	root: string,
	namespace: string | undefined,
	platform: NodeJS.Platform,
): string | undefined {
	const canonicalNamespace = canonicalizeAgentBrowserNamespace(namespace);
	const components =
		canonicalNamespace !== undefined && canonicalNamespace.length > 0
			? ["namespaces", canonicalNamespace, "state", "sessions"]
			: ["sessions"];
	let path = root;
	for (const component of components) {
		path = join(path, component);
		if (!ensureOwnerOnlyDirectory(path, platform)) {
			return undefined;
		}
	}
	return path;
}
/** Require the native 256-bit key format and secure each automatic restore storage directory. */
export function ensureManagedSessionRestoreStorageIsSecure(
	parentEnv: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
	namespace?: string,
): boolean {
	if (parentEnv.AGENT_BROWSER_ENCRYPTION_KEY !== undefined && !hasValidEncryptionKey(parentEnv)) {
		return false;
	}
	if (platform === "win32") {
		return hasValidEncryptionKey(parentEnv);
	}
	const home = resolveManagedSessionRestoreHome(parentEnv, platform);
	if (home === undefined) {
		return false;
	}
	const root = join(home, ".agent-browser");
	if (!ensureOwnerOnlyDirectory(root, platform)) {
		return false;
	}
	const path = ensureRestoreStateDirectory(root, namespace, platform);
	if (path === undefined || directoryContainsSymlink(path)) {
		return false;
	}
	return secureRestoreTemporaryDirectory(path, platform);
}
function secureRestoreTemporaryDirectory(path: string, platform: NodeJS.Platform): boolean {
	const temporaryDirectory = join(path, ".tmp");
	return (
		ensureOwnerOnlyDirectory(temporaryDirectory, platform) &&
		!directoryContainsSymlink(temporaryDirectory)
	);
}
export function getManagedSessionRestoreProtectedStorageEnv(
	restoreEnabled: boolean,
	parentEnv: NodeJS.ProcessEnv,
	platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
	if (!restoreEnabled) {
		return {};
	}
	const home = resolveManagedSessionRestoreHome(parentEnv, platform);
	if (home === undefined) {
		return {};
	}
	return {
		AGENT_BROWSER_ENCRYPTION_KEY: parentEnv.AGENT_BROWSER_ENCRYPTION_KEY,
		...(platform === "win32" ? { USERPROFILE: home } : { HOME: home }),
	};
}
