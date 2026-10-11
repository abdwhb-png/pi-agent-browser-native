/**
 * Purpose: Lock agent-browser command capability predicates so wrapper behaviors do not drift through broad set reuse.
 * Responsibilities: Assert alias normalization and independent capability dimensions for ref guards, mutation hints, summaries, and session-close behavior.
 * Scope: Unit tests for command-taxonomy.ts only.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
	isCloseCommand,
	isKnownCommandToken,
	isOpenNavigationCommand,
	isPageChangeSummaryCommand,
	isPageMutationCommand,
	isRecordPageTransitionCommand,
	isRefGuardedCommand,
	isRefInvalidatingBatchCommand,
	isUnverifiedPageTransitionCommand,
} from "../extensions/agent-browser/lib/command-taxonomy.js";

test("command taxonomy resolves aliases through capability predicates", () => {
	assert.equal(isCloseCommand("quit"), true);
	assert.equal(isCloseCommand("exit"), true);
	assert.equal(isOpenNavigationCommand("goto"), true);
	assert.equal(isOpenNavigationCommand("navigate"), true);
	assert.equal(isRefInvalidatingBatchCommand(["key"]), true);
	assert.equal(isRefGuardedCommand("scrollinto"), true);
	assert.equal(isCloseCommand("unknown-command"), false);
});

test("command taxonomy keeps independent capability dimensions explicit", () => {
	assert.equal(isRefGuardedCommand("fill"), true);
	assert.equal(isPageMutationCommand("fill"), true);
	assert.equal(isPageChangeSummaryCommand("fill"), true);
	assert.equal(isRefInvalidatingBatchCommand(["fill"]), false);

	assert.equal(isRefGuardedCommand("download"), true);
	assert.equal(isPageMutationCommand("download"), false);
	assert.equal(isPageChangeSummaryCommand("download"), true);
	assert.equal(isRefInvalidatingBatchCommand(["download"]), false);

	assert.equal(isRefGuardedCommand("scrollintoview"), true);
	assert.equal(isPageMutationCommand("scrollintoview"), true);
	assert.equal(isPageChangeSummaryCommand("scrollintoview"), true);
	assert.equal(isRefInvalidatingBatchCommand(["scrollintoview"]), true);
});

test("command taxonomy guards exactly the upstream ref-resolving selector commands", () => {
	// Complete guarded set from COMMAND_CAPABILITIES, aliases such as `scrollinto` included. The
	// unguarded list covers every other command token the wrapper knows, so dropping `guardsPageRefs`
	// from a real command or adding it to an unrelated one (for example `pdf`) both fail here.
	const guardedCommands = [
		"check",
		"click",
		"dblclick",
		"diff",
		"download",
		"drag",
		"fill",
		"focus",
		"frame",
		"get",
		"highlight",
		"hover",
		"is",
		"screenshot",
		"scroll",
		"scrollinto",
		"scrollintoview",
		"select",
		"tap",
		"type",
		"uncheck",
		"upload",
	];
	const unguardedCommands = [
		"a11y",
		"auth",
		"back",
		"batch",
		"chat",
		"clipboard",
		"close",
		"confirm",
		"connect",
		"console",
		"cookies",
		"dashboard",
		"deny",
		"device",
		"dialog",
		"doctor",
		"errors",
		"eval",
		"exit",
		"find",
		"forward",
		"goto",
		"inspect",
		"install",
		"key",
		"keyboard",
		"keydown",
		"keyup",
		"mcp",
		"mouse",
		"navigate",
		"network",
		"open",
		"pdf",
		"plugin",
		"plugins",
		"press",
		"profiler",
		"profiles",
		"pushstate",
		"quit",
		"react",
		"read",
		"record",
		"reload",
		"removeinitscript",
		"session",
		"set",
		"skills",
		"snapshot",
		"state",
		"storage",
		"stream",
		"swipe",
		"tab",
		"trace",
		"upgrade",
		"vitals",
		"wait",
		"web-vitals",
		"webmcp",
		"window",
	];
	const knownCommands = [...guardedCommands, ...unguardedCommands];
	assert.equal(
		new Set(knownCommands).size,
		knownCommands.length,
		"guarded and unguarded lists must stay disjoint",
	);
	for (const command of knownCommands) {
		// Exhaustive fixture variant (knownCommands): this selected path must satisfy its own contract.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(isKnownCommandToken(command), true, `${command} is not a known command token`);
	}
	// diff guarding is deliberately command-level: diff screenshot resolves refs while diff snapshot's
	// selector is CSS-only, but the wrapper's stale-ref guidance is a clearer failure than upstream's
	// invalid-selector error and subcommand precision buys nothing observable.
	assert.deepEqual(
		knownCommands.filter(isRefGuardedCommand),
		guardedCommands,
		"guarded set must match the complete ref-resolving list",
	);
	// Upstream passes these selectors/operands through literally and never resolves @e refs for them,
	// so guarding would falsely reject literal tokens such as `wait --text @e1` or `find text @e1 click`.
	for (const command of ["a11y", "find", "wait"]) {
		// Exhaustive fixture variant (["a11y", "find", "wait"]): this selected path must satisfy its own contract.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(isRefGuardedCommand(command), false, command);
	}
});

test("WebMCP mutation commands invalidate refs while list remains read-only", () => {
	assert.equal(isPageMutationCommand("webmcp", "list"), false);
	assert.equal(isPageMutationCommand("webmcp", "invoke"), true);
	assert.equal(isPageChangeSummaryCommand("webmcp", "result"), true);
	assert.equal(isUnverifiedPageTransitionCommand("webmcp", "cancel"), true);
	assert.equal(isRefInvalidatingBatchCommand(["webmcp", "list"]), false);
	assert.equal(isRefInvalidatingBatchCommand(["webmcp", "invoke", "set_message"]), true);
});

test("recording FPS without a URL preserves restart refs", () => {
	// `out.webm` is the bare path-operand form without Chromium-style flags.
	for (const operands of [
		["take.webm", "--fps", "30"],
		["--fps", "+24", "take.webm"],
		["--fps", "12", "take.webm", "--fps", "24"],
		["out.webm"],
	]) {
		// Every FPS position and start/restart variant must preserve the recording operand contract.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(isRecordPageTransitionCommand(["record", "restart", ...operands]), false);
		// Every FPS position and start/restart variant must preserve the recording operand contract.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(isRefInvalidatingBatchCommand(["record", "restart", ...operands]), false);
		// Every FPS position and start/restart variant must preserve the recording operand contract.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(
			isRecordPageTransitionCommand(["record", "start", ...operands]),
			true,
			"older native starts replace the page even on failure",
		);
		// Every FPS position and start/restart variant must preserve the recording operand contract.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(
			isRefInvalidatingBatchCommand(["record", "start", ...operands]),
			true,
			"older native starts still need conservative ref protection",
		);
		// Every FPS position and start/restart variant must preserve the recording operand contract.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(
			isRecordPageTransitionCommand(["record", "restart", ...operands, "https://example.com"]),
			true,
		);
		// Every FPS position and start/restart variant must preserve the recording operand contract.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(
			isRefInvalidatingBatchCommand(["record", "restart", ...operands, "https://example.com"]),
			true,
			"a navigating restart replaces the page",
		);
	}
	assert.equal(isRecordPageTransitionCommand(["record", "stop"]), false);
	assert.equal(isRefInvalidatingBatchCommand(["record", "stop"]), false);
});
