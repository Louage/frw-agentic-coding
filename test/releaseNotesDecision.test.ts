import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decideReleaseNotesAction,
  isReleaseNotesTrigger,
} from "../src/update/releaseNotesDecision";

test("fresh install asks for the welcome README", () => {
  assert.deepEqual(decideReleaseNotesAction(undefined, "2.4.0", "minor"), {
    kind: "welcome",
  });
  assert.deepEqual(decideReleaseNotesAction(undefined, "2.4.0", "always"), {
    kind: "welcome",
  });
});

test("a patch bump notifies without auto-opening under the default trigger", () => {
  assert.deepEqual(decideReleaseNotesAction("2.4.0", "2.4.1", "minor"), {
    kind: "update",
    auto: false,
  });
});

test("a patch bump auto-opens under the always trigger", () => {
  assert.deepEqual(decideReleaseNotesAction("2.4.0", "2.4.1", "always"), {
    kind: "update",
    auto: true,
  });
});

test("a minor bump auto-opens under the default trigger", () => {
  assert.deepEqual(decideReleaseNotesAction("2.4.1", "2.5.0", "minor"), {
    kind: "update",
    auto: true,
  });
});

test("a major bump auto-opens under the default trigger", () => {
  assert.deepEqual(decideReleaseNotesAction("2.4.1", "3.0.0", "minor"), {
    kind: "update",
    auto: true,
  });
});

test("a major bump that lowers the minor is still a bump", () => {
  assert.deepEqual(decideReleaseNotesAction("2.4.1", "3.0.0", "always"), {
    kind: "update",
    auto: true,
  });
});

test("the never trigger surfaces nothing, not even a fresh install", () => {
  assert.deepEqual(decideReleaseNotesAction(undefined, "2.4.0", "never"), {
    kind: "none",
  });
  assert.deepEqual(decideReleaseNotesAction("2.4.0", "2.4.1", "never"), {
    kind: "none",
  });
  assert.deepEqual(decideReleaseNotesAction("2.4.0", "3.0.0", "never"), {
    kind: "none",
  });
});

test("an identical version surfaces nothing", () => {
  for (const trigger of ["minor", "always"] as const) {
    assert.deepEqual(decideReleaseNotesAction("2.4.0", "2.4.0", trigger), {
      kind: "none",
    });
  }
});

test("a downgrade never surfaces anything", () => {
  for (const trigger of ["minor", "always"] as const) {
    assert.deepEqual(decideReleaseNotesAction("2.5.0", "2.4.0", trigger), {
      kind: "none",
    });
    assert.deepEqual(decideReleaseNotesAction("3.0.0", "2.9.9", trigger), {
      kind: "none",
    });
    assert.deepEqual(decideReleaseNotesAction("2.4.1", "2.4.0", trigger), {
      kind: "none",
    });
  }
});

test("an unparsable version on either side surfaces nothing", () => {
  for (const trigger of ["minor", "always"] as const) {
    assert.deepEqual(decideReleaseNotesAction("not-a-version", "2.4.0", trigger), {
      kind: "none",
    });
    assert.deepEqual(decideReleaseNotesAction("2.4.0", "", trigger), {
      kind: "none",
    });
    assert.deepEqual(decideReleaseNotesAction("2.4", "2.5.0", trigger), {
      kind: "none",
    });
    assert.deepEqual(decideReleaseNotesAction("", "", trigger), { kind: "none" });
  }
});

test("a pre-release suffix is compared on major.minor.patch", () => {
  assert.deepEqual(decideReleaseNotesAction("2.4.0", "2.5.0-rc.1", "minor"), {
    kind: "update",
    auto: true,
  });
});

test("isReleaseNotesTrigger accepts only the three configured values", () => {
  assert.equal(isReleaseNotesTrigger("never"), true);
  assert.equal(isReleaseNotesTrigger("minor"), true);
  assert.equal(isReleaseNotesTrigger("always"), true);
  assert.equal(isReleaseNotesTrigger("Minor"), false);
  assert.equal(isReleaseNotesTrigger(undefined), false);
  assert.equal(isReleaseNotesTrigger(1), false);
});
