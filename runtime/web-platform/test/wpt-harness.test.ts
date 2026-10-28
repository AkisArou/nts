import assert from "node:assert/strict";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { WptHarness, type WptActivity } from "./wpt/harness.ts";
import { WptHungError, readWptHungResults, reportWptHung } from "./wpt/hung.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createContext } from "node:vm";
import { UpstreamWptExecution } from "../../../tooling/conformance/web-platform/upstream-liveness.ts";

function manualDeadlines() {
  const scheduled: { callback: () => void; cancelled: boolean; activity?: WptActivity }[] = [];
  const waiting = new Map<number, (deadline: (typeof scheduled)[number]) => void>();
  const phases = new Map<string, (deadline: (typeof scheduled)[number]) => void>();
  return {
    scheduled,
    schedule(callback: () => void, milliseconds: number, activity?: WptActivity): () => void {
      assert.equal(milliseconds, 300000);
      const deadline = { callback, cancelled: false, activity };
      scheduled.push(deadline);
      waiting.get(scheduled.length - 1)?.(deadline);
      if (activity) phases.get(activity.phase)?.(deadline);
      return () => { deadline.cancelled = true; };
    },
    at(index: number): Promise<(typeof scheduled)[number]> {
      const deadline = scheduled[index];
      if (deadline !== undefined) return Promise.resolve(deadline);
      return new Promise((resolve) => { waiting.set(index, resolve); });
    },
    phase(phase: string): Promise<(typeof scheduled)[number]> {
      const deadline = scheduled.findLast(entry => entry.activity?.phase === phase);
      if (deadline) return Promise.resolve(deadline);
      return new Promise(resolve => { phases.set(phase, resolve); });
    },
  };
}

test("WPT active work passes the old deadline while idle work has no verdict", async () => {
  let now = 0;
  const tasks: { at: number; callback: () => void; cancelled: boolean }[] = [];
  let current: { step(callback: () => void): unknown; done(): void } | undefined;
  const harness = new WptHarness({ capture(value: typeof current) { current = value; } }, {}, 10000, {
    deadlineScheduler(callback, milliseconds) {
      const task = { at: now + milliseconds, callback, cancelled: false };
      tasks.push(task);
      return () => { task.cancelled = true; };
    },
  });
  const advance = (milliseconds: number): void => {
    now += milliseconds;
    for (const task of [...tasks]) if (!task.cancelled && task.at <= now) task.callback();
  };
  harness.run('async_test(t => capture(t), "active work");', "active.js");
  const completion = harness.finish();
  advance(200000);
  assert.ok(current);
  current.step(() => {});
  advance(200000); // Past both the old 10 s deadline and the first inactivity bound.
  current.done();
  assert.deepEqual((await completion).map(result => result.status), ["pass"]);
  const failed = new WptHarness({});
  failed.run('test(() => assert_true(false), "assertion");', "assertion.js");
  assert.equal((await failed.finish())[0]?.status, "fail");
});

test("WPT VM spins are hung instruments rather than assertion failures", async () => {
  const harness = new WptHarness({}, {}, 20);
  harness.run('while (true) {}', "spinning.js");
  await assert.rejects(harness.finish(), (error: unknown) => error instanceof WptHungError &&
    error.observation.kind === "hung" && /spinning.js: <fixture script>: VM execution/.test(error.message));
});

test("WPT hung transport preserves the typed field and refuses a mutated verdict", t => {
  const directory = mkdtempSync(join(homedir(), ".cache/nts-wpt-hung-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const observations = join(directory, "observations.jsonl"), step = join(directory, "step.json");
  const env = { ...process.env, NTS_WPT_HUNG_RESULTS: observations, NTS_GATE_STEP_RESULT: step,
    NTS_GATE_STEP: "web-platform", NTS_GATE_STEP_ATTEMPT: "control" };
  const error = new WptHungError("fixture.js", "pending cleanup", "cleanup", {
    name: "pending cleanup", status: "fail", error: new TypeError("body failed before cleanup"),
  });
  reportWptHung(error, env, () => {});
  assert.equal(readWptHungResults(observations)[0]?.kind, "hung");
  const body = JSON.parse(readFileSync(observations, "utf8")).testResult;
  assert.equal(body.error.message, "TypeError: body failed before cleanup");
  assert.match(body.error.stack, /TypeError: body failed before cleanup/);
  const command = new URL("./wpt/hung.ts", import.meta.url);
  const run = spawnSync(process.execPath, [command.pathname, observations], { env, encoding: "utf8" });
  assert.equal(run.status, 124, run.stderr);
  assert.equal(JSON.parse(readFileSync(step, "utf8")).verdict, "NOT RUN");
  assert.equal(JSON.parse(readFileSync(step, "utf8")).kind, "hung");
  writeFileSync(observations, JSON.stringify({ ...error.observation, kind: "case-budget", verdict: "FAIL" }) + "\n");
  assert.throws(() => readWptHungResults(observations), /invalid WPT hung observation/);
  assert.equal(spawnSync(process.execPath, [command.pathname, observations], { env }).status, 1);
});

test("legacy async and promise liveness guards never become failed or passed cases", async () => {
  for (const route of ["async", "promise"] as const) {
    const deadlines = manualDeadlines();
    const execution = new UpstreamWptExecution(`${route}.js`, { deadlineScheduler: deadlines.schedule });
    try {
      const idle = new Promise<never>(() => {});
      const completion = route === "async" ? execution.observe(route, idle) : execution.settle(route, idle, []);
      const rejected = assert.rejects(completion, (error: unknown) => error instanceof WptHungError &&
        error.observation.kind === "hung" && error.observation.verdict === "NOT RUN" &&
        error.message.includes(`${route}.js: ${route}: test`) && error.testResult === undefined);
      deadlines.scheduled.at(-1)!.callback();
      await rejected;
    } finally { execution.close(); }
  }
  const failed = new UpstreamWptExecution("reject.js");
  try {
    const failure = new Error("real rejection");
    await assert.rejects(failed.observe("async rejection", Promise.reject(failure)), error => error === failure);
    await assert.rejects(failed.settle("promise rejection", Promise.reject(failure), []), error => error === failure);
  } finally { failed.close(); }
});

test("legacy cleanup hangs retain the test body's independent result", async () => {
  const deadlines = manualDeadlines();
  const execution = new UpstreamWptExecution("legacy-cleanup.js", { deadlineScheduler: deadlines.schedule });
  try {
    const completion = execution.settle("body", Promise.resolve(), [() => new Promise(() => {})]);
    const rejected = assert.rejects(completion, (error: unknown) => error instanceof WptHungError &&
      /legacy-cleanup.js: body: cleanup/.test(error.message) && error.testResult?.status === "pass");
    (await deadlines.phase("cleanup")).callback();
    await rejected;
  } finally { execution.close(); }
});

test("legacy support and fixture VM bounds are hung while real VM errors remain errors", () => {
  for (const file of ["support.js", "fixture.js"]) {
    const execution = new UpstreamWptExecution(file, { vmMilliseconds: 20 });
    try {
      const context = createContext({});
      assert.throws(() => execution.vm("missingCapability()", context, file), (error: unknown) =>
        error instanceof Error ? error.name === "ReferenceError" : typeof error === "object" && error !== null &&
          "name" in error && error.name === "ReferenceError");
      assert.throws(() => execution.vm("while (true) {}", context, file), (error: unknown) =>
        error instanceof WptHungError && error.observation.kind === "hung" && error.message.includes(file));
    } finally { execution.close(); }
  }
});

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

test("WPT idle work is hung while top-level and cleanup assertions fail", async () => {
  const deadlines = manualDeadlines();
  const timeout = new WptHarness({}, {}, 10000, {
    deadlineScheduler: deadlines.schedule,
  });
  timeout.run('async_test(() => {}, "never completes");', "timeout.js");
  const completion = timeout.finish();
  const rejected = assert.rejects(completion, (error: unknown) =>
    error instanceof WptHungError && error.observation.kind === "hung" &&
    error.observation.verdict === "NOT RUN" && /timeout.js: never completes: test/.test(error.message) &&
    error.testResult === undefined);
  deadlines.scheduled.at(-1)!.callback();
  await rejected;
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
      (error instanceof AggregateError && error.errors.some((entry: unknown) => expected.test(String(entry)))) ||
      (cleanup.includes("new Promise") && error instanceof WptHungError &&
        error.observation.kind === "hung" && /promise-cleanup.js: cleanup: cleanup/.test(error.message) &&
        error.testResult?.status === "pass"));
    if (cleanup.includes("new Promise")) (await deadlines.phase("cleanup")).callback();
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

test("WPT pending promise tests can register awaited children and grandchildren", async () => {
  const release = Promise.withResolvers<void>();
  const order: string[] = [];
  const harness = new WptHarness({ gate: release.promise, record: (value: string) => { order.push(value); } });
  harness.run(`
    promise_test(async () => {
      await gate;
      record("setup");
      promise_test(async () => {
        await Promise.resolve();
        record("child");
        promise_test(() => { record("grandchild"); return Promise.resolve(); }, "grandchild");
      }, "child");
    }, "setup - define tests");
    promise_test(() => { record("already queued"); return Promise.resolve(); }, "already queued");
  `, "dynamic-promise-registration.js");
  const completion = harness.finish();
  release.resolve();
  const results = await completion;
  assert.deepEqual(results.map((result) => result.name), ["setup - define tests", "already queued", "child", "grandchild"]);
  assert.deepEqual(results.map((result) => result.status), ["pass", "pass", "pass", "pass"]);
  assert.deepEqual(order, ["setup", "already queued", "child", "grandchild"]);
});

test("WPT pending async tests can register all test kinds before completion", async () => {
  const release = Promise.withResolvers<void>();
  const order: string[] = [];
  const harness = new WptHarness({ gate: release.promise, record: (value: string) => { order.push(value); } });
  harness.run(`
    async_test(t => {
      gate.then(t.step_func(() => {
        test(() => { record("sync"); }, "sync child");
        async_test(child => {
          Promise.resolve().then(child.step_func_done(() => { record("async"); }));
        }, "async child");
        promise_test(() => { record("promise"); return Promise.resolve(); }, "promise child");
        t.done();
      }));
    }, "async registrar");
  `, "dynamic-async-registration.js");
  const completion = harness.finish();
  release.resolve();
  const results = await completion;
  assert.deepEqual(results.map((result) => result.name), ["async registrar", "sync child", "async child", "promise child"]);
  assert.deepEqual(results.map((result) => result.status), ["pass", "pass", "pass", "pass"]);
  assert.deepEqual(order, ["sync", "async", "promise"]);
});

test("WPT explicit done rejects later registration even while its caller is pending", async () => {
  for (const setup of ["", "setup({explicit_done:true});"]) {
    const harness = new WptHarness({});
    harness.run(`
      ${setup}
      promise_test(async () => {
        await Promise.resolve();
        done();
        promise_test(() => Promise.resolve(), "after done");
      }, "registrar");
    `, "registration-after-explicit-done.js");
    const results = await harness.finish();
    assert.equal(results.length, 1);
    assert.equal(results[0]?.status, "fail");
    assert.match(String(results[0]?.error), /test registered after done/);
  }
  const synchronous = new WptHarness({});
  synchronous.run('done(); test(() => {}, "too late");', "synchronous-registration-after-done.js");
  await assert.rejects(synchronous.finish(), AggregateError);
});

test("WPT unrelated background promises do not keep a completed fixture open", async () => {
  const release = Promise.withResolvers<void>();
  let detached: Promise<unknown> | undefined;
  const harness = new WptHarness({
    gate: release.promise,
    capture: (promise: Promise<unknown>) => { detached = promise; },
  });
  harness.run(`
    promise_test(() => {
      capture(gate.then(() => promise_test(() => Promise.resolve(), "detached child")));
      return Promise.resolve();
    }, "unrelated setup promise");
  `, "detached-registration.js");
  const results = await harness.finish();
  assert.deepEqual(results.map((result) => result.name), ["unrelated setup promise"]);
  assert.equal(results[0]?.status, "pass");
  assert.ok(detached !== undefined);
  const rejected = assert.rejects(detached, /test registered after done/);
  release.resolve();
  await rejected;
});

test("WPT exposes its real assertion error constructor to unchanged fixture helpers", async () => {
  const harness = new WptHarness({});
  harness.run(`
    test(() => assert_throws_js(AssertionError, () => assert_true(false)), "actual assertion constructor");
    test(() => {
      try { assert_implements_optional(false, "missing support"); }
      catch (error) {
        assert_true(error instanceof AssertionError);
        assert_true(error instanceof OptionalFeatureUnsupportedError);
        return;
      }
      assert_unreached("the optional assertion must throw");
    }, "optional error is an assertion error");
  `, "assertion-error-identity.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass", "pass"]);
});

test("WPT unsupported setup options and missing explicit done fail loudly", async () => {
  for (const options of [
    '{allow_uncaught_exception: true}', '{unknown_option: false}', '{explicit_done: 1}', '{explicit_timeout: 1}',
  ]) {
    const harness = new WptHarness({});
    harness.run(`setup(${options});`, "unsupported-setup.js");
    await assert.rejects(harness.finish(), AggregateError);
  }
  const deadlines = manualDeadlines();
  const pending = new WptHarness({}, {}, 10000, { deadlineScheduler: deadlines.schedule });
  pending.run('setup({explicit_done:true});', "missing-done.js");
  const completion = pending.finish();
  const rejected = assert.rejects(completion, (error: unknown) =>
    error instanceof WptHungError && /missing-done.js: <registration>: registration/.test(error.message));
  deadlines.scheduled.at(-1)!.callback();
  await rejected;
});

test("WPT membership assertions preserve indexOf identity and numeric semantics", async () => {
  const harness = new WptHarness({});
  harness.run(`
    test(() => assert_in_array("sign", ["verify", "sign"]), "present string");
    test(() => { const value = {}; assert_in_array(value, [value]); }, "object identity");
    test(() => assert_in_array(0, [-0]), "signed zero");
    test(() => assert_in_array(undefined, [undefined]), "explicit undefined");
    test(() => assert_in_array("sign", ["verify"]), "absent string");
    test(() => assert_in_array({}, [{}]), "different object");
    test(() => assert_in_array(1, ["1"]), "no coercion");
    test(() => assert_in_array(NaN, [NaN]), "NaN never matches");
    test(() => assert_in_array(undefined, [,]), "array hole does not match");
  `, "membership-assertions.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status),
    ["pass", "pass", "pass", "pass", "fail", "fail", "fail", "fail", "fail"]);
});

test("WPT optional-feature preconditions are blocked with cleanup, never successful tests", async () => {
  const cleaned: string[] = [];
  const harness = new WptHarness({ record: (value: string) => { cleaned.push(value); } });
  harness.run(`
    test(() => assert_implements_optional({}), "truthy support");
    test(t => {
      t.add_cleanup(() => record("sync"));
      assert_implements_optional(false, "compressed EC points");
      assert_unreached("must stop this callback");
    }, "missing optional support");
    async_test(t => {
      t.add_cleanup(() => record("async"));
      t.step(() => assert_implements_optional(0, "another optional feature"));
    }, "async optional support");
    promise_test(async t => {
      t.add_cleanup(async () => { await Promise.resolve(); record("promise"); });
      await Promise.resolve();
      assert_implements_optional(null, "optional support after await");
    }, "promise optional support");
    promise_test(() => Promise.resolve(), "following test");
    test(() => { throw new Error("ordinary failure"); }, "ordinary error");
  `, "optional-feature-assertion.js");
  const results = await harness.finish();
  assert.deepEqual(results.map((result) => result.status), ["pass", "blocked", "blocked", "blocked", "pass", "fail"]);
  assert.equal(results[1]?.reason, "optional feature unsupported: compressed EC points");
  assert.equal(results[3]?.reason, "optional feature unsupported: optional support after await");
  assert.deepEqual(cleaned, ["sync", "async", "promise"]);
  const outsideTest = new WptHarness({});
  outsideTest.run('assert_implements_optional(false, "file precondition");', "top-level-optional.js");
  await assert.rejects(outsideTest.finish(), (error: unknown) =>
    error instanceof AggregateError && error.errors.some((entry: unknown) => /file precondition/.test(String(entry))));
});

test("WPT explicit_timeout retains external test and registration watchdogs", async () => {
  const deadlines = manualDeadlines();
  const harness = new WptHarness({}, {}, 10000, { deadlineScheduler: deadlines.schedule });
  harness.run('setup({explicit_timeout:true}); async_test(() => {}, "unfinished test");', "explicit-timeout-test.js");
  const completion = harness.finish();
  assert.equal(deadlines.scheduled.length, 2);
  (await deadlines.at(0)).callback();
  const results = await completion;
  assert.equal(results[0]?.status, "fail");
  assert.match(String(results[0]?.error), /WPT timed out: unfinished test/);
  assert.ok(deadlines.scheduled.every((deadline) => deadline.cancelled));

  const registration = manualDeadlines();
  const pending = new WptHarness({}, {}, 10000, { deadlineScheduler: registration.schedule });
  pending.run('setup({explicit_done:true, explicit_timeout:true});', "explicit-timeout-registration.js");
  const rejected = assert.rejects(pending.finish(), (error: unknown) =>
    error instanceof AggregateError && error.errors.some((entry: unknown) => /requires a call to done/.test(String(entry))));
  (await registration.at(0)).callback();
  await rejected;
  assert.ok(registration.scheduled.every((deadline) => deadline.cancelled));
});

test("WPT manual timeout is conditional and explicit_timeout stays enabled once set", async () => {
  for (const setup of ["", "setup({explicit_timeout:false});"]) {
    const harness = new WptHarness({});
    harness.run(`${setup} timeout(); test(() => {}, "timeout is a no-op");`, "ordinary-manual-timeout.js");
    assert.equal((await harness.finish())[0]?.status, "pass");
  }
  for (const setup of ["", "setup({explicit_timeout:false});"]) {
    const deadlines = manualDeadlines();
    const harness = new WptHarness({}, {}, 10000, { deadlineScheduler: deadlines.schedule });
    harness.run(`
      setup({explicit_timeout:true, explicit_done:true});
      ${setup}
      async_test(() => {}, "interrupted test");
      timeout();
    `, "explicit-manual-timeout.js");
    await assert.rejects(harness.finish(), (error: unknown) =>
      error instanceof AggregateError && error.errors.some((entry: unknown) => /explicitly timed out/.test(String(entry))));
    assert.ok(deadlines.scheduled.every((deadline) => deadline.cancelled));
  }
});

test("WPT quota assertions check values, predicates and the exact injected constructor", async () => {
  class QuotaExceededError extends DOMException {
    readonly requested: number | null;
    readonly quota: number | null;
    constructor(requested: number | null = null, quota: number | null = null) {
      super("", "QuotaExceededError");
      this.requested = requested;
      this.quota = quota;
    }
  }
  const other = class QuotaExceededError extends DOMException {
    readonly requested = null;
    readonly quota = null;
    constructor() { super("", "QuotaExceededError"); }
  };
  const harness = new WptHarness({ QuotaExceededError, OtherQuota: other, DOMException });
  harness.run(`
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(); }, null, null), "null fields");
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(12, 8); }, 12, 8, "numeric values"), "number fields");
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(12, 8); }, value => value > 8, value => value === 8), "predicates");
    test(() => assert_throws_quotaexceedederror(OtherQuota, () => { throw new OtherQuota(); }, null, null, "another realm"), "explicit constructor");
    test(() => assert_throws_quotaexceedederror(function() {
      assert_equals(this, globalThis);
      throw new QuotaExceededError();
    }, null, null), "callback global receiver");
    test(() => {
      const error = new QuotaExceededError();
      error.requested = undefined;
      error.quota = "8";
      assert_throws_quotaexceedederror(() => { throw error; }, null, 8);
    }, "pinned loose comparison");
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(12, 8); }, 13, 8), "wrong requested");
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(12, 8); }, 12, 9), "wrong quota");
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(); }, () => false, null), "rejected requested predicate");
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(); }, null, () => false), "rejected quota predicate");
    test(() => assert_throws_quotaexceedederror(() => { throw new OtherQuota(); }, null, null), "wrong constructor");
    test(() => assert_throws_quotaexceedederror(() => { throw new DOMException("", "QuotaExceededError"); }, null, null), "legacy DOMException is insufficient");
    test(() => assert_throws_quotaexceedederror(() => { throw null; }, null, null), "null is not an exception object");
    test(() => assert_throws_quotaexceedederror(() => { throw 22; }, null, null), "primitive is not an exception object");
    test(() => assert_throws_quotaexceedederror(() => {}, null, null), "no exception");
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(); }, undefined, null), "invalid requested expectation");
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(); }, null, "8"), "invalid quota expectation");
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(); }, null, null, "description", "extra"), "unexpected fifth argument");
    test(() => {
      const error = new QuotaExceededError();
      delete error.requested;
      assert_throws_quotaexceedederror(() => { throw error; }, null, null);
    }, "missing requested property");
    test(() => {
      const error = new QuotaExceededError();
      delete error.quota;
      assert_throws_quotaexceedederror(() => { throw error; }, null, null);
    }, "missing quota property");
    test(() => {
      const error = { constructor: QuotaExceededError, code: 20, name: "QuotaExceededError", requested: null, quota: null };
      assert_throws_quotaexceedederror(() => { throw error; }, null, null);
    }, "wrong code");
    test(() => {
      const error = { constructor: QuotaExceededError, code: 22, name: "AbortError", requested: null, quota: null };
      assert_throws_quotaexceedederror(() => { throw error; }, null, null);
    }, "wrong name");
    test(() => assert_throws_quotaexceedederror(() => { assert_true(false); }, null, null), "assertion failure is not swallowed");
    test(() => assert_throws_quotaexceedederror(() => {
      assert_implements_optional(false, "optional assertion");
    }, null, null), "optional precondition is not swallowed");
  `, "quota-assertions.js");
  const results = await harness.finish();
  assert.deepEqual(results.slice(0, 6).map((result) => result.status), Array<string>(6).fill("pass"));
  assert.deepEqual(results.slice(6, 23).map((result) => result.status), Array<string>(17).fill("fail"));
  assert.equal(results[23]?.status, "blocked");
  assert.match(String(results[22]?.error), /false !== true/);
  assert.equal(results.length, 24);

  const missing = new WptHarness({ error: new QuotaExceededError() });
  missing.run('test(() => assert_throws_quotaexceedederror(() => { throw error; }, null, null), "missing quota constructor");', "missing-quota-constructor.js");
  assert.equal((await missing.finish())[0]?.status, "fail");
});

test("WPT quota assertions check fixed values before invoking requested and quota predicates", async () => {
  class QuotaExceededError extends DOMException {
    readonly requested = 12;
    readonly quota = 8;
    constructor() { super("", "QuotaExceededError"); }
  }
  const calls: string[] = [];
  const harness = new WptHarness({ QuotaExceededError, record: (value: string) => { calls.push(value); } });
  harness.run(`
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(); },
      () => { record("unexpected requested predicate"); return true; }, 9), "fixed quota mismatch");
    test(() => assert_throws_quotaexceedederror(() => { throw new QuotaExceededError(); },
      value => { record("requested"); return value === 12; },
      value => { record("quota"); return value === 8; }), "ordered predicates");
  `, "quota-predicate-order.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["fail", "pass"]);
  assert.deepEqual(calls, ["requested", "quota"]);
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

test("WPT legacy object assertions preserve the pinned enumerable-only comparison", async () => {
  const harness = new WptHarness({});
  harness.run(`
    test(() => assert_object_equals(
      { value: new Uint8Array(0), done: true }, { value: undefined, done: true }
    ), "closed BYOB result");
    test(() => assert_object_equals({}, undefined), "empty object against undefined");
    test(() => assert_object_equals({}, null), "empty object against null");
    test(() => assert_object_equals({ nested: {} }, { nested: 3 }), "empty nested object against number");
    test(() => assert_object_equals({ value: new Uint8Array([1]) }, { value: undefined }), "nonempty view");
    test(() => assert_object_equals({ value: undefined }, { value: new Uint8Array(0) }), "comparison is asymmetric");
    test(() => assert_object_equals(undefined, {}), "actual must be an object");
    test(() => assert_object_equals(Object.assign(Object.create(null), { value: 1 }), { value: 1 }), "actual has no hasOwnProperty");
    test(() => assert_object_equals({ value: 1 }, Object.assign(Object.create(null), { value: 1 })), "expected has no hasOwnProperty");
    test(() => {
      const reads = [];
      const actual = { get value() { reads.push("actual"); return 1; } };
      const expected = { get value() { reads.push("expected"); return 1; } };
      assert_object_equals(actual, expected);
      assert_array_equals(reads, ["actual", "actual", "expected", "expected", "actual"]);
    }, "eager diagnostic property reads");
  `, "legacy-object-assertion.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status),
    ["pass", "pass", "pass", "pass", "fail", "fail", "fail", "fail", "fail", "pass"]);
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

  const harness = new WptHarness({}, {}, undefined, { exposeSelf: true });
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
  const harness = new WptHarness({});
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
  const harness = new WptHarness({ failure });
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

  const unowned = new WptHarness({ failure });
  unowned.run(`
    setup({ explicit_done: true });
    step_timeout(() => { done(); throw failure; }, 0);
  `, "unowned-timer-error.js");
  await assert.rejects(unowned.finish(), (error: unknown) =>
    error instanceof AggregateError && error.errors.includes(failure));
});

test("WPT clears abandoned global timers when a fixture finishes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const harness = new WptHarness({ record: () => { calls++; } });
  harness.run(`
    promise_test(() => {
      step_timeout(record, 10);
      return Promise.resolve();
    }, "abandoned timer");
  `, "timer-cleanup.js");
  assert.equal((await harness.finish())[0]?.status, "pass");
  t.mock.timers.tick(10000);
  assert.equal(calls, 0);
});
