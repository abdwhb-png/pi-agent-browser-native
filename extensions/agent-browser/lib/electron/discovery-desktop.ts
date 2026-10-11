import { basename } from "node:path";
import type { LinuxDesktopEntry } from "./discovery-types.js";

function unescapeDesktopValue(value: string): string {
	return value
		.replace(/\\s/g, " ")
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t")
		.replace(/\\\\/g, "\\");
}
function parseDesktopFields(text: string): ReadonlyMap<string, string> {
	const fields = new Map<string, string>();
	let inDesktopEntry = false;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) {
			continue;
		}
		if (line.startsWith("[") && line.endsWith("]")) {
			inDesktopEntry = line === "[Desktop Entry]";
			continue;
		}
		const separator = line.indexOf("=");
		if (inDesktopEntry && separator > 0) {
			fields.set(line.slice(0, separator), unescapeDesktopValue(line.slice(separator + 1)));
		}
	}
	return fields;
}
function nonempty(value: string | undefined): string | undefined {
	return value !== undefined && value.length > 0 ? value : undefined;
}
export function parseDesktopFile(text: string, filePath: string): LinuxDesktopEntry | undefined {
	const fields = parseDesktopFields(text);
	if (fields.get("Type") !== "Application") {
		return undefined;
	}
	if (["NoDisplay", "Hidden"].some((key) => fields.get(key)?.trim().toLowerCase() === "true")) {
		return undefined;
	}
	const exec = nonempty(fields.get("Exec")?.trim());
	if (exec === undefined) {
		return undefined;
	}
	const desktopId = basename(filePath, ".desktop");
	return {
		comment: nonempty(fields.get("Comment")),
		desktopId,
		exec,
		filePath,
		icon: nonempty(fields.get("Icon")),
		name: nonempty(fields.get("Name")) ?? desktopId,
	};
}
function stripDesktopExecFieldCodes(exec: string): string {
	const placeholder = "\u0000PERCENT\u0000";
	return exec
		.replaceAll("%%", placeholder)
		.replace(/%[A-Za-z]/g, "")
		.replaceAll(placeholder, "%");
}
class DesktopExecWords {
	private readonly tokens: string[] = [];
	private current = "";
	private quote: '"' | "'" | undefined;
	private escaped = false;

	parse(exec: string): string[] {
		for (const char of stripDesktopExecFieldCodes(exec)) {
			this.accept(char);
		}
		if (this.escaped) {
			this.current += "\\";
		}
		this.flush();
		return this.tokens;
	}
	private flush(): void {
		if (this.current.length > 0) {
			this.tokens.push(this.current);
			this.current = "";
		}
	}
	private accept(char: string): void {
		if (this.escaped) {
			this.current += char;
			this.escaped = false;
			return;
		}
		if (char === "\\") {
			this.escaped = true;
			return;
		}
		if (this.quote !== undefined) {
			if (char === this.quote) {
				this.quote = undefined;
			} else {
				this.current += char;
			}
			return;
		}
		if (char === '"' || char === "'") {
			this.quote = char;
			return;
		}
		if (/\s/.test(char)) {
			this.flush();
			return;
		}
		this.current += char;
	}
}
export function tokenizeDesktopExec(exec: string): string[] {
	return new DesktopExecWords().parse(exec);
}
function envOptionWidth(token: string): number {
	return ["-u", "--unset", "--chdir"].includes(token) ? 2 : 1;
}
export function stripEnvLauncher(tokens: readonly string[]): readonly string[] {
	if (tokens.length === 0 || basename(tokens[0] ?? "") !== "env") {
		return tokens;
	}
	let index = 1;
	while (index < tokens.length) {
		const token = tokens[index] ?? "";
		if (token.startsWith("-")) {
			index += envOptionWidth(token);
			continue;
		}
		if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) {
			index += 1;
			continue;
		}
		break;
	}
	return tokens.slice(index);
}
