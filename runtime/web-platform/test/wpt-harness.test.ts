import assert from "node:assert/strict";
import test from "node:test";
import { WptHarness } from "./wpt/harness.ts";

test("WPT callback assertions cannot disappear inside an exception-catching API", async () => {
  const harness = new WptHarness({
    dispatch(callback: () => void) { try { callback(); } catch { /* deliberately swallowed */ } },
  });
  harness.run(`
    test(t => { dispatch(t.step_func(() => assert_true(false))); }, "callback failure");
    async_test(t => { dispatch(t.unreached_func("unexpected event")); }, "unreached callback");
  `, "callback-controls.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["fail", "fail"]);
});

test("WPT test receivers, unnamed registrations, async completion and FIFO cleanup", async () => {
  const order: string[] = [];
  const harness = new WptHarness({ record: (value: string) => { order.push(value); } });
  harness.run(`
    test(function(t) {
      assert_equals(this, t);
      t.add_cleanup(() => record("first"));
      t.add_cleanup(() => record("second"));
    });
    test(function(t) { assert_equals(this, t); });
    async_test(function(t) {
      t.step_timeout(t.step_func_done(function() { assert_equals(this, t); }), 0);
    }, "async");
    done();
  `, "completion-controls.js");
  const results = await harness.finish();
  assert.deepEqual(results.map((result) => result.status), ["pass", "pass", "pass"]);
  assert.deepEqual(results.map((result) => result.name), ["unnamed test 1", "unnamed test 2", "async"]);
  assert.deepEqual(order, ["first", "second"]);
});

test("WPT assertions preserve signed zero, NaN, thrown values and exact error classes", async () => {
  const harness = new WptHarness({});
  harness.run(`
    test(() => assert_equals(NaN, NaN), "NaN");
    test(() => assert_equals(0, -0), "signed zero");
    test(() => assert_throws_exactly(undefined, () => { throw undefined; }), "undefined throw");
    test(() => assert_throws_js(TypeError, () => { throw new TypeError(); }), "TypeError");
    test(() => assert_throws_js(TypeError, () => { null.missing(); }), "VM TypeError");
    test(() => assert_throws_js(TypeError, () => { throw {name: "TypeError"}; }), "forgery");
    test(() => assert_throws_js(TypeError, () => { class Other extends TypeError {} throw new Other(); }), "subclass");
    test(() => assert_array_equals([,], [undefined]), "array holes");
    test(() => assert_array_equals("", []), "string is not an array-like object");
    test(() => assert_array_equals(function() {}, []), "function is not an array-like object");
    test(() => {
      function Other() {}
      assert_throws_js(Other, () => { throw { constructor: Other, name: "Other" }; });
    }, "non-error constructor");
  `, "assertion-controls.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status),
    ["pass", "fail", "pass", "pass", "pass", "fail", "fail", "fail", "fail", "fail", "fail"]);
});

test("WPT capability blocks are named and stale exclusions fail", async () => {
  const block = { category: "document", reason: "Requires a real Document provider." };
  const harness = new WptHarness({}, { browser: block });
  harness.run('test(() => { throw new Error("must not run"); }, "browser");', "blocked.js");
  assert.deepEqual(await harness.finish(), [{
    name: "browser", status: "blocked", reason: "document: Requires a real Document provider.",
  }]);
  await assert.rejects(new WptHarness({}, { missing: block }).finish(), /stale WPT capability exclusion/);
});

test("WPT reports timeout, top-level errors and cleanup errors as failures", async () => {
  const timeout = new WptHarness({}, {}, 10);
  timeout.run('async_test(() => {}, "never completes");', "timeout.js");
  assert.equal((await timeout.finish())[0]?.status, "fail");
  const topLevel = new WptHarness({});
  topLevel.run('missingCapability();', "top-level.js");
  await assert.rejects(topLevel.finish(), AggregateError);
  const cleanup = new WptHarness({});
  cleanup.run('test(t => t.add_cleanup(() => { throw new Error("cleanup"); }), "cleanup");', "cleanup.js");
  await assert.rejects(cleanup.finish(), AggregateError);
});

test("WPT rejects returned values and promises from synchronous test or cleanup callbacks", async () => {
  for (const source of [
    'test(() => Promise.resolve(), "async function used as test");',
    'async_test(t => { t.done(); return 1; }, "returned value");',
    'test(t => { t.add_cleanup(() => 123); }, "cleanup value");',
    'test(t => { t.add_cleanup(() => Promise.resolve()); }, "cleanup promise");',
  ]) {
    const harness = new WptHarness({});
    harness.run(source, "return-value-controls.js");
    await assert.rejects(harness.finish(), AggregateError);
  }
});

test("WPT steps distinguish an omitted receiver from explicit undefined", async () => {
  const harness = new WptHarness({});
  harness.run(`
    test(t => {
      t.step(function() { assert_equals(this, t); });
      t.step(function() { "use strict"; assert_equals(this, undefined); }, undefined);
      t.step_func(function() { "use strict"; assert_equals(this, undefined); }, undefined)();
    }, "receivers");
    async_test(t => {
      t.step_func_done(function() { "use strict"; assert_equals(this, undefined); }, undefined)();
    }, "done receiver");
  `, "receiver-controls.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass", "pass"]);
});
