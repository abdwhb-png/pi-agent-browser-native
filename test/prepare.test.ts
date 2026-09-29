import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("prepare builds a Git checkout when Bun is the package manager", async () => {
	const checkout = await mkdtemp(join(tmpdir(), "pi-agent-browser-prepare-"));
	try {
		await mkdir(join(checkout, "scripts"));
		await mkdir(join(checkout, "bin"));
		await copyFile(join(import.meta.dirname, "../scripts/prepare.mjs"), join(checkout, "scripts/prepare.mjs"));
		await writeFile(join(checkout, "scripts/build.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync("built", "yes");\n');
		const sfw = join(checkout, "bin/sfw");
		await writeFile(sfw, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync("install-args.json", JSON.stringify(process.argv.slice(2)));\n');
		await chmod(sfw, 0o755);
		const bunExecutable = join(checkout, "bin/bun");
		await writeFile(bunExecutable, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));

		await execFile(process.execPath, ["scripts/prepare.mjs"], {
			cwd: checkout,
			env: { ...process.env, PATH: `${join(checkout, "bin")}${delimiter}${process.env.PATH ?? ""}`, npm_execpath: bunExecutable },
			timeout: 15_000,
		});
		assert.deepEqual(JSON.parse(await readFile(join(checkout, "install-args.json"), "utf8")), ["--", "bun", "install", "--ignore-scripts"]);
		assert.equal(await readFile(join(checkout, "built"), "utf8"), "yes");
	} finally {
		await rm(checkout, { recursive: true, force: true });
	}
});
