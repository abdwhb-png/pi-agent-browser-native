import { execFileSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import { boundaryOverrides } from "./code-quality-boundaries.mjs";

const excluded = ["node_modules/**", "dist/**", ".artifacts/**", ".crabbox/**", ".cueloop/**"];
const semanticExceptions = new Set([
	"no-await-in-loop",
	"no-control-regex",
	"typescript/no-unnecessary-condition",
	"typescript/prefer-readonly-parameter-types",
]);
const testExceptions = new Set(["node-test/no-conditional-assertion"]);
const exactExceptions = new Map([
	[
		"extensions/agent-browser/lib/config.ts",
		new Set(["typescript/strict-void-return", "eslint/preserve-caught-error"]),
	],
	["extensions/agent-browser/lib/electron/cleanup.ts", new Set(["typescript/strict-void-return"])],
	[
		"extensions/agent-browser/lib/web-search-request.ts",
		new Set(["typescript/prefer-promise-reject-errors"]),
	],
	[
		"extensions/agent-browser/lib/session-page-state.ts",
		new Set(["typescript/no-unsafe-type-assertion"]),
	],
	["test/agent-browser.process-identity.test.ts", new Set(["typescript/strict-void-return"])],
	["test/agent-browser.real-upstream-contract.test.ts", new Set(["typescript/strict-void-return"])],
	["test/verify-package.test.ts", new Set(["typescript/strict-void-return"])],
	["test/prepare.test.ts", new Set(["typescript/strict-void-return"])],
	["test/verify-lifecycle.test.ts", new Set(["typescript/strict-void-return"])],
]);

function toolOutput(name, args, cwd = process.cwd()) {
	const entry = { oxlint: "oxlint/bin/oxlint", tsc: "typescript/lib/tsc.js" }[name];
	if (entry === undefined) {
		throw new Error(`Unsupported policy tool: ${name}`);
	}
	return execFileSync(process.execPath, [path.resolve(cwd, "node_modules", entry), ...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	});
}

function parseSource(file, source) {
	const result = parseSync(file, source);
	if (result.errors.length > 0) {
		throw new Error(`${file}: parser errors: ${JSON.stringify(result.errors)}`);
	}
	return result;
}

function filePragmaName(text) {
	// TS7's skipBlanks/extractName read space/tab and ASCII letters/hyphens only.
	return /^\/?[ \t]*@([a-zA-Z-]+)/u.exec(text)?.[1]?.toLowerCase();
}

function compilerSuppression(text, context, comment) {
	// TS7 scans only the last block-comment line, skipping ASCII blanks and /* prefixes.
	const directive =
		comment.type === "Block"
			? (comment.value.split(/[\r\n\u2028\u2029]/u).at(-1) ?? "").replace(/^[ \t]*[/*]*[ \t]*/u, "")
			: text;
	if (
		/^@ts-ignore/iu.test(directive) ||
		/^@ts-nocheck\b/iu.test(text) ||
		filePragmaName(text) === "ts-nocheck"
	) {
		throw new Error(`${context.location}: compiler escape hatch is forbidden`);
	}
	if (/^@ts-expect-error/iu.test(directive)) {
		const reason = directive.replace(/^@ts-expect-error\s*[:-]?\s*/iu, "").trim();
		if (!context.file.endsWith(".test-d.ts") || reason.length < 10) {
			throw new Error(`${context.location}: expect-error needs a described negative type test`);
		}
		return { ...context, rule: "@ts-expect-error", reason };
	}
	return null;
}

function approvedRule(rule, file) {
	if (semanticExceptions.has(rule)) {
		return true;
	}
	if (exactExceptions.get(file)?.has(rule) === true) {
		return true;
	}
	return (
		testExceptions.has(rule) &&
		(/(?:\.test|\.spec)\.[cm]?[jt]sx?$/u.test(file) || file.startsWith("test/helpers/"))
	);
}

function suppression(comment, context) {
	const text = comment.value.trim().replace(/^[/*]+\s*/u, "");
	if (/^eslint-(?:disable|enable)/u.test(text)) {
		throw new Error(`${context.location}: ESLint directives are not supported`);
	}
	const compiler = compilerSuppression(text, context, comment);
	if (compiler !== null) {
		return compiler;
	}
	if (!/^oxlint-(?:disable|enable)/u.test(text)) {
		return null;
	}
	const match = /^oxlint-disable-next-line\s+([\w/-]+)(?:\s+--\s+(.+))?$/u.exec(text);
	if (match === null) {
		throw new Error(
			`${context.location}: only approved single-rule next-line exceptions are allowed`,
		);
	}
	if (!approvedRule(match[1], context.file)) {
		throw new Error(`${context.location}: rule or scope is not approved for suppression`);
	}
	const reason = match[2] ?? context.previousExplanation;
	if (reason.length < 10) {
		throw new Error(`${context.location}: suppression requires an adjacent specific explanation`);
	}
	return { ...context, rule: match[1], reason };
}

function isCheckingPragma(comment) {
	if (comment.type !== "Line") {
		return false;
	}
	return filePragmaName(comment.value) === "ts-check";
}

function commentExplanation(comment) {
	const text = comment.value.trim().replace(/^[/*]+\s*/u, "");
	return /^(?:@ts-[\w-]+|(?:oxlint|eslint)-(?:disable|enable))\b/iu.test(text) ? "" : text;
}

export function sourcePolicy(file, source) {
	const parsed = parseSource(file, source);
	let leadingEnd = parsed.program.hashbang?.end ?? 0;
	/** @type {{file: string, location: string, rule: string, reason: string}[]} */
	const entries = [];
	let checked = false;
	let previous = null;
	const comments = parsed.comments.filter(
		(comment) => comment.start !== parsed.program.hashbang?.start,
	);
	for (const comment of comments) {
		const line = source.slice(0, comment.start).split("\n").length;
		const previousExplanation =
			previous !== null && /^\s*$/u.test(source.slice(previous.end, comment.start))
				? commentExplanation(previous)
				: "";
		const entry = suppression(comment, {
			file,
			location: `${file}:${line}`,
			previousExplanation,
		});
		if (entry !== null) {
			entries.push(entry);
		}
		if (/^\s*$/u.test(source.slice(leadingEnd, comment.start))) {
			leadingEnd = comment.end;
			if (isCheckingPragma(comment)) {
				checked = true;
			}
		}
		previous = comment;
	}
	return { checked, entries, program: parsed.program };
}

function maintainedFiles(cwd = process.cwd()) {
	return globSync("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", {
		cwd,
		exclude: excluded,
	})
		.map((file) => file.split(path.sep).join("/"))
		.sort();
}

function checkedProjectFiles(cwd) {
	const checked = new Set();
	const roots = new Set();
	const projects = globSync("**/{tsconfig,jsconfig}*.json", { cwd, exclude: excluded }).sort();
	for (const project of projects) {
		const config = JSON.parse(toolOutput("tsc", ["--project", project, "--showConfig"], cwd));
		if (
			config.compilerOptions.strict !== true ||
			config.compilerOptions.noImplicitReturns !== true
		) {
			throw new Error(`${project}: strict and noImplicitReturns must be enabled`);
		}
		for (const file of config.files) {
			roots.add(
				path
					.relative(cwd, path.resolve(cwd, path.dirname(project), file))
					.split(path.sep)
					.join("/"),
			);
		}
		const files = toolOutput("tsc", ["--project", project, "--listFilesOnly"], cwd)
			.trim()
			.split("\n");
		for (const file of files) {
			const relative = path.relative(cwd, file).split(path.sep).join("/");
			if (config.compilerOptions.checkJs === true) {
				checked.add(relative);
			}
		}
	}
	return { checked, roots, projects };
}

function languageScope(cwd = process.cwd()) {
	const project = checkedProjectFiles(cwd);
	const files = maintainedFiles(cwd);
	const unchecked = [];
	const exceptions = [];
	for (const file of files) {
		const policy = sourcePolicy(file, readFileSync(path.resolve(cwd, file), "utf8"));
		exceptions.push(...policy.entries);
		const javascript = /\.(?:[cm]?js|jsx)$/u.test(file);
		const checked = policy.checked || project.checked.has(file);
		if ((!javascript || checked) && !project.roots.has(file)) {
			throw new Error(`${file}: checked source is missing from explicit compiler project inputs`);
		}
		if (javascript && !checked) {
			unchecked.push(file);
		}
	}
	return { files, unchecked, exceptions, projects: project.projects };
}

function uncheckedOverride(files, metadata) {
	const rules = Object.fromEntries(
		metadata
			.filter((rule) => rule.type_aware)
			.map((rule) => [`${rule.scope}/${rule.value}`, "off"]),
	);
	// JS cannot express this TypeScript annotation requirement.
	rules["typescript/explicit-module-boundary-types"] = "off";
	return { files, rules };
}

export function verifyScope(cwd = process.cwd(), write = false) {
	const scope = languageScope(cwd);
	const configPath = path.resolve(cwd, ".oxlintrc.json");
	const config = JSON.parse(readFileSync(configPath, "utf8"));
	const metadata = JSON.parse(toolOutput("oxlint", ["--rules", "--format=json"], cwd));
	const expected = uncheckedOverride(scope.unchecked, metadata);
	const actual = config.overrides.at(-1);
	if (!write && JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error("Unchecked JS scope/metadata drift: run npm run quality:scope -- --write");
	}
	const boundaries = boundaryOverrides(config);
	if (
		!write &&
		JSON.stringify(config.overrides.slice(-boundaries.length - 1, -1)) !==
			JSON.stringify(boundaries)
	) {
		throw new Error("Scoped ownership overrides drift: run npm run quality:scope -- --write");
	}
	const linted = toolOutput("oxlint", ["--debug=files", "."], cwd).trim().split("\n").sort();
	if (JSON.stringify(linted) !== JSON.stringify(scope.files)) {
		throw new Error("Maintained-code inventory differs from root Oxlint coverage");
	}
	return { scope, config, expected, boundaries };
}
