import type { ImageObservation } from "../../results/contracts.js";
import { getScreenshotPathTokenIndex, getScreenshotPositionalIndices } from "./artifact-paths.js";

export function getScreenshotCapture(command: readonly string[]): {
	readonly kind: ImageObservation["capture"];
	readonly selector?: string;
} {
	if (command[0] !== "screenshot") {
		return { kind: "unknown" };
	}
	if (command.includes("--full") || command.includes("-f")) {
		return { kind: "full-page" };
	}
	const positional = getScreenshotPositionalIndices(command);
	const selectorIndex = positional.find((index) => index !== getScreenshotPathTokenIndex(command));
	return selectorIndex === undefined
		? { kind: "viewport" }
		: { kind: "element", selector: command[selectorIndex] };
}
