import assert from "node:assert/strict";
import test from "node:test";
import { selectPreferredModel } from "../src/model-selection.js";

const preferenceOrder = ["openai-codex/gpt-6-luna", "xai/grok-4.5"];
const available = [
  { provider: "xai", id: "grok-4.5" },
  { provider: "openai-codex", id: "gpt-6-luna" },
];

test("selects the first available model in the requested preference order", () => {
  assert.deepEqual(selectPreferredModel(preferenceOrder, available), available[1]);
});

test("uses the fallback when the primary model is unavailable", () => {
  assert.deepEqual(selectPreferredModel(preferenceOrder, [available[0]]), available[0]);
});

test("returns no model when none of the requested models are available", () => {
  assert.equal(selectPreferredModel(preferenceOrder, []), undefined);
});
