// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
// An `Event` built with no Web-platform runtime installed.
//
// Its own file, and that is the point rather than tidiness. The environment slot is
// process-global, so any suite that builds a runtime installs one for everything after
// it — a "no runtime" assertion sharing a file with a runtime test is asserting nothing,
// and it passed for the wrong reason until it was moved here.
//
// The behaviour matters because `AbortController`, `AbortSignal` and `EventTarget` are
// all usable without a platform. Reading the environment unguarded in `Event`'s
// constructor fails 41 tests in this lane, which is how that was established rather than
// reasoned about.
import assert from "node:assert/strict";
import test from "node:test";

import { AbortController, Event } from "../src/index.ts";

test("an event built with no runtime installed is stamped zero, not thrown over", () => {
  const event = new Event("bare");
  assert.equal(event.timeStamp, 0);
  assert.equal(event.type, "bare");
});

test("the abort primitives work with no runtime at all", () => {
  // The reason the guard exists: these construct events internally.
  const controller = new AbortController();
  const reason = new Error("no platform here");
  let seen;
  controller.signal.addEventListener("abort", () => (seen = controller.signal.reason));
  controller.abort(reason);
  assert.equal(seen, reason);
});
