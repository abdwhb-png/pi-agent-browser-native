import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
	mkdirSync,
	cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { sourcePolicy } from "../scripts/code-quality-policy.mjs";
import { prepareQualityChecker } from "../scripts/prepare-quality-checker.mjs";

const root = path.resolve(import.meta.dirname, "..");
await prepareQualityChecker();

function nativeCases(): readonly {
	readonly name: string;
	readonly source: string;
	readonly type: string;
}[] {
	const config: unknown = JSON.parse(readFileSync(path.join(root, ".oxlintrc.json"), "utf8"));
	assert.ok(config !== null && typeof config === "object" && "rules" in config);
	assert.ok(config.rules !== null && typeof config.rules === "object");
	assert.ok("typescript/prefer-readonly-parameter-types" in config.rules);
	const rule: unknown = config.rules["typescript/prefer-readonly-parameter-types"];
	assert.ok(Array.isArray(rule));
	const options: unknown = rule[1];
	assert.ok(options !== null && typeof options === "object" && "allow" in options);
	assert.ok(Array.isArray(options.allow));
	return options.allow.flatMap((entry: unknown) => {
		assert.ok(entry !== null && typeof entry === "object" && "from" in entry && "name" in entry);
		assert.ok(typeof entry.from === "string");
		const names: unknown = entry.name;
		assert.ok(Array.isArray(names));
		const from = entry.from;
		const packageName = "package" in entry ? entry.package : null;
		return names.map((item: unknown) => nativeCase(from, packageName, item));
	});
}

function nativeCase(from: string, packageName: unknown, item: unknown) {
	assert.ok(typeof item === "string" && /^[A-Za-z]\w*$/u.test(item));
	const generic = ["Promise", "PromiseLike", "AgentToolResult"].includes(item) ? "<string>" : "";
	if (from === "lib") {
		return { name: item, source: "", type: `${item}${generic}` };
	}
	assert.equal(from, "package");
	assert.ok(typeof packageName === "string");
	if (packageName === "node" && ["Timeout", "ProcessEnv"].includes(item)) {
		return { name: item, source: "", type: `NodeJS.${item}` };
	}
	if (packageName === "stream-json" && item === "Token") {
		return {
			name: item,
			source: `import type Parser from "stream-json/parser.js";`,
			type: "Parser.Token",
		};
	}
	const nodeOrigins: Readonly<Partial<Record<string, string>>> = {
		ChildProcess: "node:child_process",
		ChildProcessWithoutNullStreams: "node:child_process",
		SpawnOptions: "node:child_process",
		ExecFileOptions: "node:child_process",
		URL: "node:url",
		StatOptions: "node:fs",
		ReadFileOptions: "node:fs",
		Dirent: "node:fs",
		Stats: "node:fs",
		FileHandle: "node:fs/promises",
		Server: "node:http",
		IncomingMessage: "node:http",
		ServerResponse: "node:http",
		AddressInfo: "node:net",
		Buffer: "node:buffer",
		EventEmitter: "node:events",
	};
	const origin = packageName === "node" ? nodeOrigins[item] : packageName;
	assert.ok(origin !== undefined, `Missing real declaration origin for ${item}`);
	const namespace = `Native_${origin.replaceAll(/[^a-zA-Z0-9]/gu, "_")}`;
	return {
		name: item,
		source: `import type * as ${namespace} from ${JSON.stringify(origin)};`,
		type: `${namespace}.${item}${item === "Model" && packageName === "@earendil-works/pi-ai" ? `<${namespace}.Api>` : generic}`,
	};
}

function fixture(t: TestContext): string {
	const directory = mkdtempSync(path.join(tmpdir(), "piab-quality-"));
	t.after(() => {
		rmSync(directory, { recursive: true, force: true });
	});
	symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), "junction");
	cpSync(path.join(root, ".oxlintrc.json"), path.join(directory, ".oxlintrc.json"));
	mkdirSync(path.join(directory, "scripts"));
	for (const file of [
		"code-quality.mjs",
		"code-quality-policy.mjs",
		"code-quality-boundaries.mjs",
	]) {
		cpSync(path.join(root, "scripts", file), path.join(directory, "scripts", file));
	}
	writeFileSync(
		path.join(directory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ESNext",
				module: "NodeNext",
				strict: true,
				noImplicitReturns: true,
				allowJs: true,
				skipLibCheck: true,
				noEmit: true,
				types: ["node"],
			},
			include: ["*.ts", "*.js", "test/**/*.ts"],
		}),
	);
	return directory;
}

function run(
	directory: string,
	command: string,
	args: readonly string[],
	env: Readonly<NodeJS.ProcessEnv> = {},
) {
	const result = spawnSync(process.execPath, [command, ...args], {
		cwd: directory,
		encoding: "utf8",
		timeout: 30_000,
		env: { ...process.env, ...env },
	});
	assert.equal(result.error, undefined);
	assert.equal(result.signal, null);
	return result;
}

function lint(
	directory: string,
	expectedCodes: readonly string[] = [],
	env: Readonly<NodeJS.ProcessEnv> = {},
) {
	const result = run(directory, path.join(root, "scripts/oxlint.mjs"), ["--format=json", "."], env);
	assert.match(result.stdout, /^\{/u, result.stderr);
	const output: unknown = JSON.parse(result.stdout);
	assert.ok(output !== null && typeof output === "object" && "diagnostics" in output);
	assert.ok(Array.isArray(output.diagnostics));
	const codes = new Set<string>();
	const locations = [];
	for (const item of output.diagnostics) {
		const location = diagnosticLocation(item);
		codes.add(location.code);
		locations.push(location);
	}
	assert.deepEqual([...codes].sort(), [...expectedCodes].sort(), result.stdout);
	return { ...result, diagnosticCount: output.diagnostics.length, diagnosticLocations: locations };
}

function diagnosticLocation(value: unknown) {
	assert.ok(value !== null && typeof value === "object");
	assert.ok("code" in value && typeof value.code === "string");
	assert.ok("filename" in value && typeof value.filename === "string");
	assert.ok("labels" in value && Array.isArray(value.labels));
	const label: unknown = value.labels[0];
	assert.ok(label !== null && typeof label === "object" && "span" in label);
	const span: unknown = label.span;
	assert.ok(span !== null && typeof span === "object" && "line" in span);
	assert.ok(typeof span.line === "number" && span.line > 0);
	return { code: value.code, filename: value.filename, line: span.line };
}

test("suppression policy reads comments, rejects escape hatches, and inventories narrow exceptions", () => {
	const documentation = `const example = "// oxlint-disable"; const other = \`// @ts-ignore\`;
/* Documentation mentions oxlint-disable-next-line, not a directive. */`;
	assert.equal(sourcePolicy("example.ts", documentation).entries.length, 0);
	for (const directive of [
		"oxlint-disable",
		"oxlint-disable-next-line no-floating-promises -- Framework work is owned",
		"oxlint-disable-next-line no-await-in-loop",
		"oxlint-disable-next-line no-await-in-loop, no-control-regex -- Ordered stream commits",
		"eslint-disable-next-line no-await-in-loop",
		"@ts-ignore",
		"@ts-nocheck",
		"@ts-nocheck0",
		"@ts-nocheck_foo",
		"@ts-ignore0",
		"@ts-ignore_foo",
		"@TS-NOCHECK",
		"/ @ts-ignore",
		"/ @ts-nocheck",
		"@ts-expect-error: forbidden outside negative type tests",
	]) {
		// oxlint-disable-next-line node-test/no-conditional-assertion -- Every listed forbidden directive is exhaustively checked.
		assert.throws(() => {
			sourcePolicy("source.ts", `// ${directive}\nexport const value = 1;`);
		});
	}
	const approved = sourcePolicy(
		"journal.ts",
		"// Journal commits must complete in order.\n// oxlint-disable-next-line no-await-in-loop\nawait commit();",
	);
	assert.equal(approved.entries.length, 1);
	assert.equal(approved.entries[0]?.rule, "no-await-in-loop");
	assert.equal(
		sourcePolicy("shape.test-d.ts", "// @ts-expect-error: rejects invalid public input\ncall(1);")
			.entries.length,
		1,
	);
	assert.throws(() => {
		sourcePolicy("shape.test-d.ts", "// @ts-expect-error: short\ncall(1);");
	});
	assert.throws(() => {
		sourcePolicy("source.ts", "/** @ts-ignore */\nexport const value: number = 'wrong';");
	});
	assert.throws(() => {
		sourcePolicy(
			"source.ts",
			"/* Explanation\n @ts-ignore */\nexport const value: number = 'wrong';",
		);
	});
	assert.throws(() => {
		sourcePolicy(
			"source.ts",
			"/* Explanation\n @ts-expect-error: forbidden outside negative type tests */\ncall(1);",
		);
	});
	assert.equal(
		sourcePolicy(
			"shape.test-d.ts",
			"/* Explanation\n @ts-expect-error: rejects invalid public input */\ncall(1);",
		).entries.length,
		1,
	);
	assert.throws(() => {
		sourcePolicy(
			"source.ts",
			"// This validator rejects protocol control characters.\n// oxlint-disable-next-line no-control-regex\n// oxlint-disable-next-line no-await-in-loop\nawait commit();",
		);
	});
	for (const [source, checked] of [
		["/// @ts-check\nexport const value = 1;", true],
		["// @ts-check-foo\nexport const value = 1;", false],
		["// @ts-check_foo\nexport const value = 1;", true],
		["// @ts-check0\nexport const value = 1;", true],
		["// \u00a0@ts-check\nexport const value = 1;", false],
		["// \u2003@ts-check\nexport const value = 1;", false],
		["/* @ts-check */\nexport const value = 1;", false],
		["/** @ts-check */\nexport const value = 1;", false],
		["#! @ts-check\nexport const value = 1;", false],
		["export const value = 1;\n// @ts-check", false],
		["// Documentation mentions @ts-check.\nexport const value = 1;", false],
		['export const value = "// @ts-check";', false],
	] as const) {
		// oxlint-disable-next-line node-test/no-conditional-assertion -- Every checking pragma and non-pragma case is exhaustively validated.
		assert.equal(sourcePolicy("source.js", source).checked, checked, source);
	}
});

test("checking pragma scope agrees with real compiler and semantic coverage", (t) => {
	const directory = fixture(t);
	for (const [name, header] of [
		["triple", "/// @ts-check"],
		["hyphen", "// @ts-check-foo"],
		["underscore", "// @ts-check_foo"],
		["zero", "// @ts-check0"],
		["block", "/* @ts-check */"],
		["jsdoc", "/** @ts-check */"],
	]) {
		writeFileSync(
			path.join(directory, `${name}.js`),
			`${header}\n/** @type {number} */\nexport const value = "wrong";\nasync function operation() { return 1; }\noperation();\n`,
		);
	}
	assert.equal(run(directory, "scripts/code-quality.mjs", ["scope", "--write"]).status, 0);
	const compiler = run(directory, path.join(root, "node_modules/typescript/lib/tsc.js"), [
		"--project",
		"tsconfig.json",
		"--pretty",
		"false",
	]);
	assert.equal(compiler.status, 1, compiler.stdout);
	assert.match(compiler.stdout, /triple\.js.*TS2322/u);
	assert.match(compiler.stdout, /underscore\.js.*TS2322/u);
	assert.match(compiler.stdout, /zero\.js.*TS2322/u);
	assert.doesNotMatch(compiler.stdout, /(?:block|jsdoc|hyphen)\.js/u);
	const semantic = lint(directory, ["typescript(no-floating-promises)", "typescript(TS2322)"]);
	assert.equal(semantic.diagnosticCount, 6);
	assert.match(semantic.stdout, /triple\.js/u);
	assert.match(semantic.stdout, /underscore\.js/u);
	assert.match(semantic.stdout, /zero\.js/u);
	assert.doesNotMatch(semantic.stdout, /(?:block|jsdoc|hyphen)\.js/u);
});

test("real CLI retains unchecked JS syntax checks and checked-source semantic/compiler checks", (t) => {
	const directory = fixture(t);
	writeFileSync(path.join(directory, "unchecked.js"), "export const value = 1;\n");
	writeFileSync(path.join(directory, "checked.js"), "// @ts-check\nexport const value = 1;\n");
	writeFileSync(path.join(directory, "typed.ts"), "export const value = 1;\n");
	const generated = run(directory, "scripts/code-quality.mjs", ["scope", "--write"]);
	assert.equal(generated.status, 0, generated.stderr);

	writeFileSync(path.join(directory, "unchecked.js"), "export const value = 1 == '1';\n");
	const syntactic = lint(directory, ["eslint(eqeqeq)"]);
	assert.equal(syntactic.status, 1);
	assert.match(syntactic.stdout, /eslint\(eqeqeq\)/u);
	writeFileSync(
		path.join(directory, "unchecked.js"),
		"async function operation() { return 1; }\noperation();\n",
	);
	const unchecked = lint(directory);
	assert.equal(unchecked.status, 0, unchecked.stdout);

	writeFileSync(
		path.join(directory, "checked.js"),
		"// @ts-check\nasync function operation() { return 1; }\noperation();\n",
	);
	writeFileSync(
		path.join(directory, "typed.ts"),
		"declare function operation(): Promise<number>;\noperation();\n",
	);
	const semantic = lint(directory, ["typescript(no-floating-promises)"]);
	assert.equal(semantic.status, 1);
	assert.match(semantic.stdout, /typescript\(no-floating-promises\)/u);
	assert.match(semantic.stdout, /checked\.js/u);
	assert.match(semantic.stdout, /typed\.ts/u);

	writeFileSync(
		path.join(directory, "checked.js"),
		"// @ts-check\n/** @type {number} */\nexport const value = 'wrong';\n",
	);
	writeFileSync(path.join(directory, "typed.ts"), "export const value: number = 'wrong';\n");
	const compiler = lint(directory, ["typescript(TS2322)"]);
	assert.equal(compiler.status, 1);
	assert.match(compiler.stdout, /2322/u);
	assert.match(compiler.stdout, /checked\.js/u);
	assert.match(compiler.stdout, /typed\.ts/u);
	const inheritedSuppression = lint(directory, ["typescript(TS2322)"], {
		OXLINT_TSGOLINT_DANGEROUSLY_SUPPRESS_PROGRAM_DIAGNOSTICS: "1",
	});
	assert.equal(inheritedSuppression.status, 1);
	const mixedCaseSuppression = lint(directory, ["typescript(TS2322)"], {
		OxLiNt_TsGoLiNt_DaNgErOuSlY_SuPpReSs_PrOgRaM_DiAgNoStIcS: "1",
	});
	assert.equal(mixedCaseSuppression.status, 1);
	assert.deepEqual(inheritedSuppression.diagnosticLocations, compiler.diagnosticLocations);
	assert.deepEqual(mixedCaseSuppression.diagnosticLocations, compiler.diagnosticLocations);
	assert.deepEqual(
		compiler.diagnosticLocations
			.map((location) => ({ filename: location.filename, line: location.line }))
			.sort((left, right) => left.filename.localeCompare(right.filename)),
		[
			{ filename: "checked.js", line: 3 },
			{ filename: "typed.ts", line: 1 },
		],
	);
});

test("scope drift cannot silently add unchecked files or hide a JS checking directive", (t) => {
	const directory = fixture(t);
	writeFileSync(path.join(directory, "unchecked.js"), "export const value = 1;\n");
	assert.equal(run(directory, "scripts/code-quality.mjs", ["scope", "--write"]).status, 0);
	writeFileSync(path.join(directory, "unchecked.js"), "// @ts-check\nexport const value = 1;\n");
	const addedDirective = run(directory, "scripts/code-quality.mjs", ["check"]);
	assert.equal(addedDirective.status, 1);
	assert.match(addedDirective.stderr, /scope\/metadata drift/u);
	assert.equal(run(directory, "scripts/code-quality.mjs", ["scope", "--write"]).status, 0);
	writeFileSync(path.join(directory, "new.js"), "export const value = 1;\n");
	assert.equal(run(directory, "scripts/code-quality.mjs", ["check"]).status, 1);
	writeFileSync(path.join(directory, "checked.js"), "// @ts-nocheck\nexport const value = 1;\n");
	const nocheck = run(directory, "scripts/code-quality.mjs", ["check"]);
	assert.equal(nocheck.status, 1);
	assert.match(nocheck.stderr, /compiler escape hatch/u);
});

test("inherited checkJs controls compiler and semantic coverage independently of test role", (t) => {
	const directory = fixture(t);
	const config = readFileSync(path.join(directory, "tsconfig.json"), "utf8");
	writeFileSync(
		path.join(directory, "tsconfig.base.json"),
		config.replace('"allowJs":true', '"allowJs":true,"checkJs":true'),
	);
	writeFileSync(path.join(directory, "tsconfig.json"), '{"extends":"./tsconfig.base.json"}\n');
	writeFileSync(
		path.join(directory, "inherited.js"),
		"async function operation() { return 1; }\noperation();\n",
	);
	assert.equal(run(directory, "scripts/code-quality.mjs", ["scope", "--write"]).status, 0);
	const semantic = lint(directory, ["typescript(no-floating-promises)"]);
	assert.equal(semantic.status, 1);
	assert.match(semantic.stdout, /typescript\(no-floating-promises\)/u);
	assert.match(semantic.stdout, /inherited\.js/u);
	writeFileSync(
		path.join(directory, "inherited.js"),
		"/** @type {number} */\nexport const value = 'wrong';\n",
	);
	const compiler = lint(directory, ["typescript(TS2322)"]);
	assert.equal(compiler.status, 1);
	assert.match(compiler.stdout, /2322/u);
	assert.match(compiler.stdout, /inherited\.js/u);
});

test("unchecked imported JavaScript stays resolvable while consumers retain type safety", (t) => {
	const directory = fixture(t);
	writeFileSync(path.join(directory, "unchecked.js"), "export const value = 'text';\n");
	writeFileSync(
		path.join(directory, "consumer.ts"),
		"import { value } from './unchecked.js';\nexport const number: number = value;\n",
	);
	assert.equal(run(directory, "scripts/code-quality.mjs", ["scope", "--write"]).status, 0);
	const result = lint(directory, ["typescript(TS2322)"]);
	assert.equal(result.status, 1);
	assert.match(result.stdout, /2322/u);
	assert.match(result.stdout, /consumer\.ts/u);
	assert.doesNotMatch(result.stdout, /unchecked\.js.*(?:2322|no-floating-promises)/u);
});

test("checked imported JS cannot rely on compiler fallback outside explicit project inputs", (t) => {
	const directory = fixture(t);
	const config = readFileSync(path.join(directory, "tsconfig.json"), "utf8")
		.replace('"allowJs":true', '"allowJs":true,"checkJs":true')
		.replace('"include":["*.ts","*.js","test/**/*.ts"]', '"include":["consumer.ts"]');
	writeFileSync(path.join(directory, "tsconfig.json"), config);
	writeFileSync(
		path.join(directory, "checked.js"),
		"/** @type {number} */\nexport const value = 'wrong';\n",
	);
	writeFileSync(path.join(directory, "consumer.ts"), "export { value } from './checked.js';\n");
	const outside = run(directory, "scripts/code-quality.mjs", ["scope", "--write"]);
	assert.equal(outside.status, 1);
	assert.match(
		outside.stderr,
		/checked\.js: checked source is missing from explicit compiler project inputs/u,
	);
	writeFileSync(
		path.join(directory, "tsconfig.json"),
		config.replace('"include":["consumer.ts"]', '"include":["consumer.ts","checked.js"]'),
	);
	assert.equal(run(directory, "scripts/code-quality.mjs", ["scope", "--write"]).status, 0);
	assert.equal(lint(directory, ["typescript(TS2322)"]).status, 1);
});

test("Node test rules reject vacuous/conditional tests and nested imported registrations", (t) => {
	const directory = fixture(t);
	const file = path.join(directory, "framework.test.ts");
	writeFileSync(
		file,
		"import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('works', () => { assert.equal(1 + 1, 2); });\n",
	);
	assert.equal(lint(directory).status, 0);
	writeFileSync(
		file,
		"import test from 'node:test';\ntest('vacuous', () => { console.log('not an assertion'); });\n",
	);
	const vacuous = lint(directory, ["node-test(require-assertion)"]);
	assert.equal(vacuous.status, 1);
	assert.match(vacuous.stdout, /node-test\(require-assertion\)/u);
	writeFileSync(
		file,
		"import assert from 'node:assert/strict';\nimport test from 'node:test';\ndeclare const condition: boolean;\ntest('conditional', () => { if (condition) { assert.equal(1 + 1, 2); } });\n",
	);
	const conditional = lint(directory, ["node-test(no-conditional-assertion)"]);
	assert.equal(conditional.status, 1);
	assert.match(conditional.stdout, /node-test\(no-conditional-assertion\)/u);
	writeFileSync(
		file,
		"import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('parent', () => { assert.equal(1 + 1, 2); test('child', () => { assert.equal(1 + 1, 2); }); });\n",
	);
	const nested = lint(directory, [
		"node-test(no-nested-tests)",
		"typescript(no-floating-promises)",
	]);
	assert.equal(nested.status, 1);
	assert.match(nested.stdout, /node-test\(no-nested-tests\)/u);
});

test("qualified registration allowance cannot exempt shadows, other declarations or ordinary work", (t) => {
	const directory = fixture(t);
	const file = path.join(directory, "identity.test.ts");
	writeFileSync(
		file,
		"import assert from 'node:assert/strict';\nimport { test as register } from 'node:test';\nregister('actual declaration', () => { assert.equal(1 + 1, 2); });\n",
	);
	assert.equal(lint(directory).status, 0);
	writeFileSync(
		file,
		"import assert from 'node:assert/strict';\nimport { test as register } from 'node:test';\nregister('actual declaration', () => { assert.equal(1 + 1, 2); });\nasync function test(): Promise<number> { return 1; }\ntest();\n",
	);
	const local = lint(directory, ["typescript(no-floating-promises)"]);
	assert.equal(local.status, 1);
	assert.match(local.stdout, /typescript\(no-floating-promises\)/u);
	writeFileSync(
		file,
		"import assert from 'node:assert/strict';\nimport * as native from 'node:test';\nconst fake: typeof native = { ...native, test: Object.assign(async () => { await Promise.resolve(); }, native.test) };\nfake.test('ordinary work', () => { assert.equal(1 + 1, 2); });\n",
	);
	const borrowedNamespace = lint(directory, ["typescript(no-floating-promises)"]);
	assert.deepEqual(borrowedNamespace.diagnosticLocations, [
		{ code: "typescript(no-floating-promises)", filename: "identity.test.ts", line: 4 },
	]);
	writeFileSync(
		path.join(directory, "other.ts"),
		"export async function test(): Promise<number> { return 1; }\n",
	);
	writeFileSync(file, "import { test } from './other.js';\ntest();\n");
	const other = lint(directory, ["typescript(no-floating-promises)"]);
	assert.equal(other.status, 1);
	assert.match(other.stdout, /typescript\(no-floating-promises\)/u);
	const config = readFileSync(path.join(directory, ".oxlintrc.json"), "utf8");
	writeFileSync(
		path.join(directory, ".oxlintrc.json"),
		config.replace('"package": "node:test"', '"package": "unrelated-test-runner"'),
	);
	writeFileSync(
		file,
		"import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('actual declaration', () => { assert.equal(1 + 1, 2); });\n",
	);
	const wrongPackage = lint(directory, ["typescript(no-floating-promises)"]);
	assert.equal(wrongPackage.status, 1);
	assert.match(wrongPackage.stdout, /typescript\(no-floating-promises\)/u);
});

test("real Node subtests and bound aliases cannot escape complete promise-ownership enforcement", (t) => {
	const directory = fixture(t);
	const file = path.join(directory, "subtests.test.ts");
	const imports = "import assert from 'node:assert/strict';\nimport test from 'node:test';\n";
	writeFileSync(
		file,
		`${imports}test('parent', async (t) => { assert.equal(1 + 1, 2); t.test('child', () => { assert.equal(1 + 1, 2); }); });\n`,
	);
	const direct = lint(directory, [
		"node-test(no-unawaited-subtest)",
		"typescript(no-floating-promises)",
	]);
	assert.equal(direct.status, 1);
	writeFileSync(
		file,
		`${imports}test('parent', async (t) => { assert.equal(1 + 1, 2); const child = t.test.bind(t); child('child', () => { assert.equal(1 + 1, 2); }); });\n`,
	);
	const alias = lint(directory, ["typescript(no-floating-promises)"]);
	assert.equal(alias.diagnosticCount, 1);
	writeFileSync(
		file,
		`${imports}test('parent', async (t) => { assert.equal(1 + 1, 2); await t.test('direct child', () => { assert.equal(1 + 1, 2); }); const child = t.test.bind(t); await child('bound child', () => { assert.equal(1 + 1, 2); }); });\n`,
	);
	assert.equal(lint(directory).status, 0);
	for (const body of [
		"declare function wrap(body: () => Promise<void>): () => Promise<void>;\ntest('parent', wrap(async () => { assert.equal(1 + 1, 2); test('child', () => { assert.equal(1 + 1, 2); }); }));",
		"const holder = { body: () => { assert.equal(1 + 1, 2); test('child', () => { assert.equal(1 + 1, 2); }); } };\ntest('parent', holder.body);",
		"function helper(): void { test('child', () => { assert.equal(1 + 1, 2); }); }\ntest('parent', () => { assert.equal(1 + 1, 2); helper(); });",
	]) {
		writeFileSync(file, `${imports}${body}\n`);
		const indirect = lint(directory, ["typescript(no-floating-promises)"]);
		// oxlint-disable-next-line node-test/no-conditional-assertion -- Every indirect registration variant must independently expose one ownership failure.
		assert.equal(indirect.diagnosticCount, 1);
	}
	writeFileSync(
		file,
		`${imports.replace("import test from 'node:test';", "import test, { describe } from 'node:test';")}\nfunction defineCases(): void { test('child', () => { assert.equal(1 + 1, 2); }); }\ndescribe('suite', defineCases);\n`,
	);
	assert.equal(lint(directory).status, 0);
	writeFileSync(
		file,
		`${imports.replace("import test from 'node:test';", "import test, { describe } from 'node:test';")}
function defineCases(): void {
	test('child', () => { assert.equal(1 + 1, 2); });
}
describe('suite', defineCases);
test('parent', () => { assert.equal(1 + 1, 2); defineCases(); });
`,
	);
	const reusedSuite = lint(directory, ["typescript(no-floating-promises)"]);
	assert.deepEqual(reusedSuite.diagnosticLocations, [
		{ code: "typescript(no-floating-promises)", filename: "subtests.test.ts", line: 5 },
	]);
	writeFileSync(
		file,
		`${imports.replace("import test from 'node:test';", "import test, { describe } from 'node:test';")}
const defineCases = function named(): void { test('child', () => { assert.equal(1 + 1, 2); }); };
describe('suite', defineCases);
`,
	);
	assert.equal(lint(directory).status, 0);
	writeFileSync(
		file,
		`${imports.replace("import test from 'node:test';", "import test, { describe } from 'node:test';")}
const defineCases = function named(): void {
	test('child', () => { assert.equal(1 + 1, 2); });
	test('parent', () => { assert.equal(1 + 1, 2); if (Date.now() < 0) { named(); } });
};
describe('suite', defineCases);
`,
	);
	const namedReuse = lint(directory, ["typescript(no-floating-promises)"]);
	assert.deepEqual(namedReuse.diagnosticLocations, [
		{ code: "typescript(no-floating-promises)", filename: "subtests.test.ts", line: 5 },
		{ code: "typescript(no-floating-promises)", filename: "subtests.test.ts", line: 6 },
	]);
	writeFileSync(path.join(directory, "package.json"), '{"type":"module"}\n');
	writeFileSync(
		path.join(directory, "suite.ts"),
		`${imports.replace("import test from 'node:test';", "import test, { describe } from 'node:test';")}
export function defineCases(): void {
	test('child', () => { assert.equal(1 + 1, 2); });
}
describe('suite', defineCases);
`,
	);
	writeFileSync(file, `${imports}test('unrelated', () => { assert.equal(1 + 1, 2); });\n`);
	assert.equal(lint(directory).status, 0);
	mkdirSync(path.join(directory, "foreign"));
	writeFileSync(path.join(directory, "unrelated.ts"), "export const value = 1;\n");
	writeFileSync(path.join(directory, "foreign", "anchor.ts"), "export const anchor = 'foreign';\n");
	writeFileSync(
		path.join(directory, "foreign", "unrelated.ts"),
		"export { defineCases } from '../suite.js';\nexport const source = 'foreign';\n",
	);
	for (const consumer of [
		"import * as suite from './suite.js';\nconst { defineCases } = suite;\ntest('parent', () => { assert.equal(1 + 1, 2); defineCases(); });",
		"test('parent', async () => { assert.equal(1 + 1, 2); const { defineCases } = await import('./suite.js'); defineCases(); });",
		"test('parent', async () => { assert.equal(1 + 1, 2); const suite = await import('./suite.js'); suite['defineCases'](); });",
		"test('parent', async () => { assert.equal(1 + 1, 2); await import('./suite.js').then(({ defineCases }) => { defineCases(); }); });",
		"test('parent', async () => { assert.equal(1 + 1, 2); const [{ defineCases }] = await Promise.all([import('./suite.js'), import('node:path')]); defineCases(); });",
		"test('parent', async () => { assert.equal(1 + 1, 2); const { mod: { defineCases } } = { mod: await import('./suite.js') }; defineCases(); });",
		"import { createRequire } from 'node:module';\ninterface SuiteModule { readonly defineCases: () => void; }\nconst load: (id: string) => SuiteModule = createRequire(import.meta.url);\ntest('parent', () => { assert.equal(1 + 1, 2); load('./suite.ts').defineCases(); });",
		"import { source } from './foreign/unrelated.js';\nimport { createRequire } from 'node:module';\ninterface SuiteModule { readonly defineCases: () => void; }\nconst load: (id: string) => SuiteModule = createRequire(new URL('./foreign/anchor.ts', import.meta.url));\ntest('parent', () => { assert.equal(source, 'foreign'); load('./unrelated.ts').defineCases(); });",
		"import { createRequire } from 'node:module';\ninterface SuiteModule { readonly defineCases: () => void; }\nconst load: (id: string) => SuiteModule = createRequire(import.meta.url);\ntest('parent', () => { assert.equal(1 + 1, 2); load['call'](globalThis, './suite.ts').defineCases(); });",
		"import { createRequire } from 'node:module';\ninterface SuiteModule { readonly defineCases: () => void; }\nconst load: (id: string) => SuiteModule = createRequire(import.meta.url);\ntest('parent', () => { assert.equal(1 + 1, 2); load['apply'](globalThis, ['./suite.ts']).defineCases(); });",
		"import { createRequire } from 'node:module';\ninterface SuiteModule { readonly defineCases: () => void; }\nconst load: (id: string) => SuiteModule = createRequire(import.meta.url);\ntest('parent', () => { assert.equal(1 + 1, 2); load.call(globalThis, './suite.ts').defineCases(); });",
		"import { createRequire } from 'node:module';\ninterface SuiteModule { readonly defineCases: () => void; }\nconst load: (id: string) => SuiteModule = createRequire(import.meta.url);\ntest('parent', () => { assert.equal(1 + 1, 2); load.apply(globalThis, ['./suite.ts']).defineCases(); });",
		"import vm from 'node:vm';\ntest('parent', () => { assert.equal(1 + 1, 2); vm.runInThisContext(\"process.getBuiltinModule('node:module').createRequire(\" + JSON.stringify(import.meta.url) + \")('./suite.ts').defineCases()\"); });",
		"import vm from 'node:vm';\ntest('parent', () => { assert.equal(1 + 1, 2); vm['runInThisContext'](\"process.getBuiltinModule('node:module').createRequire(\" + JSON.stringify(import.meta.url) + \")('./suite.ts').defineCases()\"); });",
		"import vm from 'node:vm';\nconst { runInThisContext } = vm;\ntest('parent', () => { assert.equal(1 + 1, 2); runInThisContext(\"process.getBuiltinModule('node:module').createRequire(\" + JSON.stringify(import.meta.url) + \")('./suite.ts').defineCases()\"); });",
		"const { runInThisContext } = process.getBuiltinModule('node:vm');\ntest('parent', () => { assert.equal(1 + 1, 2); runInThisContext(\"process.getBuiltinModule('node:module').createRequire(\" + JSON.stringify(import.meta.url) + \")('./suite.ts').defineCases()\"); });",
		"import vm from 'node:vm';\nconst { native: { runInThisContext } } = { native: vm };\ntest('parent', () => { assert.equal(1 + 1, 2); runInThisContext(\"process.getBuiltinModule('node:module').createRequire(\" + JSON.stringify(import.meta.url) + \")('./suite.ts').defineCases()\"); });",
		"import vm from 'node:vm';\ntest('parent', () => { assert.equal(1 + 1, 2); for (const { runInThisContext } of [vm]) { runInThisContext(\"process.getBuiltinModule('node:module').createRequire(\" + JSON.stringify(import.meta.url) + \")('./suite.ts').defineCases()\"); } });",
		"import vm from 'node:vm';\ntest('parent', () => { assert.equal(1 + 1, 2); [vm].forEach(({ runInThisContext }) => { runInThisContext(\"process.getBuiltinModule('node:module').createRequire(\" + JSON.stringify(import.meta.url) + \")('./suite.ts').defineCases()\"); }); });",
	]) {
		writeFileSync(file, `${imports}${consumer}\n`);
		const importedReuse = lint(directory, ["typescript(no-floating-promises)"]);
		// oxlint-disable-next-line node-test/no-conditional-assertion -- Each module-reference form must expose the exact unowned registration in the exported suite.
		assert.deepEqual(importedReuse.diagnosticLocations, [
			{ code: "typescript(no-floating-promises)", filename: "suite.ts", line: 5 },
		]);
	}
	writeFileSync(
		path.join(directory, "package.json"),
		'{"name":"owned-suite","type":"module","exports":{"types":"./types.d.ts","require":"./runtime.mjs","default":"./runtime.mjs"}}\n',
	);
	writeFileSync(path.join(directory, "types.d.ts"), "export declare const marker: string;\n");
	writeFileSync(
		path.join(directory, "runtime.mjs"),
		"export const marker = 'owned';\nexport { defineCases } from './suite.ts';\n",
	);
	writeFileSync(
		file,
		`${imports}import { createRequire } from 'node:module';
import { marker } from 'owned-suite';
interface SuiteModule { readonly defineCases: () => void; }
const load: (id: string) => SuiteModule = createRequire(import.meta.url);
test('parent', () => { assert.equal(marker, 'owned'); load('owned-suite').defineCases(); });
`,
	);
	const declarationOnlyTarget = lint(directory, ["typescript(no-floating-promises)"]);
	assert.deepEqual(declarationOnlyTarget.diagnosticLocations, [
		{ code: "typescript(no-floating-promises)", filename: "suite.ts", line: 5 },
	]);
	writeFileSync(
		path.join(directory, "package.json"),
		'{"name":"owned-suite","type":"module","exports":{"types":"./innocent.ts","require":"./runtime.mjs","default":"./runtime.mjs"}}\n',
	);
	writeFileSync(path.join(directory, "innocent.ts"), "export const marker = 'owned';\n");
	const sourceTypesTarget = lint(directory, ["typescript(no-floating-promises)"]);
	assert.deepEqual(sourceTypesTarget.diagnosticLocations, [
		{ code: "typescript(no-floating-promises)", filename: "suite.ts", line: 5 },
	]);
	writeFileSync(path.join(directory, "innocent.js"), "export { defineCases } from './suite.ts';\n");
	writeFileSync(
		file,
		`${imports}import { createRequire } from 'node:module';
interface SuiteModule { readonly defineCases: () => void; }
const load: (id: string) => SuiteModule = createRequire(import.meta.url);
test('parent', () => { assert.equal(1 + 1, 2); load('./innocent.js').defineCases(); });
`,
	);
	const substitutedRuntimeTarget = lint(directory, ["typescript(no-floating-promises)"]);
	assert.deepEqual(substitutedRuntimeTarget.diagnosticLocations, [
		{ code: "typescript(no-floating-promises)", filename: "suite.ts", line: 5 },
	]);
});

test("readonly allowances retain origin and mutable-addition isolation", (t) => {
	const directory = fixture(t);
	const file = path.join(directory, "readonly.ts");
	writeFileSync(file, "export function accept(value: URL): URL { return value; }\n");
	assert.equal(lint(directory).status, 0);
	writeFileSync(
		file,
		"interface URL { mutable: string; }\nexport function accept(value: URL): URL { return value; }\n",
	);
	const local = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(local.status, 1);
	assert.match(local.stdout, /typescript\(prefer-readonly-parameter-types\)/u);
	writeFileSync(
		file,
		"export function accept(value: URL & { mutable: string }): URL { return value; }\n",
	);
	const intersection = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(intersection.status, 1);
	assert.match(intersection.stdout, /typescript\(prefer-readonly-parameter-types\)/u);
	writeFileSync(
		file,
		"export function accept(value: ReadonlyMap<string, number>): ReadonlyMap<string, number> { return value; }\n",
	);
	assert.equal(lint(directory).status, 0);
	writeFileSync(
		file,
		"export function accept(value: ReadonlyMap<string, { mutable: number }>): unknown { return value; }\n",
	);
	assert.equal(lint(directory, ["typescript(prefer-readonly-parameter-types)"]).status, 1);
	writeFileSync(
		file,
		"export function accept(value: Map<string, number>): unknown { return value; }\n",
	);
	assert.equal(lint(directory, ["typescript(prefer-readonly-parameter-types)"]).status, 1);
	writeFileSync(
		file,
		"export function accept(value: ReadonlySet<string>): ReadonlySet<string> { return value; }\n",
	);
	assert.equal(lint(directory).status, 0);
	writeFileSync(
		file,
		"export function accept(value: ReadonlySet<{ mutable: string }>): unknown { return value; }\n",
	);
	assert.equal(lint(directory, ["typescript(prefer-readonly-parameter-types)"]).status, 1);
	writeFileSync(file, "export function accept(value: Set<string>): unknown { return value; }\n");
	assert.equal(lint(directory, ["typescript(prefer-readonly-parameter-types)"]).status, 1);
	writeFileSync(
		file,
		`declare global {
	interface ReadonlyMap<K, V> { counter: number; readonly probe?: (key: K, value: V) => readonly [K, V]; }
	interface ReadonlySet<T> { counter: number; readonly probe?: (first: T, second: T) => T; }
}
export function acceptMap(value: ReadonlyMap<string, number>): unknown { return value; }
export function acceptSet(value: ReadonlySet<string>): unknown { return value; }
`,
	);
	const augmented = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(augmented.diagnosticCount, 2);
});

test("readonly branded primitive inputs remain readonly without exempting mutable brands", (t) => {
	const directory = fixture(t);
	const file = path.join(directory, "brand.ts");
	writeFileSync(
		file,
		`declare const generation: unique symbol;
type Token = number & { readonly [generation]: true };
export function accept(value: Readonly<{ update: Token }>): unknown { return value; }
`,
	);
	assert.equal(lint(directory).status, 0);
	writeFileSync(
		file,
		`declare const generation: unique symbol;
type Token = number & { [generation]: { mutable: string } };
export function accept(value: Readonly<{ update: Token }>): unknown { return value; }
`,
	);
	assert.equal(lint(directory, ["typescript(prefer-readonly-parameter-types)"]).status, 1);
});

test("every configured native readonly name passes actual declarations and rejects local/file/package impostors", (t) => {
	const directory = fixture(t);
	const cases = nativeCases();
	assert.ok(cases.length > 0);
	const file = path.join(directory, "native.test.ts");
	const factory = nativeCase("package", "@earendil-works/pi-coding-agent", "ExtensionFactory");
	const imports = [...new Set([...cases.map((item) => item.source), factory.source])].join("\n");
	const positive = `${imports}\n${cases.map((item, index) => `export function accept${index}(value: ${item.type}): ${item.type} { return value; }`).join("\n")}\nexport function acceptFactory(value: ${factory.type}): ${factory.type} { return value; }\n`;
	writeFileSync(file, positive);
	assert.equal(lint(directory).status, 0);
	writeFileSync(
		file,
		cases
			.map(
				(item, index) =>
					`export function local${index}(): unknown { interface ${item.name} { mutable: string; } function accept(value: ${item.name}): ${item.name} { return value; } return accept; }`,
			)
			.join("\n"),
	);
	const local = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(local.diagnosticCount, cases.length);
	const declarations = [
		...new Set(cases.map((item) => `export interface ${item.name} { mutable: string; }`)),
	].join("\n");
	writeFileSync(path.join(directory, "other.ts"), declarations);
	writeFileSync(
		file,
		`import type * as Other from './other.js';\n${cases.map((item, index) => `export function accept${index}(value: Other.${item.name}): Other.${item.name} { return value; }`).join("\n")}`,
	);
	const otherFile = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(otherFile.diagnosticCount, cases.length);
	writeFileSync(
		path.join(directory, "package.json"),
		'{"name":"impostor","type":"module","exports":"./other.ts"}\n',
	);
	writeFileSync(
		file,
		`import type * as Other from 'impostor';\n${cases.map((item, index) => `export function accept${index}(value: Other.${item.name}): Other.${item.name} { return value; }`).join("\n")}`,
	);
	const otherPackage = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(otherPackage.diagnosticCount, cases.length);
	writeFileSync(
		file,
		`${imports}\n${cases.map((item, index) => `export function accept${index}(value: ${item.type} & { mutable: string }): unknown { return value; }`).join("\n")}\n`,
	);
	const intersections = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(intersections.diagnosticCount, cases.length);
	const config = readFileSync(path.join(directory, ".oxlintrc.json"), "utf8");
	writeFileSync(
		path.join(directory, ".oxlintrc.json"),
		config
			.replaceAll(/"package":\s*"[^"]+"/gu, '"package": "impostor"')
			.replaceAll(/"from":\s*"lib"/gu, '"from": "package", "package": "impostor"'),
	);
	writeFileSync(file, positive);
	const wrongOrigins = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(wrongOrigins.diagnosticCount, cases.length);
});

test("TS and checked-JS array aliases retain exact declaration identity without wrapper types", (t) => {
	const directory = fixture(t);
	const tsFile = path.join(directory, "test/helpers/agent-browser-harness.ts");
	const jsFile = path.join(directory, "extensions/agent-browser/lib/config-validation.js");
	mkdirSync(path.dirname(tsFile), { recursive: true });
	mkdirSync(path.dirname(jsFile), { recursive: true });
	writeFileSync(
		tsFile,
		"export type FixtureBranch = unknown[];\nexport function accept(value: FixtureBranch): FixtureBranch { return value; }\n",
	);
	writeFileSync(
		jsFile,
		"// @ts-check\n/** @typedef {string[]} ConfigDiagnostics */\n/** @param {ConfigDiagnostics} value @returns {ConfigDiagnostics} */\nexport function accept(value) { return value; }\n",
	);
	writeFileSync(
		path.join(directory, "tsconfig.json"),
		readFileSync(path.join(directory, "tsconfig.json"), "utf8").replace(
			'"include":["*.ts","*.js","test/**/*.ts"]',
			'"include":["*.ts","*.js","test/**/*.ts","extensions/**/*.js"]',
		),
	);
	assert.equal(run(directory, "scripts/code-quality.mjs", ["scope", "--write"]).status, 0);
	assert.equal(lint(directory).status, 0);
	writeFileSync(
		path.join(path.dirname(tsFile), "wrong-harness.ts"),
		"export type FixtureBranch = unknown[];\n",
	);
	writeFileSync(
		path.join(path.dirname(jsFile), "wrong-validation.js"),
		"// @ts-check\n/** @typedef {string[]} ConfigDiagnostics */\nexport const value = 1;\n",
	);
	const config = readFileSync(path.join(directory, ".oxlintrc.json"), "utf8");
	writeFileSync(
		path.join(directory, ".oxlintrc.json"),
		config
			.replaceAll('"./test/helpers/agent-browser-harness.ts"', '"./test/helpers/wrong-harness.ts"')
			.replaceAll(
				'"./extensions/agent-browser/lib/config-validation.js"',
				'"./extensions/agent-browser/lib/wrong-validation.js"',
			),
	);
	const wrongPaths = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(wrongPaths.diagnosticCount, 2);
});

test("owned Map and Set aliases retain exact origin through readonly transfer records", (t) => {
	const directory = fixture(t);
	const base = "extensions/agent-browser/lib/orchestration/electron-host";
	mkdirSync(path.join(directory, base), { recursive: true });
	writeFileSync(
		path.join(directory, "tsconfig.json"),
		readFileSync(path.join(directory, "tsconfig.json"), "utf8").replace(
			'"include":["*.ts","*.js","test/**/*.ts"]',
			'"include":["*.ts","*.js","test/**/*.ts","extensions/**/*.ts"]',
		),
	);
	const declarations = `export type ElectronHostLaunchRecords = Map<string, { readonly label: string }>;
export type ElectronHostChildProcesses = Map<string, { readonly pid: number }>;
`;
	writeFileSync(path.join(directory, base, "contracts.ts"), declarations);
	writeFileSync(path.join(directory, base, "wrong-contracts.ts"), declarations);
	writeFileSync(
		path.join(directory, base, "cleanup.ts"),
		`import type { ElectronHostLaunchRecords, ElectronHostChildProcesses } from "./contracts.js";
export function accept(value: Readonly<{ launches: ElectronHostLaunchRecords; children: ElectronHostChildProcesses }>): unknown { return value; }
`,
	);
	const runtime = "extensions/agent-browser/lib/orchestration/extension-resource-contracts.ts";
	writeFileSync(
		path.join(directory, runtime),
		"export type ValidatedUpstreamPaths = Set<string>;\n",
	);
	writeFileSync(
		path.join(directory, runtime.replace(".ts", "-wrong.ts")),
		"export type ValidatedUpstreamPaths = Set<string>;\n",
	);
	const version = path.join(
		directory,
		"extensions/agent-browser/lib/orchestration/extension-version-check.ts",
	);
	writeFileSync(
		version,
		'import type { ValidatedUpstreamPaths } from "./extension-resource-contracts.js";\nexport function accept(value: Readonly<{ paths: ValidatedUpstreamPaths }>): unknown { return value; }\n',
	);
	assert.equal(run(directory, "scripts/code-quality.mjs", ["scope", "--write"]).status, 0);
	assert.equal(lint(directory).status, 0);
	const config = readFileSync(path.join(directory, ".oxlintrc.json"), "utf8");
	writeFileSync(
		path.join(directory, ".oxlintrc.json"),
		config
			.replaceAll(`./${base}/contracts.ts`, `./${base}/wrong-contracts.ts`)
			.replaceAll(`./${runtime}`, `./${runtime.replace(".ts", "-wrong.ts")}`),
	);
	const wrongOrigin = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(wrongOrigin.diagnosticCount, 2);
	writeFileSync(path.join(directory, ".oxlintrc.json"), config);
	writeFileSync(
		path.join(directory, base, "cleanup.ts"),
		"export function accept(value: Map<string, { readonly label: string }>): unknown { return value; }\n",
	);
	writeFileSync(version, "export function accept(value: Set<string>): unknown { return value; }\n");
	const ordinaryContainers = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(ordinaryContainers.diagnosticCount, 2);
});

test("local owner qualifiers isolate declaration paths, shadows and mutable additions", (t) => {
	const directory = fixture(t);
	const base = "extensions/agent-browser/lib";
	const cases = [
		["LegacyProjectionState", "browser-legacy-types.ts", "browser-legacy-projection.ts"],
		[
			"ManagedSessionRestoreState",
			"managed-session-restore-state.ts",
			"managed-session-restore-policy.ts",
		],
		["BrowserBranch", "browser-journal-branch.ts", "browser-journal.ts"],
		[
			"SessionPageState",
			"session-page-state.ts",
			"orchestration/browser-run/final-result-recovery.ts",
		],
		[
			"BrowserRunState",
			"orchestration/browser-run/types.ts",
			"orchestration/browser-run/native-helper-observation.ts",
		],
		[
			"ClickDispatchProbe",
			"orchestration/browser-run/observation-types.ts",
			"orchestration/browser-run/click-dispatch.ts",
		],
		[
			"ToolPresentation",
			"results/contracts.ts",
			"orchestration/browser-run/process-output-presentation.ts",
		],
		[
			"BrowserPrompt",
			"orchestration/extension-prompt.ts",
			"orchestration/extension-tool-boundary.ts",
		],
		["BrowserArtifacts", "orchestration/extension-artifacts.ts", "orchestration/extension-code.ts"],
		[
			"BrowserRecordingRegistry",
			"orchestration/extension-recording.ts",
			"orchestration/extension-command-run.ts",
		],
		[
			"BrowserElectronResources",
			"orchestration/extension-electron-ownership.ts",
			"orchestration/extension-host-run.ts",
		],
		[
			"BrowserManagedSessions",
			"orchestration/extension-runtime.ts",
			"orchestration/extension-command-admission.ts",
		],
		[
			"BrowserSessionResources",
			"orchestration/extension-runtime.ts",
			"orchestration/extension-command-result.ts",
		],
		[
			"BrowserBranchState",
			"orchestration/extension-runtime.ts",
			"orchestration/extension-branch-restore.ts",
		],
		[
			"BrowserCodeActivity",
			"orchestration/extension-runtime.ts",
			"orchestration/extension-lifecycle.ts",
		],
		[
			"AsyncExecutionQueue",
			"orchestration/execution-queue.ts",
			"orchestration/extension-command-output.ts",
		],
		[
			"KeyedAsyncExecutionQueue",
			"orchestration/execution-queue.ts",
			"orchestration/extension-execution-queue.ts",
		],
	] as const;
	writeFileSync(
		path.join(directory, "tsconfig.json"),
		readFileSync(path.join(directory, "tsconfig.json"), "utf8").replace(
			'"include":["*.ts","*.js","test/**/*.ts"]',
			'"include":["*.ts","*.js","test/**/*.ts","extensions/**/*.ts"]',
		),
	);
	for (const [name, declaration, consumer] of cases) {
		const declarationFile = path.join(directory, base, declaration);
		const consumerFile = path.join(directory, base, consumer);
		mkdirSync(path.dirname(declarationFile), { recursive: true });
		mkdirSync(path.dirname(consumerFile), { recursive: true });
		writeFileSync(declarationFile, `export interface ${name} { mutable: string; }\n`, {
			flag: "a",
		});
		writeFileSync(
			declarationFile.replace(".ts", "-wrong.ts"),
			`export interface ${name} { mutable: string; }\n`,
			{ flag: "a" },
		);
		const relative = path
			.relative(path.dirname(consumerFile), declarationFile)
			.replaceAll("\\", "/");
		const specifier = `${relative.startsWith(".") ? "" : "./"}${relative.replace(/\.ts$/u, ".js")}`;
		writeFileSync(
			consumerFile,
			`import type { ${name} } from ${JSON.stringify(specifier)};\nexport function accept(value: ${name}): unknown { return value; }\n`,
		);
	}
	assert.equal(run(directory, "scripts/code-quality.mjs", ["scope", "--write"]).status, 0);
	assert.equal(lint(directory).status, 0);
	const config = readFileSync(path.join(directory, ".oxlintrc.json"), "utf8");
	let wrongConfig = config;
	for (const [, declaration] of cases) {
		wrongConfig = wrongConfig.replaceAll(
			`./${base}/${declaration}`,
			`./${base}/${declaration.replace(".ts", "-wrong.ts")}`,
		);
	}
	writeFileSync(path.join(directory, ".oxlintrc.json"), wrongConfig);
	const wrongPath = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(wrongPath.diagnosticCount, cases.length);
	writeFileSync(path.join(directory, ".oxlintrc.json"), config);
	for (const [name, , consumer] of cases) {
		writeFileSync(
			path.join(directory, base, consumer),
			`interface ${name} { mutable: string; }\nexport function accept(value: ${name}): unknown { return value; }\n`,
		);
	}
	const shadows = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(shadows.diagnosticCount, cases.length);
	for (const [name, declaration, consumer] of cases) {
		const consumerFile = path.join(directory, base, consumer);
		const relative = path
			.relative(path.dirname(consumerFile), path.join(directory, base, declaration))
			.replaceAll("\\", "/");
		const specifier = `${relative.startsWith(".") ? "" : "./"}${relative.replace(/\.ts$/u, ".js")}`;
		writeFileSync(
			consumerFile,
			`import type { ${name} } from ${JSON.stringify(specifier)};\nexport function accept(value: ${name} & { mutableAddition: string }): unknown { return value; }\n`,
		);
	}
	const additions = lint(directory, ["typescript(prefer-readonly-parameter-types)"]);
	assert.equal(additions.diagnosticCount, cases.length);
	writeFileSync(
		path.join(directory, base, "orchestration/extension-runtime.ts"),
		"export interface BrowserRuntime { mutable: string; }\n",
		{ flag: "a" },
	);
	writeFileSync(
		path.join(directory, base, "orchestration/extension-host-coordination.ts"),
		`import type { BrowserRuntime } from "./extension-runtime.js";
export function accept(runtime: BrowserRuntime): unknown { runtime.mutable = "changed"; return runtime; }
`,
	);
	const rootMutation = lint(directory, [
		"typescript(prefer-readonly-parameter-types)",
		"eslint(no-param-reassign)",
	]);
	assert.equal(rootMutation.diagnosticCount, cases.length + 2);
	assert.deepEqual(
		rootMutation.diagnosticLocations.filter(
			(location) => location.filename === `${base}/orchestration/extension-host-coordination.ts`,
		),
		[
			{
				code: "eslint(no-param-reassign)",
				filename: `${base}/orchestration/extension-host-coordination.ts`,
				line: 2,
			},
			{
				code: "typescript(prefer-readonly-parameter-types)",
				filename: `${base}/orchestration/extension-host-coordination.ts`,
				line: 2,
			},
		],
	);
});

test("native fs rest tuples use their real Node URL and options origins", (t) => {
	const directory = fixture(t);
	writeFileSync(
		path.join(directory, "fs.test.ts"),
		`import type * as fs from "node:fs/promises";
export function rename(...args: Readonly<Parameters<typeof fs.rename>>): unknown { return args; }
export function lstat(...args: Readonly<Parameters<typeof fs.lstat>>): unknown { return args; }
export function readFile(...args: Readonly<Parameters<typeof fs.readFile>>): unknown { return args; }
export function open(...args: Readonly<Parameters<typeof fs.open>>): unknown { return args; }
`,
	);
	assert.equal(lint(directory).status, 0);
});

test("test role does not change language scope and retains branching/parameter limits", (t) => {
	const directory = fixture(t);
	mkdirSync(path.join(directory, "test"));
	writeFileSync(path.join(directory, "test", "scope.test.ts"), "export const value = 1;\n");
	writeFileSync(path.join(directory, "test", "scope.test.mjs"), "export const value = 1;\n");
	assert.equal(run(directory, "scripts/code-quality.mjs", ["scope", "--write"]).status, 0);
	writeFileSync(
		path.join(directory, "test", "scope.test.mjs"),
		"export function parameters(a,b,c,d,e,f,g) { return [a,b,c,d,e,f,g]; }\nPromise.resolve(1);\n",
	);
	writeFileSync(
		path.join(directory, "test", "scope.test.ts"),
		"declare function operation(): Promise<number>;\noperation();\n",
	);
	const result = lint(directory, [
		"eslint(max-params)",
		"typescript(no-floating-promises)",
		"promise(catch-or-return)",
	]);
	assert.equal(result.status, 1);
	assert.match(result.stdout, /eslint\(max-params\)/u);
	assert.match(result.stdout, /scope\.test\.ts/u);
	assert.doesNotMatch(result.stdout, /max-lines|max-statements/u);
});

test("Oxfmt preserves tabs and rejects formatting mutations through the actual CLI", (t) => {
	const directory = fixture(t);
	cpSync(path.join(root, ".oxfmtrc.json"), path.join(directory, ".oxfmtrc.json"));
	const file = path.join(directory, "format.js");
	writeFileSync(file, "export function value(){return 1}\n");
	const executable = path.join(root, "node_modules/oxfmt/bin/oxfmt");
	assert.equal(run(directory, executable, ["--check", "format.js"]).status, 1);
	assert.equal(run(directory, executable, ["--write", "format.js"]).status, 0);
	const once = readFileSync(file, "utf8");
	assert.match(once, /\n\treturn 1;/u);
	assert.equal(run(directory, executable, ["--check", "format.js"]).status, 0);
	assert.equal(run(directory, executable, ["--write", "format.js"]).status, 0);
	assert.equal(readFileSync(file, "utf8"), once);
});
