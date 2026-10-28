import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { WptHarness } from "./wpt/harness.ts";

function manualDeadlines() {
  const scheduled: { callback: () => void; cancelled: boolean }[] = [];
  const waiting = new Map<number, (deadline: (typeof scheduled)[number]) => void>();
  return {
    scheduled,
    schedule(callback: () => void, milliseconds: number): () => void {
      assert.equal(milliseconds, 10000);
      const deadline = { callback, cancelled: false };
      scheduled.push(deadline);
      waiting.get(scheduled.length - 1)?.(deadline);
      return () => { deadline.cancelled = true; };
    },
    at(index: number): Promise<(typeof scheduled)[number]> {
      const deadline = scheduled[index];
      if (deadline !== undefined) return Promise.resolve(deadline);
      return new Promise((resolve) => { waiting.set(index, resolve); });
    },
  };
}

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
  const deadlines = manualDeadlines();
  const timeout = new WptHarness({}, {}, 10000, {
    deadlineScheduler: deadlines.schedule,
  });
  timeout.run('async_test(() => {}, "never completes");', "timeout.js");
  const completion = timeout.finish();
  // The test deadline is the first scheduled operation. Registration already
  // completed; advancing it explicitly cannot race VM script registration.
  assert.equal(deadlines.scheduled.length, 2);
  (await deadlines.at(0)).callback();
  const results = await completion;
  assert.equal(results[0]?.status, "fail");
  assert.match(String(results[0]?.error), /WPT timed out: never completes/);
  assert.ok(deadlines.scheduled.every((deadline) => deadline.cancelled));
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

// Promise tests and cleanup semantics follow resources/testharness.js at
// 6a2f32237615d7ea9c1eb1e30453066b5555c603, not a fabricated Web platform.
test("WPT promise tests run serially after FIFO cleanup invocation and settlement", async () => {
  const order: string[] = [];
  const harness = new WptHarness({ record: (value: string) => { order.push(value); } });
  harness.run(`
    promise_test(async function(t) {
      assert_equals(this, t);
      record("first");
      t.add_cleanup(async () => {
        record("cleanup start");
        await Promise.resolve();
        record("cleanup settled");
      });
      t.add_cleanup(() => record("second cleanup"));
      await Promise.resolve();
      record("body settled");
    }, "first promise");
    promise_test(() => {
      record("second test");
      return { then(resolve) { resolve(); } };
    }, "thenable");
  `, "promise-order.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass", "pass"]);
  assert.deepEqual(order, [
    "first", "body settled", "cleanup start", "second cleanup", "cleanup settled", "second test",
  ]);
});

test("WPT rejected, throwing, invalid and failed-step promise tests cannot pass or block the queue", async () => {
  const harness = new WptHarness({});
  harness.run(`
    promise_test(() => Promise.reject(undefined), "undefined rejection");
    promise_test(() => { throw new Error("body failure"); }, "throwing body");
    promise_test(() => 1, "not thenable");
    promise_test(t => {
      t.step(() => assert_unreached("step failure"));
      return new Promise(() => {});
    }, "failed step with pending promise");
    promise_test(() => Promise.resolve(), "following promise");
  `, "promise-failures.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status),
    ["fail", "fail", "fail", "fail", "pass"]);
});

test("WPT promise cleanup failures abort later tests and never disappear", async () => {
  for (const [cleanup, expected] of [
    ['() => Promise.reject(new Error("cleanup rejection"))', /cleanup rejection/],
    ['() => 123', /cleanup must return/],
    ['() => new Promise(() => {})', /cleanup timed out/],
  ] as const) {
    let laterCalls = 0;
    const deadlines = manualDeadlines();
    const harness = new WptHarness({ later: () => { laterCalls++; } }, {}, 10000, {
      deadlineScheduler: deadlines.schedule,
    });
    harness.run(`
      promise_test(t => { t.add_cleanup(${cleanup}); return Promise.resolve(); }, "cleanup");
      promise_test(() => { later(); return Promise.resolve(); }, "later");
    `, "promise-cleanup.js");
    const completion = harness.finish();
    const rejected = assert.rejects(completion, (error: unknown) =>
      error instanceof AggregateError && error.errors.some((entry: unknown) => expected.test(String(entry))));
    if (cleanup.includes("new Promise")) (await deadlines.at(2)).callback();
    await rejected;
    assert.equal(laterCalls, 0);
  }
});

test("WPT provider errors retain promise-test ownership across await", async () => {
  const failure = new Error("provider failure after await");
  const harness = new WptHarness({
    report: () => harness.reportError(failure),
  });
  harness.run(`
    promise_test(async () => { await Promise.resolve(); report(); }, "provider error");
    promise_test(() => Promise.resolve(), "following test");
  `, "async-provider-error.js");
  const results = await harness.finish();
  assert.deepEqual(results.map((result) => result.status), ["fail", "pass"]);
  assert.equal(results[0]?.error, failure);

  const unowned = new WptHarness({});
  unowned.reportError(failure);
  await assert.rejects(unowned.finish(), (error: unknown) =>
    error instanceof AggregateError && error.errors.includes(failure));
});

test("WPT explicit_done permits asynchronous registration and setup runs immediately", async () => {
  const order: string[] = [];
  const harness = new WptHarness({ record: (value: string) => { order.push(value); } });
  harness.run(`
    setup(() => { record("setup"); }, { explicit_done: true });
    const registering = Promise.resolve().then(() => {
      promise_test(() => { record("test"); return Promise.resolve(); }, "registered asynchronously");
    });
    promise_test(() => registering.finally(done), "registration promise");
  `, "async-registration.js");
  assert.deepEqual(order, ["setup"]);
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass", "pass"]);
  assert.deepEqual(order, ["setup", "test"]);
});

test("WPT unsupported setup options and missing explicit done fail loudly", async () => {
  for (const options of ['{allow_uncaught_exception: true}', '{unknown_option: false}', '{explicit_done: 1}']) {
    const harness = new WptHarness({});
    harness.run(`setup(${options});`, "unsupported-setup.js");
    await assert.rejects(harness.finish(), AggregateError);
  }
  const deadlines = manualDeadlines();
  const pending = new WptHarness({}, {}, 10000, { deadlineScheduler: deadlines.schedule });
  pending.run('setup({explicit_done:true});', "missing-done.js");
  const completion = pending.finish();
  const rejected = assert.rejects(completion, (error: unknown) =>
    error instanceof AggregateError && error.errors.some((entry: unknown) => /requires a call to done/.test(String(entry))));
  (await deadlines.at(0)).callback();
  await rejected;
});

test("WPT DOM and promise rejection assertions use injected constructors and exact values", async () => {
  const harness = new WptHarness({ DOMException, OtherDOMException: globalThis.DOMException });
  harness.run(`
    test(() => assert_throws_dom("AbortError", () => { throw new DOMException("", "AbortError"); }), "DOM name");
    test(() => assert_throws_dom(20, () => { throw new DOMException("", "AbortError"); }), "DOM code");
    test(() => assert_throws_dom("ABORT_ERR", () => { throw new DOMException("", "AbortError"); }), "DOM alias");
    test(() => assert_throws_dom("AbortError", OtherDOMException, () => { throw new OtherDOMException("", "AbortError"); }), "explicit constructor");
    promise_test(t => promise_rejects_js(t, TypeError, Promise.reject(new TypeError())), "JS rejection");
    promise_test(t => promise_rejects_dom(t, "OperationError", Promise.reject(new DOMException("", "OperationError"))), "DOM rejection");
    promise_test(t => promise_rejects_dom(t, "AbortError", OtherDOMException, Promise.reject(new OtherDOMException("", "AbortError"))), "explicit rejection constructor");
    promise_test(t => promise_rejects_exactly(t, undefined, Promise.reject(undefined)), "exact rejection");
    promise_test(t => promise_rejects_js(t, TypeError, Promise.resolve()), "fulfilled unexpectedly");
    promise_test(t => promise_rejects_js(t, TypeError, Promise.reject(new RangeError())), "wrong JS class");
    promise_test(t => promise_rejects_exactly(t, 0, Promise.reject(-0)), "wrong exact value");
    test(() => assert_throws_dom("AbortError", () => { throw {name:"AbortError", code:20}; }), "forged DOM exception");
    test(() => assert_throws_dom("AbortError", () => { throw new OtherDOMException("", "AbortError"); }), "wrong DOM constructor");
  `, "rejection-assertions.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status),
    ["pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass", "fail", "fail", "fail", "fail", "fail"]);
  const absent = new WptHarness({});
  absent.run('test(() => assert_throws_dom("AbortError", () => {}), "no injected constructor");', "missing-DOMException.js");
  assert.equal((await absent.finish())[0]?.status, "fail");
  const unawaited = new WptHarness({});
  unawaited.run(`
    promise_test(t => {
      promise_rejects_js(t, TypeError, Promise.resolve());
      return Promise.resolve();
    }, "forgotten await");
  `, "unawaited-rejection-assertion.js");
  await assert.rejects(unawaited.finish(), (error: unknown) =>
    error instanceof AggregateError && error.errors.some((entry: unknown) => /expected promise to reject/.test(String(entry))));
});

test("WPT structural object assertions compare enumerable contents across realms", async () => {
  const harness = new WptHarness({ hostValue: { name: "AES-GCM", nested: { length: 128 } } });
  harness.run(`
    test(() => assert_object_equals(hostValue, {name:"AES-GCM", nested:{length:128}}), "matching object");
    test(() => assert_object_equals(hostValue, {name:"AES-GCM", nested:{length:256}}), "nested mismatch");
    test(() => assert_object_equals({a:1}, {a:1,b:2}), "missing property");
    test(() => assert_object_equals({a:1,b:2}, {a:1}), "extra property");
    test(() => assert_object_equals({a:0}, {a:-0}), "signed zero mismatch");
    test(() => { const a = {value:1}; a.self = a; const b = {value:1}; b.self = b; assert_object_equals(a,b); }, "cycles");
  `, "object-assertions.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass", "fail", "fail", "fail", "fail", "pass"]);
});

test("WPT observes rejected promises returned from invalid synchronous callbacks", async () => {
  for (const source of [
    'test(() => Promise.reject(new Error("invalid body promise")), "invalid body");',
    'test(t => { t.add_cleanup(() => Promise.reject(new Error("invalid cleanup promise"))); }, "invalid cleanup");',
  ]) {
    const harness = new WptHarness({});
    harness.run(source, "invalid-rejected-promises.js");
    await assert.rejects(harness.finish(), AggregateError);
  }
});

// Streams' unedited helpers publish through self and schedule asynchronous work
// through global step_timeout. Neither facility claims a Window or Worker realm.
test("WPT exposes self only on request as the fixture's actual global object", async () => {
  const ordinary = new WptHarness({});
  ordinary.run('test(() => assert_equals(typeof self, "undefined"), "no implicit self");', "no-self.js");
  assert.equal((await ordinary.finish())[0]?.status, "pass");

  const harness = new WptHarness({}, {}, 100, { exposeSelf: true });
  harness.run(`
    test(() => {
      assert_equals(self, globalThis);
      self.helperPublishedByDependency = () => 7;
      assert_equals(helperPublishedByDependency(), 7);
      globalThis.sharedBinding = 9;
      assert_equals(self.sharedBinding, 9);
      assert_equals(typeof Window, "undefined");
      assert_equals(typeof document, "undefined");
    }, "same fixture global");
  `, "self-alias.js");
  assert.equal((await harness.finish())[0]?.status, "pass");
  assert.equal(Object.hasOwn(globalThis, "helperPublishedByDependency"), false);
});

test("WPT greater-than assertions require ordered numbers or same-type bigints", async () => {
  const harness = new WptHarness({});
  harness.run(`
    test(() => assert_greater_than(2, 1), "number");
    test(() => assert_greater_than(2n, 1n), "bigint");
    test(() => assert_greater_than(Infinity, 1), "infinity");
    test(() => assert_greater_than(1, 1), "equal");
    test(() => assert_greater_than(0, 1), "less");
    test(() => assert_greater_than(NaN, 1), "NaN");
    test(() => assert_greater_than("2", "1"), "strings");
    test(() => assert_greater_than(new Number(2), 1), "boxed number");
    test(() => assert_greater_than(2, 1n), "mixed numeric types");
  `, "numeric-comparison.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status),
    ["pass", "pass", "pass", "fail", "fail", "fail", "fail", "fail", "fail"]);
});

test("WPT timeout helpers preserve receivers and extra arguments across await", async () => {
  const harness = new WptHarness({}, {}, 100);
  harness.run(`
    async_test(t => {
      const receiver = { step_timeout };
      receiver.step_timeout(function(a, b) {
        assert_equals(this, receiver);
        assert_equals(a, 7);
        assert_equals(b, "second");
        t.done();
      }, 0, 7, "second");
    }, "explicit receiver");
    promise_test(async () => {
      await Promise.resolve();
      await new Promise(resolve => step_timeout(function(value) {
        assert_equals(this, globalThis);
        assert_equals(value, 11);
        resolve();
      }, 0, 11));
    }, "bare global receiver after await");
    async_test(t => {
      t.step_timeout(function(value) {
        assert_equals(this, t);
        assert_equals(value, 13);
        t.done();
      }, undefined, 13);
    }, "test receiver and omitted delay");
  `, "timeout-arguments.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass", "pass", "pass"]);
});

test("WPT global timer exceptions fail their owner or the harness", async () => {
  const failure = new Error("timer callback assertion");
  const harness = new WptHarness({ failure }, {}, 100);
  harness.run(`
    promise_test(async () => {
      await Promise.resolve();
      await new Promise(() => step_timeout(() => { throw failure; }, 0));
    }, "timer owner after await");
    promise_test(() => Promise.resolve(), "following test");
  `, "owned-timer-error.js");
  const results = await harness.finish();
  assert.deepEqual(results.map((result) => result.status), ["fail", "pass"]);
  assert.equal(results[0]?.error, failure);

  const unowned = new WptHarness({ failure }, {}, 100);
  unowned.run(`
    setup({ explicit_done: true });
    step_timeout(() => { done(); throw failure; }, 0);
  `, "unowned-timer-error.js");
  await assert.rejects(unowned.finish(), (error: unknown) =>
    error instanceof AggregateError && error.errors.includes(failure));
});

test("WPT clears abandoned global timers when a fixture finishes", async () => {
  let calls = 0;
  const harness = new WptHarness({ record: () => { calls++; } }, {}, 100);
  harness.run(`
    promise_test(() => {
      step_timeout(record, 10);
      return Promise.resolve();
    }, "abandoned timer");
  `, "timer-cleanup.js");
  assert.equal((await harness.finish())[0]?.status, "pass");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 0);
});
