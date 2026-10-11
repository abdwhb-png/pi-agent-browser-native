import { randomBytes } from "node:crypto";
import { createContext, runInContext, Script } from "node:vm";

function parseLimit(value: string | undefined, label: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`Invalid ${label}.`);
	}
	return parsed;
}

const maxMessageBytes = parseLimit(process.argv[2], "script IPC message limit");
const maxCumulativeBytes = parseLimit(process.argv[3], "script IPC cumulative limit");
let cumulativeBytes = 0;
let inputBuffer = Buffer.alloc(0);
let started = false;
const sandbox: Record<string, unknown> = {};
Object.setPrototypeOf(sandbox, null);
const context = createContext(sandbox, {
	codeGeneration: { strings: false, wasm: false },
	name: "agent-browser-script",
});
const bridgeKey = `__piab_send_${randomBytes(16).toString("hex")}`;
const stateName = `__piab_state_${randomBytes(16).toString("hex")}`;
const hostSend = (json: unknown): boolean => {
	if (typeof json !== "string") {
		return false;
	}
	const bytes = Buffer.byteLength(json, "utf8") + 1;
	if (bytes > maxMessageBytes || cumulativeBytes + bytes > maxCumulativeBytes) {
		return false;
	}
	cumulativeBytes += bytes;
	try {
		process.stdout.write(`${json}\n`);
		return true;
	} catch {
		return false;
	}
};
Object.setPrototypeOf(hostSend, null);
Object.freeze(hostSend);
sandbox[bridgeKey] = hostSend;
runInContext(
	"const " +
		stateName +
		" = (() => {\n" +
		"  'use strict';\n" +
		"  const send = globalThis[" +
		JSON.stringify(bridgeKey) +
		"];\n" +
		"  delete globalThis[" +
		JSON.stringify(bridgeKey) +
		"];\n" +
		"  for (const name of ['console','process','require','Buffer','fetch','WebSocket','setTimeout','setInterval','setImmediate','queueMicrotask','clearTimeout','clearInterval','clearImmediate']) Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });\n" +
		"  const NativePromise = Promise;\n" +
		"  const promiseThen = Promise.prototype.then;\n" +
		"  const reflectApply = Reflect.apply;\n" +
		"  const pending = new Map();\n" +
		"  let nextId = 0;\n" +
		"  const encode = (value) => { const json = JSON.stringify(value); if (typeof json !== 'string') throw new TypeError('Value must be JSON-serializable.'); return json; };\n" +
		"  const sendValue = (value) => { const json = encode(value); if (json.length + 1 > " +
		String(maxMessageBytes) +
		" || send(json) !== true) throw new RangeError('Script IPC limit exceeded.'); };\n" +
		"  const browser = function browser(params) {\n" +
		"    return new NativePromise((resolve, reject) => {\n" +
		"      const id = ++nextId;\n" +
		"      pending.set(id, { resolve, reject });\n" +
		"      try { sendValue({ type: 'call', id, params }); } catch (error) { pending.delete(id); reject(error); }\n" +
		"    });\n" +
		"  };\n" +
		"  const emit = function emit(value) { sendValue({ type: 'emit', value }); };\n" +
		"  const emitImage = function emitImage(value) { sendValue({ type: 'image', value }); };\n" +
		"  Object.setPrototypeOf(browser, null);\n" +
		"  Object.setPrototypeOf(emit, null);\n" +
		"  Object.setPrototypeOf(emitImage, null);\n" +
		"  Object.freeze(browser);\n" +
		"  Object.freeze(emit);\n" +
		"  Object.freeze(emitImage);\n" +
		"  Object.defineProperties(globalThis, { browser: { value: browser, writable: false, configurable: false }, emit: { value: emit, writable: false, configurable: false }, emitImage: { value: emitImage, writable: false, configurable: false } });\n" +
		"  const complete = (ok, value) => {\n" +
		"    if (ok) {\n" +
		"      try { sendValue(value === undefined ? { type: 'complete', hasValue: false } : { type: 'complete', hasValue: true, value }); }\n" +
		"      catch { sendValue({ type: 'complete', error: { name: 'RangeError', message: 'Final script value is not serializable or exceeds the IPC limit.' } }); }\n" +
		"      return;\n" +
		"    }\n" +
		"    let name = 'Error'; let message = 'Script execution failed.';\n" +
		"    try { if (value && typeof value.name === 'string') name = value.name.slice(0, 80); } catch {}\n" +
		"    try { if (value && typeof value.message === 'string') message = value.message.replace(/[\\r\\n]+/g, ' ').slice(0, 400); } catch {}\n" +
		"    sendValue({ type: 'complete', error: { name, message } });\n" +
		"  };\n" +
		"  return Object.freeze({\n" +
		"    deliver(json) {\n" +
		"      const message = JSON.parse(json);\n" +
		"      const target = pending.get(message.id);\n" +
		"      if (!target) return;\n" +
		"      pending.delete(message.id);\n" +
		"      target.resolve(message.envelope);\n" +
		"    },\n" +
		"    run(thunk) {\n" +
		"      let promise;\n" +
		"      try { promise = reflectApply(thunk, undefined, []); } catch (error) { complete(false, error); return; }\n" +
		"      reflectApply(promiseThen, promise, [value => complete(true, value), error => complete(false, error)]);\n" +
		"    }\n" +
		"  });\n" +
		"})();",
	context,
	{ timeout: 1_000 },
);
const deliver: unknown = runInContext(`${stateName}.deliver`, context, { timeout: 1_000 });
if (typeof deliver !== "function") {
	throw new Error("Script response bridge was not initialized.");
}

function fail(name: string, message: string): void {
	hostSend(JSON.stringify({ type: "complete", error: { name, message } }));
}

function describeError(error: unknown, fallback: string): { message: string; name: string } {
	if (error === null || typeof error !== "object") {
		return { message: fallback, name: "Error" };
	}
	const message = "message" in error ? error.message : undefined;
	const name = "name" in error ? error.name : undefined;
	return {
		message:
			typeof message === "string" ? message.replace(/[\r\n]+/g, " ").slice(0, 400) : fallback,
		name: typeof name === "string" ? name.slice(0, 80) : "Error",
	};
}

function startScript(message: unknown): void {
	if (
		message === null ||
		typeof message !== "object" ||
		!("type" in message) ||
		message.type !== "start" ||
		!("code" in message) ||
		typeof message.code !== "string"
	) {
		fail("Error", "Invalid script start message.");
		return;
	}
	started = true;
	try {
		const source = `'use strict';\n${stateName}.run(async function () {\n'use strict';\n${message.code}\n});`;
		const script = new Script(source, {
			filename: "agent-browser-script.js",
			importModuleDynamically() {
				process.exit(70);
			},
		});
		script.runInContext(context);
	} catch (error) {
		const described = describeError(error, "Script compilation failed.");
		fail(described.name, described.message);
	}
}

function deliverBrowserResponse(message: unknown, line: string): void {
	if (
		message === null ||
		typeof message !== "object" ||
		!("type" in message) ||
		message.type !== "response"
	) {
		fail("Error", "Invalid parent IPC response.");
		return;
	}
	try {
		if (typeof deliver !== "function") {
			throw new Error("Script response bridge is unavailable.");
		}
		Reflect.apply(deliver, undefined, [line]);
	} catch {
		fail("Error", "Invalid browser response envelope.");
	}
}

function handleLine(line: string): void {
	const bytes = Buffer.byteLength(line, "utf8") + 1;
	if (bytes > maxMessageBytes || cumulativeBytes + bytes > maxCumulativeBytes) {
		fail("RangeError", "Script IPC limit exceeded.");
		return;
	}
	cumulativeBytes += bytes;
	let message: unknown;
	try {
		message = JSON.parse(line);
	} catch {
		fail("Error", "Invalid parent IPC message.");
		return;
	}
	if (!started) {
		startScript(message);
		return;
	}
	deliverBrowserResponse(message, line);
}

process.stdin.on("data", (rawChunk) => {
	const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
	inputBuffer = Buffer.concat([inputBuffer, chunk]);
	if (inputBuffer.length > maxMessageBytes) {
		fail("RangeError", "Script IPC message limit exceeded.");
		process.stdin.pause();
		return;
	}
	for (;;) {
		const newline = inputBuffer.indexOf(10);
		if (newline < 0) {
			break;
		}
		const line = inputBuffer.subarray(0, newline).toString("utf8");
		inputBuffer = inputBuffer.subarray(newline + 1);
		handleLine(line);
	}
});
process.stdin.on("error", () => {
	// Parent transport teardown is handled by the parent's worker lifecycle owner.
});
hostSend(JSON.stringify({ type: "ready" }));
