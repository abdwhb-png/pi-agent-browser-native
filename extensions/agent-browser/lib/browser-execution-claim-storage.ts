import { randomInt, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, dirname, join } from "node:path";
import { processStartIdentitiesMatch, readProcessStartIdentity } from "./process-identity.js";
import { getErrorCode } from "./process-errors.js";
import {
	parseOwner,
	parseTicket,
	POLICY_LOCK_MAX_BYTES,
	type PolicyLockOwner,
	type PolicyLockClaim,
} from "./browser-execution-claim-codec.js";

export const POLICY_LOCK_WAIT_MS = 1_000;
export const LOCK_OWNER_FILE = "owner.json";
export const LOCK_TICKET_FILE = "ticket.json";
const STALE_CLAIM_MIN_AGE_MS = 30 * 60 * 1_000;
const POLICY_GC_BATCH_SIZE = 8;
let lastPolicyGcName: string | undefined;
export interface ClaimBudget {
	readonly signal?: AbortSignal;
	readonly deadline?: number;
}
function secureEntry(entry: Stats, directory: boolean): boolean {
	if (entry.isSymbolicLink() || (directory ? !entry.isDirectory() : !entry.isFile())) {
		return false;
	}
	if (!directory && entry.size > POLICY_LOCK_MAX_BYTES) {
		return false;
	}
	return secureEntryOwnership(entry, directory ? 0o077 : 0o177);
}
function secureEntryOwnership(entry: Stats, mask: number): boolean {
	if (process.platform === "win32") {
		return true;
	}
	const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
	return uid !== undefined && entry.uid === uid && (entry.mode & mask) === 0;
}
async function readClaimTicket(
	path: string,
	owner: PolicyLockOwner,
): Promise<PolicyLockClaim | undefined> {
	const ticketPath = join(path, LOCK_TICKET_FILE);
	try {
		if (!secureEntry(await lstat(ticketPath), false)) {
			return undefined;
		}
		const ticket = parseTicket(await readFile(ticketPath, "utf8"), owner.token);
		return ticket === undefined ? undefined : { owner, path, ticket };
	} catch (error) {
		return getErrorCode(error) === "ENOENT" ? { owner, path, ticket: null } : undefined;
	}
}
export async function readClaim(path: string): Promise<PolicyLockClaim | undefined> {
	try {
		const directory = await lstat(path);
		const ownerPath = join(path, LOCK_OWNER_FILE);
		const ownerEntry = await lstat(ownerPath);
		if (!secureEntry(directory, true) || !secureEntry(ownerEntry, false)) {
			return undefined;
		}
		const owner = parseOwner(await readFile(ownerPath, "utf8"));
		return owner ? await readClaimTicket(path, owner) : undefined;
	} catch {
		return undefined;
	}
}
async function claimDisappeared(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return false;
	} catch (error) {
		return getErrorCode(error) === "ENOENT";
	}
}
export async function readClaims(basePath: string): Promise<PolicyLockClaim[] | undefined> {
	const directory = dirname(basePath);
	const prefix = `${basename(basePath)}.claim-`;
	let names: string[];
	try {
		names = await readdir(directory);
	} catch {
		return undefined;
	}
	const claims: PolicyLockClaim[] = [];
	for (const name of names.filter((candidate) => candidate.startsWith(prefix))) {
		const path = join(directory, name);
		// Claim absence must be resolved before accepting the next contender.
		// oxlint-disable-next-line no-await-in-loop
		const claim = await readClaim(path);
		if (!claim) {
			// A disappearing immutable claim is not a corrupt contender.
			// oxlint-disable-next-line no-await-in-loop
			if (await claimDisappeared(path)) {
				continue;
			}
			return undefined;
		}
		if (name !== `${prefix}${claim.owner.token}`) {
			return undefined;
		}
		claims.push(claim);
	}
	return claims;
}
export async function ownerAlive(
	owner: PolicyLockOwner,
	budget?: ClaimBudget,
): Promise<boolean | undefined> {
	try {
		process.kill(owner.pid, 0);
	} catch (error) {
		const code = getErrorCode(error);
		if (code === "ESRCH") {
			return false;
		}
		if (code !== "EPERM") {
			return undefined;
		}
	}
	const current = await readProcessStartIdentity(owner.pid, process.platform, budget);
	return current === undefined
		? undefined
		: processStartIdentitiesMatch(owner.startIdentity, current);
}
export function waitForRetry(signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted === true) {
			resolve();
			return;
		}
		const timer = setTimeout(done, 10);
		function done(): void {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done, { once: true });
	});
}
async function moveOwnedClaim(
	path: string,
	movedPath: string,
	token: string,
	deadline: number,
): Promise<"moved" | "absent" | undefined> {
	while (true) {
		// Each retry must revalidate ownership before another move attempt.
		// oxlint-disable-next-line no-await-in-loop
		if ((await readClaim(path))?.owner.token !== token) {
			return undefined;
		}
		try {
			// Windows readers may temporarily hold the directory; moves stay serialized.
			// oxlint-disable-next-line no-await-in-loop
			await rename(path, movedPath);
			return "moved";
		} catch (error) {
			const code = getErrorCode(error);
			if (code === "ENOENT") {
				return "absent";
			}
			if (process.platform !== "win32" || code !== "EPERM" || Date.now() >= deadline) {
				return undefined;
			}
			// Retry only after a bounded pause, then revalidate the same immutable owner.
			// oxlint-disable-next-line no-await-in-loop
			await waitForRetry();
			if (Date.now() >= deadline) {
				return undefined;
			}
		}
	}
}
export async function removeClaimOwnedBy(
	path: string,
	token: string,
	deadline = 0,
): Promise<boolean> {
	const movedPath = join(dirname(path), `.pi-agent-browser-policy-remove-${token}-${randomUUID()}`);
	const movement = await moveOwnedClaim(path, movedPath, token, deadline);
	if (movement === "absent") {
		return true;
	}
	if (movement !== "moved") {
		return false;
	}
	const moved = await readClaim(movedPath);
	if (moved?.owner.token !== token) {
		try {
			await rename(movedPath, path);
		} catch {
			/* An unverified moved claim remains unavailable to contenders. */
		}
		return false;
	}
	await rm(movedPath, { force: true, recursive: true });
	return true;
}
function gcBatch(names: readonly string[]): string[] {
	// ponytail: list/sort all names; stream directories if enumeration becomes the bottleneck.
	const candidates = names
		.filter(
			(name) =>
				name.startsWith(".pi-agent-browser-policy-remove-") ||
				/^\.pi-agent-browser-policy-[a-f0-9]{64}\.lock-v4\.(?:candidate|claim)-/.test(name),
		)
		.sort();
	if (candidates.length === 0) {
		return [];
	}
	const previous = lastPolicyGcName;
	const start =
		previous === undefined
			? randomInt(candidates.length)
			: Math.max(
					0,
					candidates.findIndex((name) => name > previous),
				);
	const batch = Array.from(
		{ length: Math.min(POLICY_GC_BATCH_SIZE, candidates.length) },
		(_, offset) => candidates[(start + offset) % candidates.length],
	);
	lastPolicyGcName = batch.at(-1);
	return batch;
}
async function cleanDeadClaim(directory: string, name: string, budget: ClaimBudget): Promise<void> {
	const path = join(directory, name);
	const published = name.includes(".lock-v4.claim-");
	if (published) {
		const entry = await lstat(path).catch(() => undefined);
		if (!entry || entry.mtimeMs >= Date.now() - STALE_CLAIM_MIN_AGE_MS) {
			return;
		}
	}
	const claim = await readClaim(path);
	if (!claim || (published && !name.endsWith(`.claim-${claim.owner.token}`))) {
		return;
	}
	if ((await ownerAlive(claim.owner, budget)) === false) {
		await removeClaimOwnedBy(path, claim.owner.token).catch(() => false);
	}
}
export async function cleanDeadPolicyArtifacts(
	directory: string,
	budget: ClaimBudget,
): Promise<void> {
	let names: string[];
	try {
		names = await readdir(directory);
	} catch {
		return;
	}
	for (const name of gcBatch(names)) {
		if (budget.signal?.aborted === true || Date.now() >= (budget.deadline ?? Infinity)) {
			return;
		}
		// Bounded GC respects the acquisition budget between native liveness probes.
		// oxlint-disable-next-line no-await-in-loop
		await cleanDeadClaim(directory, name, budget);
	}
}
