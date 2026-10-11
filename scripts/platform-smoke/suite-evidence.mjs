/** Native process receipts, redacted artifacts, and fail-closed suite evidence. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	collectSecretValues,
	redactSecrets,
	scanArtifactTextFiles,
	scanForSecrets,
	writeExitCode,
	writeManifest,
	writeSummary,
} from "./artifacts.mjs";
import { crabboxBin, describeTarget } from "./crabbox-runner.mjs";

export const COMMON_EVIDENCE_FILES = [
	"summary.json",
	"artifact-manifest.json",
	"target.json",
	"suite.json",
	"command.txt",
	"exit-code.txt",
	"crabbox.stdout.txt",
	"crabbox.stderr.txt",
	"assertions.json",
];
export const STOP_EVIDENCE_FILES = [
	"crabbox.stop.stdout.txt",
	"crabbox.stop.stderr.txt",
	"crabbox.stop.exit-code.txt",
];

export function platformFor(targetName) {
	return targetName === "windows-native" ? "powershell" : "posix";
}

export function makeRunId() {
	return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function authEnvAllowList(config = {}) {
	const raw = process.env.PLATFORM_SMOKE_AUTH_ENV;
	const names = raw ? raw.split(",") : (config.defaultAuthEnv ?? []);
	return names.map((name) => String(name).trim()).filter(Boolean);
}

function packageVersion() {
	try {
		return JSON.parse(readFileSync("package.json", "utf8")).version ?? null;
	} catch {
		return null;
	}
}

function crabboxVersion() {
	try {
		return (
			execFileSync(crabboxBin(), ["--version"], {
				encoding: "utf8",
				stdio: "pipe",
				timeout: 10_000,
			})
				.trim()
				.split(/\r?\n/)[0] ?? null
		);
	} catch {
		return null;
	}
}

export function writeTargetEvidence(suiteDir, { config, targetName, runId, slug }, suite) {
	const target = describeTarget(targetName, config);
	const evidence = {
		targetName,
		platform: platformFor(targetName),
		runId,
		slug,
		packageName: config.packageName,
		packageVersion: packageVersion(),
		crabbox: {
			binary: crabboxBin(),
			version: crabboxVersion(),
			provider: target.provider,
			target: target.crabboxTarget,
			workRoot: target.workRoot,
			image: target.image,
			windowsMode: target.windowsMode,
			sourceVm: target.sourceVm,
			snapshot: target.snapshot,
		},
	};
	writeFileSync(resolve(suiteDir, "target.json"), JSON.stringify(evidence, null, 2));
	writeFileSync(resolve(suiteDir, "suite.json"), JSON.stringify(suite, null, 2));
}

export function secretValuesFor(config) {
	return collectSecretValues(authEnvAllowList(config));
}

export function writeRedacted(path, text, secretValues) {
	writeFileSync(path, redactSecrets(text ?? "", secretValues));
}

export function writeProcessReceipt(suiteDir, prefix, result, secretValues) {
	writeRedacted(resolve(suiteDir, `${prefix}.stdout.txt`), result.stdout ?? "", secretValues);
	writeRedacted(resolve(suiteDir, `${prefix}.stderr.txt`), result.stderr ?? "", secretValues);
	writeFileSync(
		resolve(suiteDir, `${prefix}.exit-code.txt`),
		`code=${result.code}\nsignal=${result.signal ?? "none"}\n`,
	);
}

export function secretViolationsFor(suiteDir, result, secretValues) {
	return [
		...scanForSecrets(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, secretValues),
		...scanArtifactTextFiles(suiteDir, secretValues).map(
			(finding) => `${finding.file}: ${finding.violation}`,
		),
	];
}

export function section(text, name) {
	const start = `--- ${name} START ---`;
	const end = `--- ${name} END ---`;
	const startIndex = text.indexOf(start);
	if (startIndex === -1) {
		return "";
	}
	const contentStart = startIndex + start.length;
	const endIndex = text.indexOf(end, contentStart);
	return (endIndex === -1 ? text.slice(contentStart) : text.slice(contentStart, endIndex))
		.replace(/^\r?\n/, "")
		.replace(/\r?\n$/, "");
}

export function marker(text, name) {
	return text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? "";
}

function parseJsonObject(text) {
	const trimmed = String(text ?? "").trim();
	if (!trimmed) {
		return {};
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		const first = trimmed.indexOf("{");
		const last = trimmed.lastIndexOf("}");
		if (first !== -1 && last > first) {
			try {
				return JSON.parse(trimmed.slice(first, last + 1));
			} catch {
				return {};
			}
		}
		return {};
	}
}

export function writePlatformExtracts(suiteDir, stdout, secretValues = []) {
	writeFileSync(
		resolve(suiteDir, "node-version.txt"),
		`${marker(stdout, "PLATFORM_NODE_VERSION")}\n`,
	);
	writeRedacted(
		resolve(suiteDir, "packed-tarball.txt"),
		`${marker(stdout, "PLATFORM_PACKED_TARBALL")}\n`,
		secretValues,
	);
	for (const [file, label] of [
		["packed-node-install", "PACKED_NODE_INSTALL"],
		["pi-install", "PI_INSTALL"],
		["pi-list", "PI_LIST"],
	]) {
		for (const [stream, suffix] of [
			["stdout", "STDOUT"],
			["stderr", "STDERR"],
		]) {
			writeRedacted(
				resolve(suiteDir, `${file}.${stream}.txt`),
				section(stdout, `${label}_${suffix}`),
				secretValues,
			);
		}
	}
}

export function writeDogfoodExtracts(suiteDir, stdout, secretValues = []) {
	writeFileSync(
		resolve(suiteDir, "node-version.txt"),
		`${marker(stdout, "PLATFORM_NODE_VERSION")}\n`,
	);
	writeRedacted(
		resolve(suiteDir, "dogfood-artifacts.txt"),
		`${marker(stdout, "PLATFORM_DOGFOOD_ARTIFACT_DIR")}\n`,
		secretValues,
	);
	const dogfoodStdout = section(stdout, "DOGFOOD_STDOUT");
	writeRedacted(resolve(suiteDir, "dogfood.stdout.txt"), dogfoodStdout, secretValues);
	writeRedacted(
		resolve(suiteDir, "dogfood.stderr.txt"),
		section(stdout, "DOGFOOD_STDERR"),
		secretValues,
	);
	const report = parseJsonObject(dogfoodStdout);
	writeRedacted(
		resolve(suiteDir, "dogfood-report.json"),
		JSON.stringify(report, null, 2),
		secretValues,
	);
	return report;
}

function writeAssertions(suiteDir, checks) {
	const evaluated = checks.map((check) => {
		let ok = false;
		let error = check.error;
		try {
			ok = check.fn() === true;
		} catch (err) {
			error = err.message;
		}
		return { id: check.id, ok, ...(ok ? {} : { error: error ?? `${check.id} failed` }) };
	});
	const assertions = {
		ok: evaluated.every((check) => check.ok),
		checks: evaluated,
		writtenAt: new Date().toISOString(),
	};
	writeFileSync(resolve(suiteDir, "assertions.json"), JSON.stringify(assertions, null, 2));
	if (!assertions.ok) {
		writeFileSync(
			resolve(suiteDir, "failures.md"),
			[
				"# Platform smoke failures",
				"",
				...assertions.checks
					.filter((check) => !check.ok)
					.map((check) => `- ${check.id}: ${check.error ?? "failed"}`),
				"",
				"Inspect command.txt, crabbox.stdout.txt, and crabbox.stderr.txt in this suite directory.",
				"",
			].join("\n"),
		);
	}
	return assertions;
}

export function finalizeSuite(suiteDir, checks, summary, expectedFiles) {
	const assertions = writeAssertions(suiteDir, checks);
	writeSummary(suiteDir, { ...summary, ok: assertions.ok });
	const expected = assertions.ok ? expectedFiles : [...expectedFiles, "failures.md"];
	const manifest = writeManifest(suiteDir, expected);
	if (manifest.missing.length === 0) {
		return { assertions, manifest };
	}
	const finalAssertions = writeAssertions(suiteDir, [
		...checks,
		{
			id: "artifact-manifest-complete",
			fn: () => false,
			error: `missing required artifact(s): ${manifest.missing.join(", ")}`,
		},
	]);
	writeSummary(suiteDir, { ...summary, ok: false });
	return {
		assertions: finalAssertions,
		manifest: writeManifest(suiteDir, [...expectedFiles, "failures.md"]),
	};
}

export function writeRunReceipt(suiteDir, result, elapsedMs, secretValues) {
	writeRedacted(resolve(suiteDir, "crabbox.stdout.txt"), result.stdout, secretValues);
	writeRedacted(resolve(suiteDir, "crabbox.stderr.txt"), result.stderr, secretValues);
	writeFileSync(
		resolve(suiteDir, "crabbox.timing.json"),
		JSON.stringify({ elapsedMs, code: result.code, signal: result.signal }, null, 2),
	);
	writeExitCode(suiteDir, result.code, result.signal);
}
