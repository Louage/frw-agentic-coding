import assert from "node:assert/strict";
import { test } from "node:test";

import { decideOverrideGate } from "../src/agentOverrideActivation";

// V1 — isDevelopmentOrTest true/false -> development-host / proceed.
test("decideOverrideGate blocks under Development/Test mode", () => {
  assert.deepEqual(decideOverrideGate({ isDevelopmentOrTest: true }), {
    proceed: false,
    reason: "development-host",
  });
});

test("decideOverrideGate proceeds outside Development/Test mode", () => {
  assert.deepEqual(decideOverrideGate({ isDevelopmentOrTest: false }), {
    proceed: true,
  });
});
