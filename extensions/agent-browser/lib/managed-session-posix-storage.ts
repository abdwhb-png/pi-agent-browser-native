import { lstatSync, type Stats } from "node:fs";
import { join, parse } from "node:path";
import { getCurrentProcessUid } from "./process-identity.js";

function androidSystemAncestor(path: string, entry: Stats, platform: NodeJS.Platform): boolean {
	return (
		platform === "android" &&
		(path === "/data" || path === "/data/data") &&
		entry.uid === 1000 &&
		(entry.mode & 0o002) === 0
	);
}
function androidAppDirectory(entry: Stats, uid: number, platform: NodeJS.Platform): boolean {
	return (
		platform === "android" && entry.uid === uid && entry.gid === uid && (entry.mode & 0o002) === 0
	);
}
function ancestorModeTrusted(
	entry: Stats,
	android: { readonly system: boolean; readonly app: boolean },
): boolean {
	const rootSticky = entry.uid === 0 && (entry.mode & 0o1000) !== 0;
	return (entry.mode & 0o022) === 0 || rootSticky || android.system || android.app;
}
function ancestorTrusted(
	path: string,
	entry: Stats,
	uid: number,
	platform: NodeJS.Platform,
): boolean {
	if (entry.isSymbolicLink() || !entry.isDirectory()) {
		return false;
	}
	const system = androidSystemAncestor(path, entry, platform);
	if (!system && entry.uid !== 0 && entry.uid !== uid) {
		return false;
	}
	return ancestorModeTrusted(entry, { system, app: androidAppDirectory(entry, uid, platform) });
}
export function isTrustedPosixDirectory(
	path: string,
	requireCurrentOwner: boolean,
	platform: NodeJS.Platform = process.platform,
): boolean {
	const uid = getCurrentProcessUid();
	if (uid === undefined) {
		return false;
	}
	const root = parse(path).root;
	let cursor = root;
	for (const component of path.slice(root.length).split("/").filter(Boolean)) {
		cursor = join(cursor, component);
		try {
			if (!ancestorTrusted(cursor, lstatSync(cursor), uid, platform)) {
				return false;
			}
		} catch {
			return false;
		}
	}
	try {
		return !requireCurrentOwner || lstatSync(path).uid === uid;
	} catch {
		return false;
	}
}
export function isTrustedCurrentFile(
	entry: Stats,
	platform: NodeJS.Platform,
	forbiddenMode: number,
): boolean {
	if (platform === "win32") {
		return true;
	}
	const uid = getCurrentProcessUid();
	return uid !== undefined && entry.uid === uid && (entry.mode & forbiddenMode) === 0;
}
