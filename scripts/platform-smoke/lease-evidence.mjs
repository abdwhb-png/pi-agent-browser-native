/** Lease warmup/cleanup receipts remain part of the platform's final acceptance result. */
import { createSuiteDir, writeCommand, writeExitCode } from "./artifacts.mjs";
import {
	COMMON_EVIDENCE_FILES,
	STOP_EVIDENCE_FILES,
	finalizeSuite,
	makeRunId,
	secretValuesFor,
	secretViolationsFor,
	writeProcessReceipt,
	writeRedacted,
	writeTargetEvidence,
} from "./suite-evidence.mjs";
import { resolve } from "node:path";

export function createLeaseCleanupResult({
	config,
	targetName,
	leaseId,
	stopResult,
	staleCleanupResult = null,
	runId = makeRunId(),
}) {
	const suiteName = "lease-cleanup";
	const suiteDir = createSuiteDir(config.artifactRoot, runId, targetName, suiteName);
	const secretValues = secretValuesFor(config);
	writeTargetEvidence(
		suiteDir,
		{ config, targetName, runId, slug: `${config.packageName}-${targetName}` },
		{ suiteName, leaseId, modelCalls: 0 },
	);
	writeCommand(suiteDir, `crabbox stop ${targetName} --id ${leaseId}`);
	writeExitCode(suiteDir, stopResult.code, stopResult.signal);
	writeProcessReceipt(suiteDir, "crabbox.stop", stopResult, secretValues);
	const cleanupFiles = [];
	if (staleCleanupResult) {
		writeProcessReceipt(suiteDir, "crabbox.cleanup", staleCleanupResult, secretValues);
		cleanupFiles.push(
			"crabbox.cleanup.stdout.txt",
			"crabbox.cleanup.stderr.txt",
			"crabbox.cleanup.exit-code.txt",
		);
	}
	const secretViolations = secretViolationsFor(suiteDir, stopResult, secretValues);
	const { assertions } = finalizeSuite(
		suiteDir,
		[
			{
				id: "lease-cleanup",
				fn: () => stopResult.code === 0,
				error: `Crabbox stop failed with exit ${stopResult.code}`,
			},
			{
				id: "stale-cleanup",
				fn: () => !staleCleanupResult || staleCleanupResult.code === 0,
				error: `Crabbox cleanup failed with exit ${staleCleanupResult?.code}`,
			},
			{
				id: "no-secret-artifacts",
				fn: () => secretViolations.length === 0,
				error: secretViolations.join(", "),
			},
		],
		{
			target: targetName,
			suite: suiteName,
			exitCode: stopResult.code,
			signal: stopResult.signal,
			elapsedMs: 0,
		},
		[
			"summary.json",
			"artifact-manifest.json",
			"target.json",
			"suite.json",
			"command.txt",
			"exit-code.txt",
			...STOP_EVIDENCE_FILES,
			...cleanupFiles,
			"assertions.json",
		],
	);
	return { ok: assertions.ok, suiteDir, assertions };
}

export function createLeaseCleanupFailureResult(options) {
	return createLeaseCleanupResult({ ...options, staleCleanupResult: null });
}

export function createLeaseWarmupFailureResult(
	config,
	targetName,
	warmupResult,
	runId = makeRunId(),
) {
	const suiteName = "lease-warmup";
	const suiteDir = createSuiteDir(config.artifactRoot, runId, targetName, suiteName);
	const secretValues = secretValuesFor(config);
	writeTargetEvidence(
		suiteDir,
		{ config, targetName, runId, slug: `${config.packageName}-${targetName}` },
		{ suiteName, modelCalls: 0 },
	);
	writeCommand(suiteDir, `crabbox warmup ${targetName}`);
	writeExitCode(suiteDir, warmupResult.code, warmupResult.signal);
	writeRedacted(resolve(suiteDir, "crabbox.stdout.txt"), warmupResult.stdout ?? "", secretValues);
	writeRedacted(resolve(suiteDir, "crabbox.stderr.txt"), warmupResult.stderr ?? "", secretValues);
	const secretViolations = secretViolationsFor(suiteDir, warmupResult, secretValues);
	const { assertions } = finalizeSuite(
		suiteDir,
		[
			{
				id: "lease-warmup",
				fn: () => false,
				error: `Crabbox warmup failed with exit ${warmupResult.code}`,
			},
			{
				id: "no-secret-artifacts",
				fn: () => secretViolations.length === 0,
				error: secretViolations.join(", "),
			},
		],
		{
			target: targetName,
			suite: suiteName,
			exitCode: warmupResult.code,
			signal: warmupResult.signal,
			elapsedMs: 0,
			ok: false,
		},
		COMMON_EVIDENCE_FILES,
	);
	return { ok: false, suiteDir, assertions };
}
