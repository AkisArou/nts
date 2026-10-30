import assert from "node:assert/strict";
import test from "node:test";
import { WptHarness } from "./wpt/harness.ts";

// generate_tests follows resources/testharness.js at
// a8f306ee4399724f33399dfdcac7da296f3cc05a. Controls use explicit completion,
// with no delays, timeout-based assertions, or substitute platform API.
test("WPT generate_tests preserves names, receivers, arguments and sparse rows", async () => {
  const calls: unknown[][] = [];
  const harness = new WptHarness({ record: (...values: unknown[]) => { calls.push(values); } });
  harness.run(`
    const rows = [["first", 2, 3], , ["second", 5]];
    generate_tests(function (...args) {
      assert_equals(typeof this.add_cleanup, "function");
      record(...args);
      this.add_cleanup(() => record("cleanup", args[0]));
      return 123; // The upstream generate_tests wrapper discards this value.
    }, rows, [{}, , {}]);
    assert_array_equals(rows[0], ["first", 2, 3]);
    assert_array_equals(rows[2], ["second", 5]);
  `, "generated-arguments.js");
  const results = await harness.finish();
  assert.deepEqual(results.map(({ name, status }) => [name, status]), [["first", "pass"], ["second", "pass"]]);
  assert.deepEqual(calls, [[2, 3], ["cleanup", 2], [5], ["cleanup", 5]]);
});

test("WPT generate_tests skips inherited numeric rows like the pinned private helper", async () => {
  const harness = new WptHarness({});
  harness.run(`
    class Rows extends Array {
      get 1() { assert_unreached("inherited numeric rows must not be read"); }
    }
    const rows = new Rows(3);
    rows[0] = ["first own row", 1];
    rows[2] = ["last own row", 1];
    generate_tests(value => assert_equals(value, 1), rows);
  `, "generated-inherited-row.js");
  assert.deepEqual((await harness.finish()).map(({ name, status }) => [name, status]),
    [["first own row", "pass"], ["last own row", "pass"]]);
});

test("WPT generate_tests attributes assertion failures without dropping later cases", async () => {
  const harness = new WptHarness({});
  harness.run(`
    generate_tests(value => assert_equals(value, 1), [["fails", 0], ["passes", 1]]);
  `, "generated-failure.js");
  assert.deepEqual((await harness.finish()).map(({ name, status }) => [name, status]),
    [["fails", "fail"], ["passes", "pass"]]);
});

test("WPT generate_tests honors exact capability blocks", async () => {
  const block = { category: "fixture-control", reason: "The blocked callback must not execute." };
  const harness = new WptHarness({}, { blocked: block });
  harness.run(`
    generate_tests(value => assert_true(value), [["blocked", false], ["runs", true]]);
  `, "generated-block.js");
  assert.deepEqual((await harness.finish()).map(({ name, status }) => [name, status]),
    [["blocked", "blocked"], ["runs", "pass"]]);
});

test("WPT generate_tests retains duplicate-name and inventory guards", async () => {
  for (const [rows, options] of [
    ['[["same"], ["same"]]', {}],
    ['[["first"], ["extra"]]', { maxTests: 1 }],
  ] as const) {
    const harness = new WptHarness({}, {}, 10000, options);
    harness.run(`generate_tests(() => {}, ${rows});`, "generated-registration.js");
    await assert.rejects(harness.finish(), AggregateError);
  }
});

test("WPT generate_tests rejects unsupported properties and malformed argument rows", async () => {
  for (const source of [
    'generate_tests(() => {}, [["properties"]], { timeout: 1 });',
    'generate_tests(() => {}, [["properties"]], [{ timeout: 1 }]);',
    'generate_tests(() => {}, ["not an argument row"]);',
    'generate_tests(() => {}, [[23]]);',
    'generate_tests(null, [["not a callback"]]);',
  ]) {
    const harness = new WptHarness({});
    harness.run(source, "generated-unsupported.js");
    await assert.rejects(harness.finish(), AggregateError);
  }
});

test("WPT waits for JSON-driven registrations from an outstanding promise test", async () => {
  const loaded = Promise.withResolvers<unknown[]>();
  const harness = new WptHarness({ load: () => loaded.promise });
  harness.run(`
    promise_test(() => load().then(rows => {
      generate_tests(value => assert_equals(value, 7), rows);
    }), "load data");
  `, "generated-promise.js");
  const completion = harness.finish();
  loaded.resolve([["from loaded data", 7]]);
  const results = await completion;
  assert.deepEqual(results.map(({ name, status }) => [name, status]),
    [["load data", "pass"], ["from loaded data", "pass"]]);
});
