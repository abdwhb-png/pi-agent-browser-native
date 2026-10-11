import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	SessionManager,
	type ExtensionAPI,
	type ExtensionContext,
	type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import { readRecord } from "./helpers/assertions.js";
import { resolveExecutionCwd } from "../extensions/agent-browser/lib/execution-cwd.js";

const ctx: Pick<ExtensionContext, "cwd" | "sessionManager"> = {
	cwd: process.cwd(),
	sessionManager: SessionManager.inMemory(),
};
const api = (
	emit: ExtensionAPI["events"]["emit"] = () => {
		/* No directory owner responds by default. */
	},
	sources: {
		readonly tools?: readonly SourceInfo[];
		readonly commands?: readonly SourceInfo[];
	} = {},
) => ({
	events: {
		emit,
		on: () => () => {
			/* Fixture has no listeners to remove. */
		},
	},
	getAllTools: () =>
		(sources.tools ?? []).map((sourceInfo) => ({
			id: "change_dir",
			name: "change_dir",
			description: "Fixture",
			parameters: {},
			promptGuidelines: [],
			exposure: "direct" as const,
			sourceInfo,
		})),
	getCommands: () =>
		(sources.commands ?? []).map((sourceInfo) => ({
			name: "cwd:1",
			source: "extension" as const,
			sourceInfo,
		})),
});

test("execution cwd uses a synchronous owner reply and never silently replaces owner errors", () => {
	assert.equal(resolveExecutionCwd(api(), ctx), ctx.cwd);
	const b = join(ctx.cwd, "b");
	assert.equal(
		resolveExecutionCwd(
			api((channel, request) => {
				assert.equal(channel, "pi-change-working-dir:resolve-execution-cwd");
				assert.equal(readRecord(request).sessionManager, ctx.sessionManager);
				Object.assign(readRecord(request), { result: { cwd: b } });
			}),
			ctx,
		),
		b,
	);
	for (const result of [
		null,
		[],
		"not a reply",
		{},
		{ cwd: "" },
		{ cwd: "relative" },
		{ cwd: 123 },
		{ cwd: b + "\0" },
		{ cwd: b, error: false },
		{ cwd: b, error: "" },
		{ cwd: b, error: null },
		Object.assign([], { cwd: b }),
	]) {
		// Every fixed malformed reply must fail closed; none are filtered from this matrix.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.throws(
			() =>
				resolveExecutionCwd(
					api((_channel, request) => {
						Object.assign(readRecord(request), { result });
					}),
					ctx,
				),
			/invalid execution directory/,
		);
	}
	assert.throws(
		() =>
			resolveExecutionCwd(
				api((_channel, request) => {
					Object.assign(readRecord(request), {
						result: { cwd: b, error: "Selected directory disappeared" },
					});
				}),
				ctx,
			),
		/Selected directory disappeared/,
	);
});

test("legacy owner detection checks package provenance for excluded tools and direct local commands", () => {
	const root = mkdtempSync(join(tmpdir(), "browser-cwd-provenance-"));
	const owner = join(root, "owner"),
		unrelated = join(root, "pi-change-working-dir");
	mkdirSync(owner);
	mkdirSync(unrelated);
	writeFileSync(join(owner, "package.json"), JSON.stringify({ name: "pi-change-working-dir" }));
	writeFileSync(join(unrelated, "package.json"), JSON.stringify({ name: "unrelated" }));
	const source = (directory: string, packaged: boolean): SourceInfo => ({
		path: join(directory, packaged ? "dist/index.js" : "index.ts"),
		source: directory,
		scope: "user",
		origin: packaged ? "package" : "top-level",
		...(packaged ? { baseDir: directory } : {}),
	});
	try {
		assert.throws(
			() => resolveExecutionCwd(api(undefined, { tools: [source(owner, true)] }), ctx),
			/Update pi-change-working-dir and restart Pi/,
		);
		assert.throws(
			() => resolveExecutionCwd(api(undefined, { commands: [source(owner, false)] }), ctx),
			/Update pi-change-working-dir and restart Pi/,
		);
		assert.equal(
			resolveExecutionCwd(
				api(undefined, { tools: [source(unrelated, true)], commands: [source(unrelated, false)] }),
				ctx,
			),
			ctx.cwd,
		);
		const responding = api(
			(_channel, request) => {
				Object.assign(readRecord(request), { result: { cwd: owner } });
			},
			{ tools: [source(owner, true)] },
		);
		assert.equal(
			resolveExecutionCwd(responding, ctx),
			owner,
			"active protocol takes precedence over legacy detection",
		);
		const otherSurfaces = api(undefined, {
			tools: [source(owner, true)],
			commands: [source(owner, false)],
		});
		const tools = otherSurfaces.getAllTools(),
			commands = otherSurfaces.getCommands();
		otherSurfaces.getAllTools = () =>
			tools.map((tool) => Object.assign({}, tool, { id: "cwd_helper", name: "cwd_helper" }));
		otherSurfaces.getCommands = () =>
			commands.map((command) => Object.assign({}, command, { name: "cwd-status" }));
		assert.equal(
			resolveExecutionCwd(otherSurfaces, ctx),
			ctx.cwd,
			"unrelated surfaces from the same package do not identify an active directory owner",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("exact package source provenance identifies legacy owners when manifests are unavailable", () => {
	const missingSource = (source: string): SourceInfo => ({
		path: "<unavailable>",
		source,
		scope: "user",
		origin: "package",
	});
	for (const name of [
		"npm:pi-change-working-dir",
		"npm:pi-change-working-dir@0.4.3",
		"git:github.com/fitchmultz/pi-change-working-dir",
		"git:github.com/fitchmultz/pi-change-working-dir.git@main",
	]) {
		// Every declared package spelling must reject its missing source.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.throws(
			() => resolveExecutionCwd(api(undefined, { tools: [missingSource(name)] }), ctx),
			/Update pi-change-working-dir/,
		);
		// Every declared package spelling must also reject its missing command source.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.throws(
			() => resolveExecutionCwd(api(undefined, { commands: [missingSource(name)] }), ctx),
			/Update pi-change-working-dir/,
		);
	}
	for (const name of [
		"npm:pi-change-working-dir-extra",
		"git:github.com/other/pi-change-working-dir",
		"npm:@other/pi-change-working-dir",
	]) {
		// Each fixed unrelated package is a negative identity-isolation control.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(
			resolveExecutionCwd(
				api(undefined, { tools: [missingSource(name)], commands: [missingSource(name)] }),
				ctx,
			),
			ctx.cwd,
		);
	}
});
