import assert from "node:assert/strict";
import test from "node:test";
import { WptHarness } from "./wpt/harness.ts";

test("WPT allow_uncaught_exception applies only to the explicit uncaught-global channel", async () => {
  let harness: WptHarness;
  harness = new WptHarness({ uncaught: () => harness.reportUncaughtException("expected uncaught") }, {}, 1000,
    { uncaughtExceptionChannel: true });
  harness.run('setup({allow_uncaught_exception:true}); test(() => uncaught(), "allowed");', "allowed.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass"]);
});

test("WPT uncaught-global reports fail when the option is false or absent", async () => {
  for (const setup of ["", "setup({allow_uncaught_exception:false});"]) {
    let harness: WptHarness;
    harness = new WptHarness({ uncaught: () => harness.reportUncaughtException("unexpected") }, {}, 1000,
      { uncaughtExceptionChannel: true });
    harness.run(setup + 'test(() => uncaught(), "not allowed");', "not-allowed.js");
    assert.deepEqual((await harness.finish()).map((result) => result.status), ["fail"]);
  }
});

test("WPT allowing uncaught errors never suppresses assertions or ordinary error reporting", async () => {
  let harness: WptHarness;
  harness = new WptHarness({ failure: () => harness.reportError("assertion channel") }, {}, 1000,
    { uncaughtExceptionChannel: true });
  harness.run(`
    setup({allow_uncaught_exception:true});
    test(() => assert_true(false), "assertion");
    test(() => failure(), "error reporter");
  `, "assertions.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["fail", "fail"]);
});

test("WPT allow_uncaught_exception requires a boolean and does not swallow registration errors", async () => {
  const harness = new WptHarness({}, {}, 1000, { uncaughtExceptionChannel: true });
  harness.run('setup({allow_uncaught_exception:"true"});', "invalid-option.js");
  await assert.rejects(harness.finish(), AggregateError);
  const registration = new WptHarness({}, {}, 1000, { uncaughtExceptionChannel: true });
  registration.run('setup({allow_uncaught_exception:true}); throw new Error("registration error");', "registration.js");
  await assert.rejects(registration.finish(), AggregateError);
});

test("WPT cannot allow uncaught exceptions without an explicit provider channel", async () => {
  const harness = new WptHarness({});
  harness.run('setup({allow_uncaught_exception:true});', "missing-channel.js");
  await assert.rejects(harness.finish(), AggregateError);
});
