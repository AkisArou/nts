import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import "../host/environment-shim.ts";
import { DOMException } from "../src/core/errors.ts";
import { Event } from "../src/core/events.ts";
import { installWebPlatformRuntime } from "../src/provider/environment.ts";
import { WebPlatformRuntime } from "../src/provider/web-platform-runtime.ts";
import type { PerformanceCapabilities } from "../src/provider/performance.ts";
import {
  createPerformance, Performance, PerformanceEntry, PerformanceMark, PerformanceMeasure,
} from "../src/performance/performance.ts";

function environment(t: TestContext, capabilities: PerformanceCapabilities = {}) {
  const clock = { now: 150, calls: 0, wallCalls: 0 };
  const runtime = new WebPlatformRuntime({
    ...createHostNodePrimitives(),
    monotonicMilliseconds() { clock.calls++; return clock.now; },
    wallTimeMilliseconds() { clock.wallCalls++; return 9_000_000; },
  });
  installWebPlatformRuntime(runtime);
  const performance = createPerformance(runtime, capabilities);
  t.after(() => runtime.close());
  return { performance, runtime, clock };
}

function call(fn: (...args: never[]) => unknown, receiver: unknown, args: unknown[]): unknown {
  return Reflect.apply(fn, receiver, args);
}

test("Performance now reads only the monotonic capability and applies the fixed origin", (t) => {
  const { performance, clock } = environment(t, { timeOrigin: { epochMilliseconds: 123_456, monotonicMilliseconds: 125 } });
  clock.calls = clock.wallCalls = 0;
  assert.equal(performance.now(), 25);
  clock.now = 175.125;
  assert.equal(performance.now(), 50.125);
  assert.equal(clock.calls, 2);
  assert.equal(clock.wallCalls, 0);
  assert.equal(performance.timeOrigin, 123_456);
  assert.deepEqual(performance.toJSON(), { timeOrigin: 123_456 });
  assert.notEqual(performance.toJSON(), performance.toJSON());
});

test("Performance refuses missing epoch correlation without approximating a wall-clock origin", (t) => {
  const { performance, clock } = environment(t);
  assert.equal(performance.now(), 150);
  for (const read of [() => performance.timeOrigin, () => performance.toJSON()]) {
    assert.throws(read, (error) => error instanceof DOMException && error.name === "NotSupportedError");
  }
  assert.equal(clock.wallCalls, 0);
});

test("Performance is an EventTarget and direct platform-only constructors reject", (t) => {
  const { performance } = environment(t);
  let count = 0;
  performance.addEventListener("sample", () => { count++; }, { once: true });
  performance.dispatchEvent(new Event("sample"));
  performance.dispatchEvent(new Event("sample"));
  assert.equal(count, 1);
  assert.throws(() => new Performance(), TypeError);
  assert.throws(() => new PerformanceEntry(), TypeError);
  assert.throws(() => new PerformanceMeasure(), TypeError);
  assert.equal(Performance.length, 0);
  assert.equal(PerformanceEntry.length, 0);
  assert.equal(PerformanceMark.length, 1);
  assert.equal(PerformanceMeasure.length, 0);
  assert.equal(Object.prototype.toString.call(performance), "[object Performance]");
});

test("Performance factory preserves one instance per runtime", (t) => {
  const { runtime } = environment(t);
  assert.throws(() => createPerformance(runtime), /already installed/);
});

test("Performance argument counts and receiver brands are checked before coercion", (t) => {
  const { performance } = environment(t);
  for (const fn of [performance.mark, performance.measure, performance.getEntriesByName, performance.getEntriesByType]) {
    assert.throws(() => call(fn, performance, []), TypeError);
    let converted = false;
    assert.throws(() => call(fn, {}, [{ toString() { converted = true; return "x"; } }]), TypeError);
    assert.equal(converted, false);
  }
  for (const fn of [performance.now, performance.toJSON, performance.getEntries, performance.clearMarks, performance.clearMeasures]) {
    assert.throws(() => call(fn, {}, []), TypeError);
  }
  assert.throws(() => Reflect.construct(PerformanceMark, []), TypeError);
});

test("mark converts its name and dictionary in order before reading the clock", (t) => {
  const { performance, clock } = environment(t);
  const order: string[] = [];
  const name = { toString() { order.push("name"); return "ordered"; } };
  const options = {
    get detail() { order.push("detail"); return "metadata"; },
    get startTime() { order.push("startTime"); return { valueOf() { order.push("double"); return 6; } }; },
  };
  clock.calls = 0;
  const mark = call(performance.mark, performance, [name, options]) as PerformanceMark;
  assert.deepEqual(order, ["name", "detail", "startTime", "double"]);
  assert.equal(clock.calls, 0);
  assert.deepEqual(mark.toJSON(), { name: "ordered", entryType: "mark", startTime: 6, duration: 0, detail: "metadata" });
});

test("standalone PerformanceMark shares conversion and clock policy without entering the timeline", (t) => {
  const { performance } = environment(t);
  const entry = new PerformanceMark("standalone");
  assert.ok(entry instanceof PerformanceEntry);
  assert.equal(entry.startTime, 150);
  assert.equal(entry.detail, null);
  assert.deepEqual(performance.getEntries(), []);
  assert.equal(Object.prototype.toString.call(entry), "[object PerformanceMark]");
});

test("mark and measure capture their owner clock without dispatch through public now", (t) => {
  const { performance, clock } = environment(t);
  performance.now = () => { throw new Error("overridden now"); };
  assert.equal(performance.mark("owner").startTime, 150);
  clock.now = 160;
  assert.equal(performance.measure("elapsed", "owner").duration, 10);
});

test("mark rejects non-dictionaries and non-finite or negative starts without adding entries", (t) => {
  const { performance } = environment(t);
  for (const options of [1, true, "text", Symbol("dict"), { startTime: -1 }, { startTime: NaN }, { startTime: Infinity }, { startTime: -Infinity }, { startTime: 1n }]) {
    assert.throws(() => call(performance.mark, performance, ["bad", options]), TypeError);
    assert.throws(() => Reflect.construct(PerformanceMark, ["bad", options]), TypeError);
  }
  assert.deepEqual(performance.getEntries(), []);
});

test("mark accepts explicit zero, negative zero, future time and null dictionaries", (t) => {
  const { performance } = environment(t);
  assert.equal(performance.mark("zero", { startTime: 0 }).startTime, 0);
  assert.ok(Object.is(performance.mark("negative-zero", { startTime: -0 }).startTime, -0));
  assert.equal(performance.mark("future", { startTime: 100_000 }).startTime, 100_000);
  assert.equal((call(performance.mark, performance, ["null", null]) as PerformanceMark).startTime, 150);
});

test("User Timing preserves immutable primitive detail values", (t) => {
  const { performance } = environment(t);
  for (const detail of [null, true, false, 0, -0, NaN, Infinity, 42n, "text"]) {
    assert.ok(Object.is(performance.mark("detail", { detail }).detail, detail));
    assert.ok(Object.is(performance.measure("detail", { start: 0, detail }).detail, detail));
  }
  assert.equal(performance.mark("omitted", { detail: undefined }).detail, null);
  assert.equal(performance.measure("omitted", { start: 0, detail: undefined }).detail, null);
});

test("function and Symbol details raise DataCloneError without changing the timeline", (t) => {
  const { performance } = environment(t);
  for (const detail of [Symbol("uncloneable"), () => {}]) {
    for (const create of [() => performance.mark("bad", { detail }), () => performance.measure("bad", { start: 0, detail })]) {
      assert.throws(create, (error) => error instanceof DOMException && error.name === "DataCloneError");
    }
  }
  assert.deepEqual(performance.getEntries(), []);
});

test("object detail without the clone capability is an explicit dependency, not an identity clone", (t) => {
  const { performance } = environment(t);
  for (const create of [() => performance.mark("bad", { detail: {} }), () => performance.measure("bad", { start: 0, detail: [] })]) {
    assert.throws(create, (error) => error instanceof DOMException && error.name === "NotSupportedError");
  }
  assert.deepEqual(performance.getEntries(), []);
});

test("detail clone capability receives the original object once and its result is retained", (t) => {
  const original = { input: true };
  const calls: object[] = [];
  const copies: unknown[] = [];
  // This is a genuine host structured clone, used only to verify the source
  // boundary. The ordinary provider and WPT driver still have no such capability.
  const { performance } = environment(t, { detailCloner: { clone(value) {
    calls.push(value);
    try {
      const copied: unknown = structuredClone(value);
      copies.push(copied);
      return { ok: true, value: copied };
    } catch (error) { return { ok: false, error }; }
  } } });
  const mark = performance.mark("detail", { detail: original });
  assert.deepEqual(calls, [original]);
  assert.deepEqual(mark.detail, original);
  assert.notEqual(mark.detail, original);
  assert.equal(mark.detail, copies[0]);
  assert.equal(mark.detail, mark.detail);
  assert.equal(mark.toJSON().detail, copies[0]);
});

test("a genuine host clone preserves shared cycles and snapshots detail before insertion", (t) => {
  const { performance } = environment(t, { detailCloner: { clone(value) {
    try { return { ok: true, value: structuredClone(value) }; }
    catch (error) { return { ok: false, error }; }
  } } });
  const shared = { count: 2 };
  const original: { left: { count: number }; right: { count: number }; self?: unknown } = { left: shared, right: shared };
  original.self = original;
  const entry = performance.measure("cloned", { start: 1, end: 2, detail: original });
  const copied = entry.detail as typeof original;
  shared.count = 9;
  assert.notEqual(copied, original);
  assert.equal(copied.left, copied.right);
  assert.equal(copied.self, copied);
  assert.equal(copied.left.count, 2);
  const sentinel = new Error("getter failure during serialization");
  assert.throws(() => performance.mark("not inserted", { detail: { get value() { throw sentinel; } } }), (error) => error === sentinel);
  assert.deepEqual(performance.getEntries(), [entry]);
});

test("detail clone failure is returned as a value and thrown exactly before insertion", (t) => {
  const sentinel = { failure: true };
  const { performance } = environment(t, { detailCloner: { clone() { return { ok: false, error: sentinel }; } } });
  assert.throws(() => performance.mark("bad", { detail: {} }), (error) => error === sentinel);
  assert.throws(() => performance.measure("bad", { start: 1, detail: {} }), (error) => error === sentinel);
  assert.deepEqual(performance.getEntries(), []);
});

test("measure converts dictionary members in lexical order before converting its end argument", (t) => {
  const { performance } = environment(t);
  const order: string[] = [];
  const number = (name: string, value: number) => ({ valueOf() { order.push(name + " value"); return value; } });
  const options = {
    get detail() { order.push("detail"); return null; },
    get duration() { order.push("duration"); return number("duration", 3); },
    get end() { order.push("end"); return undefined; },
    get start() { order.push("start"); return 2; },
  };
  const end = { toString() { order.push("third"); return "end"; } };
  assert.throws(() => call(performance.measure, performance, ["m", options, end]), TypeError);
  assert.deepEqual(order, ["detail", "duration", "duration value", "end", "start", "third"]);
});

test("measure handles every valid start/end/duration combination and permits negative results", (t) => {
  const { performance } = environment(t);
  const vectors: [unknown[], number, number][] = [
    [[], 0, 150],
    [[{}], 0, 150],
    [[null], 0, 150],
    [[{ start: 20 }], 20, 130],
    [[{ end: 30 }], 0, 30],
    [[{ start: 20, end: 30 }], 20, 10],
    [[{ start: 20, duration: 5 }], 20, 5],
    [[{ end: 20, duration: 30 }], -10, 30],
    [[{ start: 30, end: 20 }], 30, -10],
  ];
  for (const [args, start, duration] of vectors) {
    const entry = call(performance.measure, performance, ["m", ...args]) as PerformanceMeasure;
    assert.equal(entry.startTime, start);
    assert.equal(entry.duration, duration);
    assert.equal(entry.detail, null);
  }
});

test("measure rejects invalid combinations, negative timestamps and non-finite converted values", (t) => {
  const { performance } = environment(t);
  const vectors: unknown[][] = [
    [{ duration: 1 }], [{ detail: null }], [{ start: 1, end: 2, duration: 1 }],
    [{ start: 1 }, "end"], [{ end: 2 }, "end"],
    [{ start: -1 }], [{ end: -1 }], [{ start: 1, duration: -1 }],
    [{ end: 1, duration: -1 }], [{ start: NaN }], [{ end: Infinity }], [{ duration: NaN }],
  ];
  for (const args of vectors) assert.throws(() => call(performance.measure, performance, ["bad", ...args]), TypeError);
  assert.deepEqual(performance.getEntries(), []);
});

test("measure numeric top-level arguments are names while dictionary numbers are timestamps", (t) => {
  const { performance } = environment(t);
  performance.mark("2", { startTime: 12 });
  performance.mark("false", { startTime: 14 });
  assert.equal((call(performance.measure, performance, ["number name", 2]) as PerformanceMeasure).startTime, 12);
  assert.equal(performance.measure("timestamp", { start: 2 }).startTime, 2);
  assert.equal((call(performance.measure, performance, ["boolean name", { start: false }]) as PerformanceMeasure).startTime, 14);
});

test("measure resolves the most recently added mark rather than the greatest timestamp", (t) => {
  const { performance } = environment(t);
  performance.mark("same", { startTime: 80 });
  const recent = performance.mark("same", { startTime: 20 });
  const measure = performance.measure("value", "same");
  assert.equal(measure.startTime, recent.startTime);
  assert.equal(measure.duration, 130);
});

test("measure rejects absent marks with canonical SyntaxError and reserved names in non-Window environments", (t) => {
  const { performance } = environment(t);
  assert.throws(() => performance.measure("m", "absent"), (error) => error instanceof DOMException && error.name === "SyntaxError");
  performance.mark("navigationStart", { startTime: 9 });
  assert.throws(() => performance.measure("m", "navigationStart"), TypeError);
});

test("measure converts all arguments before checking the existence of a referenced mark", (t) => {
  const { performance } = environment(t);
  const order: string[] = [];
  const name = { toString() { order.push("name"); return "m"; } };
  const end = { toString() { order.push("end"); return "absent end"; } };
  assert.throws(() => call(performance.measure, performance, [name, "absent start", end]), (error) => error instanceof DOMException && error.name === "SyntaxError");
  assert.deepEqual(order, ["name", "end"]);
});

test("empty measure dictionaries can accompany an end mark", (t) => {
  const { performance } = environment(t);
  performance.mark("end", { startTime: 5 });
  for (const options of [undefined, null, {}, { unknown: true }, { start: undefined, detail: undefined }]) {
    const entry = call(performance.measure, performance, ["m", options, "end"]) as PerformanceMeasure;
    assert.equal(entry.startTime, 0);
    assert.equal(entry.duration, 5);
  }
});

test("timeline queries are sorted, case-sensitive snapshots retaining entry identity", (t) => {
  const { performance } = environment(t);
  const later = performance.mark("Case", { startTime: 30 });
  const earlier = performance.mark("Case", { startTime: 10 });
  const measure = performance.measure("Case", { start: 20, end: 25 });
  assert.deepEqual(performance.getEntries(), [earlier, measure, later]);
  assert.deepEqual(performance.getEntriesByName("Case", "mark"), [earlier, later]);
  assert.deepEqual(performance.getEntriesByName("case"), []);
  assert.deepEqual(performance.getEntriesByType("Mark"), []);
  const copy = performance.getEntries();
  copy.length = 0;
  assert.equal(performance.getEntries().length, 3);
});

test("timeline name/type coercion occurs in order without treating null as an omitted name", (t) => {
  const { performance } = environment(t);
  performance.mark("null");
  const calls: string[] = [];
  const name = { toString() { calls.push("name"); return "null"; } };
  const type = { toString() { calls.push("type"); return "mark"; } };
  assert.equal((call(performance.getEntriesByName, performance, [name, type]) as unknown[]).length, 1);
  assert.deepEqual(calls, ["name", "type"]);
  assert.equal((call(performance.getEntriesByName, performance, [null]) as unknown[]).length, 1);
});

test("clearMarks and clearMeasures remove all matches of only their own type", (t) => {
  const { performance } = environment(t);
  performance.mark("same");
  performance.mark("same");
  const other = performance.mark("other");
  const measure = performance.measure("same");
  performance.clearMarks("same");
  assert.deepEqual(performance.getEntries(), [measure, other]);
  performance.clearMarks("absent");
  assert.deepEqual(performance.getEntries(), [measure, other]);
  performance.clearMeasures("same");
  assert.deepEqual(performance.getEntries(), [other]);
  performance.clearMarks(undefined);
  assert.deepEqual(performance.getEntries(), []);
});

test("entries and cloned detail survive clearing their source timeline", (t) => {
  const { performance } = environment(t);
  const mark = performance.mark("m", { detail: "retained", startTime: 4 });
  const measure = performance.measure("measure", { start: 4, end: 9, detail: 5 });
  performance.clearMarks();
  performance.clearMeasures();
  assert.deepEqual(mark.toJSON(), { name: "m", entryType: "mark", startTime: 4, duration: 0, detail: "retained" });
  assert.deepEqual(measure.toJSON(), { name: "measure", entryType: "measure", startTime: 4, duration: 5, detail: 5 });
  assert.equal(Object.prototype.toString.call(measure), "[object PerformanceMeasure]");
});

test("separate runtime timelines and clocks do not leak into existing Performance instances", (t) => {
  const first = environment(t);
  const second = environment(t);
  first.clock.now = 10;
  second.clock.now = 20;
  const entry = first.performance.mark("first");
  assert.equal(entry.startTime, 10);
  assert.deepEqual(second.performance.getEntries(), []);
  assert.equal(new PerformanceMark("current").startTime, 20);
});
