// Adapter controls against resources/testharness.js at
// 6a2f32237615d7ea9c1eb1e30453066b5555c603: EventWatcher (956-1072),
// format_value (1304-1497), relational assertions and assert_class_string.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { Event, EventTarget } from "../src/core/events.ts";
import { WptHarness } from "./wpt/harness.ts";

function eventHarness(t: TestContext, globals: Record<string, unknown> = {}): WptHarness {
  const harness = new WptHarness({ Event, EventTarget, ...globals });
  const runtime = createHostNodeWebPlatform({}, {}, (error) => harness.reportError(error));
  t.after(() => runtime.close());
  return harness;
}

test("WPT format_value preserves the scalar and object spellings used in FileAPI names", async () => {
  const harness = new WptHarness({});
  harness.run(String.raw`
    test(() => {
      assert_equals(format_value(undefined), "undefined");
      assert_equals(format_value(null), "null");
      assert_equals(format_value(true), "true");
      assert_equals(format_value(false), "false");
      assert_equals(format_value(-0), "-0");
      assert_equals(format_value(NaN), "NaN");
      assert_equals(format_value(Infinity), "Infinity");
      assert_equals(format_value(-Infinity), "-Infinity");
      assert_equals(format_value(12n), "12n");
      assert_equals(format_value({}), 'object "[object Object]"');
      assert_equals(format_value({unrecognized:true}), 'object "[object Object]"');
      assert_equals(format_value(/regex/), 'object "/regex/"');
      assert_equals(format_value(function() {}), 'function "function() {}"');
      assert_equals(format_value(Symbol("key")), 'symbol "Symbol(key)"');
      assert_equals(format_value(new String("wrapped")), 'object "wrapped"');
      assert_equals(format_value(new Number(7)), 'object "7"');
      assert_equals(format_value({toString() { throw "bad"; }}),
        "[stringifying object threw bad with type string]");
    }, "scalar formatting");
  `, "format-scalars.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass"]);
});

test("WPT format_value retains control escaping, sparse arrays, shared references and truncation", async () => {
  const harness = new WptHarness({});
  harness.run(String.raw`
    test(() => {
      const backslash = String.fromCharCode(92);
      const controls = String.fromCharCode(0, 1, 8, 9, 10, 11, 12, 13, 31, 34, 92, 0xfffd, 0xfffe, 0xffff);
      const escaped = ["0", "x01", "b", "t", "n", "v", "f", "r", "x1f", '"', backslash, "ufffd", "ufffe", "uffff"];
      assert_equals(format_value(controls), '"' + escaped.map(value => backslash + value).join("") + '"');
      assert_equals(format_value([1,,3]), "[1, , 3]");
      const child = [1];
      assert_equals(format_value([child, child]), "[[1], [...]]");
      const circular = []; circular.push(circular);
      assert_equals(format_value(circular), "[[...]]");
      const marked = [2]; marked.beginEllipsis = null; marked.endEllipsis = false;
      assert_equals(format_value(marked), "[…, 2, …]");
      assert_equals(format_value({toString() { return "x".repeat(1001); }}),
        'object "' + "x".repeat(997) + '..."');
      assert_equals(format_value("x".repeat(1001)).length, 1003);
    }, "compound formatting");
  `, "format-compounds.js");
  const results = await harness.finish();
  assert.equal(results[0]?.status, "pass", String(results[0]?.error));
});

test("WPT relational assertions reject coercion, mixed numeric kinds, NaN and incorrect boundaries", async () => {
  const harness = new WptHarness({});
  harness.run(`
    test(() => assert_less_than(1, 2), "number less");
    test(() => assert_less_than(1n, 2n), "bigint less");
    test(() => assert_less_than_equal(2, 2), "number inclusive");
    test(() => assert_greater_than_equal(2n, 2n), "bigint inclusive");
    test(() => assert_less_than_equal(-0, 0), "relational signed zero");
    test(() => assert_less_than(2, 2), "strict boundary");
    test(() => assert_less_than("1", 2), "string coercion");
    test(() => assert_less_than(1n, 2), "mixed kinds");
    test(() => assert_less_than_equal(new Number(1), 2), "boxed number");
    test(() => assert_greater_than_equal(NaN, 0), "NaN actual");
    test(() => assert_less_than_equal(0, NaN), "NaN expected");
    test(() => assert_greater_than_equal(1, 2), "wrong direction");
  `, "relational-controls.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status),
    ["pass", "pass", "pass", "pass", "pass", "fail", "fail", "fail", "fail", "fail", "fail", "fail"]);
});

test("WPT assert_class_string uses the intrinsic tag and cannot be fooled by an own toString", async () => {
  const harness = new WptHarness({});
  harness.run(`
    test(() => assert_class_string([], "Array"), "array");
    test(() => assert_class_string(null, "Null"), "null");
    test(() => assert_class_string(1, "Number"), "primitive");
    test(() => assert_class_string({toString() { return "[object Array]"; }}, "Array"), "own toString");
    test(() => assert_class_string({[Symbol.toStringTag]:"Tagged"}, "Tagged"), "specified tag behavior");
  `, "class-string-controls.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass", "pass", "pass", "fail", "pass"]);
});

test("WPT optional title names count only unnamed registrations and preserve the old fallback", async () => {
  const harness = new WptHarness({}, {}, undefined, { defaultTestName: "FileAPI Test: example" });
  harness.run(`
    test(() => {}, "explicit");
    test(() => {});
    test(() => {}, "another explicit");
    test(() => {});
  `, "title-controls.js");
  assert.deepEqual((await harness.finish()).map((result) => result.name),
    ["explicit", "FileAPI Test: example", "another explicit", "FileAPI Test: example 1"]);
  const existing = new WptHarness({});
  existing.run('test(() => {}, "explicit"); test(() => {});', "old-title-controls.js");
  assert.deepEqual((await existing.finish()).map((result) => result.name), ["explicit", "unnamed test 2"]);
});

test("WPT EventWatcher preserves ordered events, record-all identity and sequential waits", async (t) => {
  const harness = eventHarness(t);
  harness.run(`
    promise_test(async t => {
      const target = new EventTarget();
      const watcher = new EventWatcher(t, target, ["one", "two", "three"]);
      const first = new Event("one"), second = new Event("two"), third = new Event("three");
      const expected = ["one", "two"];
      const both = watcher.wait_for(expected, {record:"all"});
      target.dispatchEvent(first);
      target.dispatchEvent(second);
      assert_array_equals(await both, [first, second]);
      assert_array_equals(expected, ["two"]);
      const next = watcher.wait_for("three");
      target.dispatchEvent(third);
      assert_equals(await next, third);
    }, "ordered sequence");
  `, "watcher-order.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass"]);
});

test("WPT EventWatcher rejects unexpected events before a wait, out of order and between waits", async (t) => {
  const harness = eventHarness(t);
  harness.run(`
    test(t => {
      const target = new EventTarget();
      new EventWatcher(t, target, "one");
      target.dispatchEvent(new Event("one"));
    }, "before wait");
    test(t => {
      const target = new EventTarget();
      const watcher = new EventWatcher(t, target, ["one", "two"]);
      watcher.wait_for("one");
      target.dispatchEvent(new Event("two"));
    }, "wrong order");
    test(t => {
      const target = new EventTarget();
      const watcher = new EventWatcher(t, target, ["one", "two"]);
      watcher.wait_for("one");
      target.dispatchEvent(new Event("one"));
      target.dispatchEvent(new Event("two"));
    }, "between waits");
  `, "watcher-unexpected.js");
  const results = await harness.finish();
  assert.deepEqual(results.map((result) => result.status), ["fail", "fail", "fail"]);
  assert.match(String(results[0]?.error), /Not expecting event/);
  assert.match(String(results[1]?.error), /Expected one event/);
  assert.match(String(results[2]?.error), /Not expecting event/);
});

test("WPT EventWatcher rejects overlapping waits without replacing the original", async (t) => {
  const harness = eventHarness(t);
  harness.run(`
    promise_test(async t => {
      const target = new EventTarget();
      const watcher = new EventWatcher(t, target, ["one", "two"]);
      const first = watcher.wait_for("one");
      await promise_rejects_exactly(t, "Already waiting for an event or events", watcher.wait_for("two"));
      const event = new Event("one");
      target.dispatchEvent(event);
      assert_equals(await first, event);
    }, "overlapping wait");
  `, "watcher-overlap.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass"]);
});

test("WPT EventWatcher removes listeners through FIFO cleanup on both pass and failure", async (t) => {
  const order: string[] = [];
  class ObservedTarget extends EventTarget {
    override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>): void {
      order.push("remove " + args[0]);
      super.removeEventListener(...args);
    }
  }
  const harness = eventHarness(t, { ObservedTarget, record: (value: string) => { order.push(value); } });
  harness.run(`
    test(t => {
      t.add_cleanup(() => record("before"));
      new EventWatcher(t, new ObservedTarget(), ["one", "two"]);
      t.add_cleanup(() => record("after"));
    }, "cleanup after pass");
    test(t => {
      new EventWatcher(t, new ObservedTarget(), "three");
      assert_unreached("intentional failure");
    }, "cleanup after failure");
  `, "watcher-cleanup.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), ["pass", "fail"]);
  assert.deepEqual(order, ["before", "remove one", "remove two", "after", "remove three"]);
});

test("WPT EventWatcher fails a live timeout and ignores timeouts from completed waits", async (t) => {
  const harness = eventHarness(t);
  harness.run(`
    promise_test(t => {
      const watcher = new EventWatcher(t, new EventTarget(), "one", () => Promise.resolve());
      return watcher.wait_for("one");
    }, "live timeout");
    promise_test(async t => {
      const target = new EventTarget();
      const timeouts = [];
      const watcher = new EventWatcher(t, target, ["one", "two"], () => {
        const timeout = Promise.withResolvers(); timeouts.push(timeout); return timeout.promise;
      });
      const first = watcher.wait_for("one");
      target.dispatchEvent(new Event("one"));
      await first;
      const second = watcher.wait_for("two");
      timeouts[0].resolve();
      await Promise.resolve();
      target.dispatchEvent(new Event("two"));
      await second;
      timeouts[1].resolve();
      await Promise.resolve();
    }, "stale timeout");
  `, "watcher-timeout.js");
  const results = await harness.finish();
  assert.deepEqual(results.map((result) => result.status), ["fail", "pass"]);
  assert.match(String(results[0]?.error), /Timed out waiting for one/);
});
