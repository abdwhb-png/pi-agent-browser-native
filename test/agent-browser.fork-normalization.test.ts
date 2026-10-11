import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentBrowserInput } from "../extensions/agent-browser/lib/orchestration/input-plan.js";

test("structured role/value action preserves the name correction", () => {
	const input = resolveAgentBrowserInput({
		params: { semanticAction: { action: "click", locator: "role", role: "button", value: "Save" } },
		getBatchPreflightValidationError: () => {
			/* This semantic input contains no batch. */
		},
	});
	assert.equal(input.status, "valid");
	assert.deepEqual(input.toolArgs, ["find", "role", "button", "click", "--name", "Save"]);
});

test("structured text action preserves the target correction", () => {
	const input = resolveAgentBrowserInput({
		params: { semanticAction: { action: "click", text: "Save" } },
		getBatchPreflightValidationError: () => {
			/* This semantic input contains no batch. */
		},
	});
	assert.equal(input.status, "valid");
	assert.deepEqual(input.toolArgs, ["find", "text", "Save", "click"]);
});
