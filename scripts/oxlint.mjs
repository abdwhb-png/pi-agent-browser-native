#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";
import { prepareQualityChecker } from "./prepare-quality-checker.mjs";

// The same corrected engine serves CLI, agent output, autofixes, probes, and editor LSP.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
try {
	const checker = await prepareQualityChecker();
	const env = { ...process.env, OXLINT_TSGOLINT_PATH: checker };
	for (const name of Object.keys(env)) {
		if (name.toUpperCase() === "OXLINT_TSGOLINT_DANGEROUSLY_SUPPRESS_PROGRAM_DIAGNOSTICS") {
			delete env[name];
		}
	}
	const child = crossSpawn.spawn(
		process.execPath,
		[join(root, "node_modules", "oxlint", "bin", "oxlint"), ...process.argv.slice(2)],
		{
			cwd: process.cwd(),
			env,
			stdio: "inherit",
		},
	);
	child.on("error", (error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
	child.on("close", (code, signal) => {
		process.exitCode = signal === null ? (code ?? 1) : 1;
	});
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
