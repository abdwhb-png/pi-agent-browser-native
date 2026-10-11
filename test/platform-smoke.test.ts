import assert from "node:assert/strict";
import { readRecord, readArray, readString } from "./helpers/assertions.js";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function run(command: string, args: readonly string[]) {
	return spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: "utf8",
		shell: process.platform === "win32" && command === "npm",
	});
}

test("platform smoke scripts have working syntax and help", () => {
	for (const path of [
		"platform-smoke.config.mjs",
		"scripts/platform-smoke.mjs",
		"scripts/platform-smoke/artifacts.mjs",
		"scripts/platform-smoke/crabbox-runner.mjs",
		"scripts/platform-smoke/doctor.mjs",
		"scripts/platform-smoke/doctor-support.mjs",
		"scripts/platform-smoke/doctor-windows.mjs",
		"scripts/platform-smoke/commands.mjs",
		"scripts/platform-smoke/lease-evidence.mjs",
		"scripts/platform-smoke/suite-checks.mjs",
		"scripts/platform-smoke/suite-evidence.mjs",
		"scripts/platform-smoke/targets.mjs",
	]) {
		// Every file in this fixed script inventory must pass native syntax checking.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.equal(run(process.execPath, ["--check", path]).status, 0, path);
	}

	const doctorScript = readFileSync("scripts/platform-smoke/doctor-windows.mjs", "utf8");
	assert.match(doctorScript, /cleanup failed/);

	for (const path of [
		"scripts/platform-smoke/platform-build-windows.ps1",
		"scripts/platform-smoke/browser-dogfood-windows.ps1",
	]) {
		// Both fixed native Windows scripts must exist.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.ok(existsSync(path), `${path} should exist`);
		const powershellScript = readFileSync(path, "utf8");
		if (path.endsWith("browser-dogfood-windows.ps1")) {
			// This dogfood script alone must not perform a global npm install.
			// oxlint-disable-next-line node-test/no-conditional-assertion
			assert.doesNotMatch(powershellScript, /npm\s+install\s+-g/);
			// This dogfood script alone must not install upstream browser assets.
			// oxlint-disable-next-line node-test/no-conditional-assertion
			assert.doesNotMatch(powershellScript, /agent-browser\s+install/);
		}
	}

	const help = run(process.execPath, ["scripts/platform-smoke.mjs", "--help"]);
	assert.equal(help.status, 0);
	assert.match(help.stdout, /windows-native/);
	assert.match(help.stdout, /PLATFORM_SMOKE_CRABBOX/);
	assert.match(help.stdout, /platform-build/);
	assert.match(help.stdout, /browser-dogfood-smoke/);
	assert.match(help.stdout, /agent-browser/);
});

test("platform smoke config and package scripts require macOS, Ubuntu, and native Windows", () => {
	const packageJson = readRecord(JSON.parse(readFileSync("package.json", "utf8")));
	const files = readArray(packageJson.files);
	const scripts = readRecord(packageJson.scripts);
	assert.ok(files.includes("platform-smoke.config.mjs"));
	assert.ok(files.includes("scripts/platform-smoke.mjs"));
	assert.ok(files.includes("scripts/platform-smoke"));
	assert.ok(files.includes("docs/platform-smoke.md"));
	assert.match(
		readString(scripts["check:platform-smoke"]),
		/node --check scripts\/platform-smoke\.mjs/,
	);
	assert.match(readString(scripts["check:platform-smoke"]), /test\/platform-smoke\.test\.ts/);
	assert.equal(scripts["smoke:platform:doctor"], "node scripts/platform-smoke.mjs doctor");
	assert.match(readString(scripts["smoke:platform:ubuntu-image"]), /build-ubuntu-image\.mjs/);
	assert.match(readString(scripts["smoke:platform:all"]), /smoke:platform:doctor/);
	assert.match(readString(scripts["smoke:platform:all"]), /macos,ubuntu,windows-native/);
	assert.match(readString(scripts["smoke:platform:windows-native"]), /windows-native/);
	const linuxImage = readFileSync("scripts/platform-smoke/linux-image/Dockerfile", "utf8");
	for (const dependency of ["libvulkan1", "mesa-vulkan-drivers", "xvfb"]) {
		// Every fixed Ubuntu graphics dependency must remain in the image.
		// oxlint-disable-next-line node-test/no-conditional-assertion
		assert.match(linuxImage, new RegExp(`\\b${dependency}\\b`));
	}

	const code = String.raw`
import config, * as configModule from "./platform-smoke.config.mjs";
const result = {
  agentBrowserVersion: config.agentBrowserVersion,
  crabboxMinVersion: config.requiredCrabbox.minVersion,
  nodeValidationVersion: config.nodeValidationVersion,
  packageName: config.packageName,
  privateConstantsExported: "PLATFORM_SMOKE_AGENT_BROWSER_VERSION" in configModule || "PLATFORM_SMOKE_UBUNTU_IMAGE" in configModule,
  ubuntuContainerImage: config.ubuntuContainerImage,
  windowsSourceVm: config.windowsParallels.sourceVm,
  windowsSnapshot: config.windowsParallels.snapshot,
  suites: config.requiredSuites,
  targets: config.requiredTargets,
};
console.log(JSON.stringify(result));
if (result.packageName !== "pi-agent-browser-native" || result.privateConstantsExported) process.exit(1);
if (result.crabboxMinVersion !== "0.26.0") process.exit(1);
if (result.nodeValidationVersion !== "22.19.0") process.exit(1);
if (!result.ubuntuContainerImage.includes("agent-browser" + result.agentBrowserVersion)) process.exit(1);
if (result.windowsSourceVm !== "pi-extension-windows-template" || !String(result.windowsSnapshot || "").startsWith("crabbox-ready")) process.exit(1);
if (!/^\d+\.\d+\.\d+$/.test(result.agentBrowserVersion)) process.exit(1);
if (result.suites.join(",") !== "platform-build,browser-dogfood-smoke") process.exit(1);
if (result.targets.join(",") !== "macos,ubuntu,windows-native") process.exit(1);
`;
	const result = run(process.execPath, ["--input-type=module", "-e", code]);
	assert.equal(result.status, 0, result.stderr);
});

test("platform command rendering uses POSIX and PowerShell without source-extension shortcuts", () => {
	const code = String.raw`
import { readFileSync } from "node:fs";
import { CAPABILITY_BASELINE } from "./scripts/agent-browser-capability-baseline.mjs";
import { buildBrowserDogfoodCommand, buildPlatformBuildCommand, nodeVersionAtLeast, platformFor } from "./scripts/platform-smoke/targets.mjs";
const posix = buildPlatformBuildCommand("ubuntu", "pi-agent-browser-native", "24.21.0");
const macos = buildPlatformBuildCommand("macos", "pi-agent-browser-native", "24.21.0");
const powershell = buildPlatformBuildCommand("windows-native", "pi-agent-browser-native", "24.21.0");
const powershellScript = readFileSync("scripts/platform-smoke/platform-build-windows.ps1", "utf8");
const dogfoodPosix = buildBrowserDogfoodCommand("ubuntu");
const dogfoodWarmPosix = buildBrowserDogfoodCommand("ubuntu", CAPABILITY_BASELINE.targetVersion, true);
const dogfoodWindows = buildBrowserDogfoodCommand("windows-native");
const dogfoodWarmWindows = buildBrowserDogfoodCommand("windows-native", CAPABILITY_BASELINE.targetVersion, true);
const result = {
  macosPlatform: platformFor("macos") === "posix",
  ubuntuPlatform: platformFor("ubuntu") === "posix",
  windowsPlatform: platformFor("windows-native") === "powershell",
  nodePatchFloorEnforced: !nodeVersionAtLeast("v24.20.9", "24.21.0") && !nodeVersionAtLeast("v24.3.0", "24.21.0") && nodeVersionAtLeast("v24.21.0", "24.21.0") && nodeVersionAtLeast("v24.100.0", "24.21.0") && nodeVersionAtLeast("v25.0.0", "24.21.0") && !nodeVersionAtLeast("", "24.21.0"),
  commandsCarryNodeFloor: posix.includes("'24.21.0'") && powershell.includes("-NodeValidationVersion '24.21.0'"),
  posixHasVerify: posix.includes("npm run verify -- platform-target"),
  posixHasPackedInstall: posix.includes("install -l --approve ./node_modules/pi-agent-browser-native"),
  posixHasApprovedList: posix.includes("list --approve"),
  posixNoExtensionShortcut: !/\bpi\s+(?:-e|--extension)\s+\./.test(posix),
  posixNoFixtureCopy: !posix.includes("cp -R src prompts"),
  macosHasVerify: macos.includes("npm run verify -- platform-target"),
  powershellUsesScript: powershell.includes("platform-build-windows.ps1"),
  powershellHasPackage: powershell.includes("pi-agent-browser-native"),
  powershellHasApprovedPackageCommands: powershellScript.includes("install -l --approve") && powershellScript.includes("list --approve"),
  powershellNoExtensionShortcut: !/\bpi\s+(?:-e|--extension)\s+\./.test(powershell),
  dogfoodRunsScript: dogfoodPosix.includes("verify-agent-browser-dogfood.ts"),
  dogfoodChecksBaseline: dogfoodPosix.includes("EXPECTED_AGENT_BROWSER_VERSION='agent-browser " + CAPABILITY_BASELINE.targetVersion + "'") && dogfoodPosix.includes("PLATFORM_AGENT_BROWSER_READY_EXIT"),
  dogfoodKeepsArtifacts: dogfoodPosix.includes("--artifact-dir"),
  dogfoodColdInstallsDependencies: dogfoodPosix.includes("npm ci 2>&1") && !dogfoodPosix.includes("PLATFORM_NPM_CI_SKIPPED=1"),
  dogfoodWarmSkipsDuplicateInstall: dogfoodWarmPosix.includes("PLATFORM_NPM_CI_SKIPPED=1") && dogfoodWarmWindows.includes("-SkipNpmCi") && !dogfoodWindows.includes("-SkipNpmCi"),
  dogfoodWindowsUsesScript: dogfoodWindows.includes("browser-dogfood-windows.ps1") && dogfoodWindows.includes("-AgentBrowserVersion '" + CAPABILITY_BASELINE.targetVersion + "'") && dogfoodWarmWindows.includes("-AgentBrowserVersion '" + CAPABILITY_BASELINE.targetVersion + "'"),
  dogfoodWindowsDoesNotBootstrap: !dogfoodWindows.includes("npm install -g") && !dogfoodWindows.includes("agent-browser install"),
};
console.log(JSON.stringify(result));
if (!Object.values(result).every(Boolean)) process.exit(1);
`;
	const result = run(process.execPath, ["--input-type=module", "-e", code]);
	assert.equal(result.status, 0, result.stderr + result.stdout);
});

test("artifact manifests and lease cleanup failures are enforced", () => {
	const code = String.raw`
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSecretValues, redactSecrets, scanForSecrets, writeManifest } from "./scripts/platform-smoke/artifacts.mjs";
import { createLeaseCleanupFailureResult, createLeaseCleanupResult, createLeaseWarmupFailureResult } from "./scripts/platform-smoke/targets.mjs";

const root = mkdtempSync(join(tmpdir(), "pi-agent-browser-platform-smoke-test-"));
try {
  const suiteDir = join(root, "suite");
  mkdirSync(suiteDir, { recursive: true });
  writeFileSync(join(suiteDir, "present.txt"), "ok");
  const manifest = writeManifest(suiteDir, ["artifact-manifest.json", "present.txt", "missing.txt"]);
  const cleanup = createLeaseCleanupFailureResult({ config: { artifactRoot: root, packageName: "pi-agent-browser-native" }, targetName: "ubuntu", leaseId: "cbx_failed", stopResult: {
    stdout: "",
    stderr: "stop failed",
    code: 1,
    signal: null,
  }});
  const cleanupSuccess = createLeaseCleanupResult({ config: { artifactRoot: root, packageName: "pi-agent-browser-native" }, targetName: "ubuntu", leaseId: "cbx_ok", stopResult: {
    stdout: "stopped",
    stderr: "",
    code: 0,
    signal: null,
  }, staleCleanupResult: {
    stdout: "cleaned stale clones",
    stderr: "",
    code: 0,
    signal: null,
  }});
  const warmupFailure = createLeaseWarmupFailureResult({ artifactRoot: root, packageName: "pi-agent-browser-native" }, "ubuntu", {
    stdout: "",
    stderr: "warmup failed",
    code: 1,
    signal: null,
  });
  const assertions = JSON.parse(readFileSync(join(cleanup.suiteDir, "assertions.json"), "utf8"));
  const successManifest = JSON.parse(readFileSync(join(cleanupSuccess.suiteDir, "artifact-manifest.json"), "utf8"));
  const successTarget = JSON.parse(readFileSync(join(cleanupSuccess.suiteDir, "target.json"), "utf8"));
  const env = { ZAI_API_KEY: "zai-secret-value-1234567890" };
  const secrets = collectSecretValues(["ZAI_API_KEY"], env);
  const redacted = redactSecrets("token=" + env.ZAI_API_KEY, secrets);
  const result = {
    manifestIncludesSelf: manifest.present.includes("artifact-manifest.json"),
    missingRecorded: manifest.missing.includes("missing.txt"),
    cleanupOk: cleanup.ok,
    cleanupSuccessOk: cleanupSuccess.ok,
    cleanupSuccessRecorded: successManifest.present.includes("crabbox.stop.stdout.txt") && successManifest.present.includes("crabbox.cleanup.stdout.txt"),
    cleanupTargetMetadata: successTarget.packageName === "pi-agent-browser-native" && successTarget.crabbox.provider === "local-container" && successTarget.crabbox.workRoot === "/work/crabbox",
    warmupFailureRecorded: warmupFailure.ok === false && readFileSync(join(warmupFailure.suiteDir, "failures.md"), "utf8").includes("lease-warmup"),
    assertionsOk: assertions.ok,
    leaseCleanupFailed: assertions.checks.some((check) => check.id === "lease-cleanup" && check.ok === false),
    secretDetected: scanForSecrets("token=" + env.ZAI_API_KEY, secrets).includes("raw forwarded secret value"),
    secretRedacted: !redacted.includes(env.ZAI_API_KEY) && redacted.includes("[REDACTED_SECRET]"),
  };
  console.log(JSON.stringify(result));
  if (!result.manifestIncludesSelf || !result.missingRecorded || result.cleanupOk || !result.cleanupSuccessOk || !result.cleanupSuccessRecorded || !result.cleanupTargetMetadata || !result.warmupFailureRecorded || result.assertionsOk || !result.leaseCleanupFailed || !result.secretDetected || !result.secretRedacted) process.exit(1);
} finally {
  rmSync(root, { recursive: true, force: true });
}
`;
	const result = run(process.execPath, ["--input-type=module", "-e", code]);
	assert.equal(result.status, 0, result.stderr + result.stdout);
});
