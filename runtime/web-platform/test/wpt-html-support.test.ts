import assert from "node:assert/strict";
import test from "node:test";
import { WptHarness } from "./wpt/harness.ts";
import { runWptHtmlScripts } from "./wpt/runner.ts";
import type { WptFixture } from "./wpt/runner.ts";

function fixture(support: string[] = []): WptFixture {
  return {
    path: "fetch/api/request/control.html", format: "html", support,
    harnessScripts: ["/resources/testharness.js"],
    revision: "control", sha256: "control", gitBlob: "control",
    expectedTests: 1, blockedTests: {},
  };
}

test("WPT HTML helpers execute in source order with relative and absolute paths", async () => {
  const order: string[] = [];
  const harness = new WptHarness({ record: (value: string) => { order.push(value); } });
  const support = new Map([
    ["fetch/api/resources/first.js", 'record("first helper"); var helperValue = 7;'],
    ["common/second.js", 'record("second helper"); helperValue++;'],
  ]);
  runWptHtmlScripts(harness, `
    <script src="/resources/testharness.js"></script>
    <script>record("before helpers");</script>
    <script src="../resources/first.js"></script>
    <script>record("between helpers");</script>
    <script src="/common/second.js"></script>
    <script>test(() => assert_equals(helperValue, 8), "helper value");</script>
  `, fixture([...support.keys()]), support);
  assert.deepEqual(order, ["before helpers", "first helper", "between helpers", "second helper"]);
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass"]);
});

test("WPT HTML dependency mismatches fail before inline or helper execution", async () => {
  for (const [declared, available] of [
    [[], new Map<string, string>()],
    [[], new Map([["common/helper.js", 'record("helper");']])],
    [["common/helper.js", "common/unused.js"], new Map([["common/helper.js", 'record("helper");']])],
  ] as const) {
    const calls: string[] = [];
    const harness = new WptHarness({ record: (value: string) => { calls.push(value); } });
    assert.throws(() => runWptHtmlScripts(harness, `
      <script src="/resources/testharness.js"></script>
      <script>record("inline");</script>
      <script src="/common/helper.js"></script>
    `, fixture([...declared]), available));
    assert.deepEqual(calls, []);
    assert.deepEqual(await harness.finish(), []);
  }
});

test("WPT HTML loader refuses unsupported script execution modes", async () => {
  for (const attribute of ['type="module"', "async", "defer", "nomodule"]) {
    let calls = 0;
    const harness = new WptHarness({ called: () => { calls++; } });
    assert.throws(() => runWptHtmlScripts(harness,
      `<script src="/resources/testharness.js"></script><script ${attribute}>called();</script>`,
      fixture(), new Map()));
    assert.equal(calls, 0);
    assert.deepEqual(await harness.finish(), []);
  }
});

test("WPT HTML helpers cannot disguise external or server-processed resources as pinned paths", async () => {
  for (const reference of ["https://other.example/common/helper.js", "/common/helper.js?pipe=sub", "/common/helper.js#fragment"]) {
    let calls = 0;
    const harness = new WptHarness({ called: () => { calls++; } });
    assert.throws(() => runWptHtmlScripts(harness,
      `<script src="/resources/testharness.js"></script><script src="${reference}"></script>`,
      fixture(["common/helper.js"]), new Map([["common/helper.js", "called();"]])));
    assert.equal(calls, 0);
    assert.deepEqual(await harness.finish(), []);
  }
});
