// Controls for the additive High Resolution Time assertion in the shared adapter.
// WPT resources/testharness.js at 6a2f32237615d7ea9c1eb1e30453066b5555c603.
import assert from "node:assert/strict";
import test from "node:test";
import { WptHarness } from "./wpt/harness.ts";

test("assert_approx_equals follows finite and non-finite WPT comparison rules", async () => {
  const harness = new WptHarness({});
  harness.run(`
    test(() => assert_approx_equals(3, 4, 1), "inclusive bound");
    test(() => assert_approx_equals(-0, 0, 0), "zero difference");
    test(() => assert_approx_equals(3, "4", 1), "expected number conversion");
    test(() => assert_approx_equals(NaN, NaN, 0), "same NaN");
    test(() => assert_approx_equals(Infinity, Infinity, 0), "same infinity");
    test(() => assert_approx_equals(-Infinity, -Infinity, 0), "same negative infinity");
  `, "performance-assertion-positive-control.js");
  const results = await harness.finish();
  assert.equal(results.length, 6);
  assert.deepEqual(results.map((result) => result.status), Array(6).fill("pass"));
});

test("assert_approx_equals records out-of-range and invalid actual values as failures", async () => {
  const harness = new WptHarness({});
  harness.run(`
    test(() => assert_approx_equals(3, 5, 1), "outside bound");
    test(() => assert_approx_equals("3", 3, 0), "actual must be a number");
    test(() => assert_approx_equals(3n, 3, 0), "bigint is not a number");
    test(() => assert_approx_equals(NaN, 3, Infinity), "NaN versus finite");
    test(() => assert_approx_equals(Infinity, -Infinity, 0), "opposite infinities");
    test(() => assert_approx_equals(Infinity, NaN, 0), "infinity versus NaN");
    test(() => assert_approx_equals(3, 3, -1), "negative epsilon");
  `, "performance-assertion-negative-control.js");
  const results = await harness.finish();
  assert.equal(results.length, 7);
  assert.deepEqual(results.map((result) => result.status), Array(7).fill("fail"));
});
