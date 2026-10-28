import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import "../host/environment-shim.ts";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import { Event } from "../src/core/events.ts";
import { PromiseRejectionEvent } from "../src/core/promise-rejection-event.ts";
import { Navigator } from "../src/navigator/navigator.ts";
import {
  Performance, PerformanceEntry, PerformanceMark, PerformanceMeasure, createPerformance,
} from "../src/performance/performance.ts";
import { installWebPlatformRuntime } from "../src/provider/environment.ts";
import { getURLPatternURLCapability, URLPatternCapabilityError } from "../src/provider/url-pattern.ts";
import { WebPlatformRuntime } from "../src/provider/web-platform-runtime.ts";
import type {
  WebPlatformGlobalBindings, WebPlatformGlobalCapabilities,
} from "../src/provider/web-platform-runtime.ts";
import { URLPattern } from "../src/urlpattern/url-pattern.ts";
import { ErrorDriver } from "./support/global-errors-driver.ts";

function environment(t: TestContext) {
  const state = { now: 150.125, clockCalls: 0, wallCalls: 0, agent: "BootstrapFixture/1", agentReads: 0, clones: 0, urlReads: 0 };
  const runtime = new WebPlatformRuntime({
    ...createHostNodePrimitives(),
    monotonicMilliseconds() { state.clockCalls++; return state.now; },
    wallTimeMilliseconds() { state.wallCalls++; return 9_000_000; },
  });
  installWebPlatformRuntime(runtime);
  t.after(() => runtime.close());
  const errors = new ErrorDriver();
  const capabilities: WebPlatformGlobalCapabilities = {
    performance: {
      timeOrigin: { epochMilliseconds: 123_456, monotonicMilliseconds: 0 },
      detailCloner: {
        clone(value) {
          state.clones++;
          // Actual Node cloning is test-provider glue, not a source/native nts binding.
          try { return { ok: true, value: structuredClone(value) }; }
          catch (error) { return { ok: false, error }; }
        },
      },
    },
    navigator: { userAgent() { state.agentReads++; return state.agent; } },
    urlPattern: {
      // This control advertises the typed boundary and returns explicit refusal
      // for nonempty URL components; it does not pretend to implement a parser.
      canonicalize() { state.urlReads++; return { ok: false, error: "unsupported" }; },
      hasOpaquePath() { return false; },
    },
    errors,
  };
  return { runtime, capabilities, state, errors };
}

function exposeHandlersForTest(t: TestContext, globals: WebPlatformGlobalBindings): void {
  // Node-only test installation. Source bootstrap only returns typed bindings.
  for (const name of ["onerror", "onunhandledrejection", "onrejectionhandled"] as const) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() { return globals[name]; },
      set(value: object | null) { globals[name] = value; },
    });
    t.after(() => {
      if (old === undefined) delete (globalThis as Record<string, unknown>)[name];
      else Object.defineProperty(globalThis, name, old);
    });
  }
}

test("ordinary WebPlatformRuntime construction does not initialize Performance or URLPattern", (t) => {
  const { runtime } = environment(t);
  assert.throws(() => new PerformanceMark("before initialization"), /bootstrap initialization/);
  assert.throws(() => getURLPatternURLCapability(runtime), URLPatternCapabilityError);
  assert.ok(createPerformance(runtime) instanceof Performance);
});

test("global bootstrap returns canonical constructors and exactly one set of environment bindings", (t) => {
  const { runtime, capabilities } = environment(t);
  const first = runtime.bootstrapGlobals(capabilities);
  const globals = first.globals;
  assert.equal(globals.PromiseRejectionEvent, PromiseRejectionEvent);
  assert.equal(globals.Performance, Performance);
  assert.equal(globals.PerformanceEntry, PerformanceEntry);
  assert.equal(globals.PerformanceMark, PerformanceMark);
  assert.equal(globals.PerformanceMeasure, PerformanceMeasure);
  assert.equal(globals.Navigator, Navigator);
  assert.equal(globals.URLPattern, URLPattern);
  assert.ok(globals.performance instanceof Performance);
  assert.ok(globals.navigator instanceof Navigator);
  const mark = globals.performance.mark("retained", { startTime: 3 });
  assert.equal(runtime.bootstrapGlobals(capabilities), first);
  assert.equal(first.globals.performance.getEntries()[0], mark);
  assert.throws(() => runtime.bootstrapGlobals({ ...capabilities }), /already configured/);
});

test("global bootstrap refuses missing capabilities before any installation and allows a complete retry", (t) => {
  const { runtime, capabilities } = environment(t);
  for (const missing of [
    undefined,
    { ...capabilities, performance: undefined },
    { ...capabilities, performance: { ...capabilities.performance, timeOrigin: undefined } },
    { ...capabilities, performance: { ...capabilities.performance, detailCloner: undefined } },
    { ...capabilities, navigator: undefined },
    { ...capabilities, urlPattern: undefined },
    { ...capabilities, errors: undefined },
  ]) {
    assert.throws(() => runtime.bootstrapGlobals(missing as never), /all explicit provider capabilities/);
    assert.throws(() => getURLPatternURLCapability(runtime), URLPatternCapabilityError);
  }
  assert.ok(runtime.bootstrapGlobals(capabilities).globals.performance instanceof Performance);
});

test("global bootstrap refuses a nonzero Performance offset before installing anything", (t) => {
  const { runtime, capabilities } = environment(t);
  const offset = {
    ...capabilities,
    performance: { ...capabilities.performance, timeOrigin: { epochMilliseconds: 123_456, monotonicMilliseconds: 25 } },
  };
  assert.throws(() => runtime.bootstrapGlobals(offset), /runtime clock relative to the environment origin/);
  assert.throws(() => getURLPatternURLCapability(runtime), URLPatternCapabilityError);
  assert.ok(runtime.bootstrapGlobals(capabilities).globals.performance instanceof Performance);
});

test("global Event timestamps and Performance share the provider's environment-relative clock", (t) => {
  const { runtime, capabilities, state } = environment(t);
  const { globals } = runtime.bootstrapGlobals(capabilities);
  const event = new globals.PromiseRejectionEvent("sample", { promise: {} });
  assert.equal(event.timeStamp, state.now);
  assert.equal(new Event("sample").timeStamp, state.now);
  state.clockCalls = 0;
  assert.equal(globals.performance.now(), state.now);
  state.now = 200.5;
  assert.equal(globals.performance.now(), 200.5);
  assert.equal(state.clockCalls, 2);
  assert.equal(state.wallCalls, 0);
  assert.equal(globals.performance.timeOrigin, 123_456);
});

test("global bootstrap passes the explicit clone and Navigator capabilities without reading them eagerly", (t) => {
  const { runtime, capabilities, state } = environment(t);
  const { globals } = runtime.bootstrapGlobals(capabilities);
  assert.equal(state.agentReads, 0);
  assert.equal(state.clones, 0);
  assert.equal(globals.navigator.userAgent, "BootstrapFixture/1");
  state.agent = "BootstrapFixture/2";
  assert.equal(globals.navigator.userAgent, "BootstrapFixture/2");
  assert.equal(state.agentReads, 2);
  const detail = { label: "original" };
  const mark = globals.performance.mark("with detail", { detail, startTime: 1 });
  assert.deepEqual(mark.detail, detail);
  assert.notEqual(mark.detail, detail);
  assert.equal(state.clones, 1);
});

test("global bootstrap installs URLPattern's capability before constructor use and preserves refusal", (t) => {
  const { runtime, capabilities, state } = environment(t);
  const { globals } = runtime.bootstrapGlobals(capabilities);
  assert.equal(getURLPatternURLCapability(runtime), capabilities.urlPattern);
  assert.equal(new globals.URLPattern().test(), true);
  assert.throws(() => new globals.URLPattern({ pathname: "/requires-native-canonicalization" }), URLPatternCapabilityError);
  assert.ok(state.urlReads > 0);
});

test("preparing source bindings never writes the actual host globals", (t) => {
  const names = ["PromiseRejectionEvent", "Performance", "PerformanceEntry", "PerformanceMark",
    "PerformanceMeasure", "performance", "Navigator", "navigator", "URLPattern", "reportError",
    "onerror", "onunhandledrejection", "onrejectionhandled"];
  const before = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const { runtime, capabilities } = environment(t);
  runtime.bootstrapGlobals(capabilities);
  assert.deepEqual(names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name)), before);
});

test("global handler bindings forward backing slots without recursive global reads", (t) => {
  const { runtime, capabilities, errors } = environment(t);
  const { globals, hooks } = runtime.bootstrapGlobals(capabilities);
  exposeHandlersForTest(t, globals);
  const order: string[] = [];
  const reason = {};
  globals.onerror = function (message, filename, line, column, error) {
    assert.equal(this, globalThis);
    assert.deepEqual([message, filename, line, column, error], ["provider message", "provider-source.ts", 23, 7, reason]);
    order.push("handler");
    return true;
  };
  errors.invocationCleanup = () => {
    order.push("callback cleanup");
    assert.equal(errors.events[0]!.defaultPrevented, false);
  };
  hooks.reportException(reason);
  assert.deepEqual(order, ["handler", "callback cleanup"]);
  assert.equal(errors.invocations.length, 1);
  assert.equal(errors.events[0]!.defaultPrevented, true);
  assert.equal(errors.errors.length, 0);
  globals.onerror = null;
  assert.equal(globals.onerror, null);
});

test("the extracted reportError callable retains real-global receiver behavior", (t) => {
  const { runtime, capabilities, errors } = environment(t);
  const { globals } = runtime.bootstrapGlobals(capabilities);
  const reportError = globals.reportError;
  const reason = {};
  reportError(reason);
  assert.equal(errors.events.length, 1);
  assert.equal(errors.errors[0], reason);
  assert.throws(() => reportError.call({}, reason), TypeError);
  assert.throws(() => globals.reportError(reason), TypeError, "the binding holder is not the actual global");
  assert.equal(errors.events.length, 1);
});

test("native rejection and checkpoint hooks are explicit and separate from public bindings", (t) => {
  const { runtime, capabilities, errors } = environment(t);
  const { globals, hooks } = runtime.bootstrapGlobals(capabilities);
  exposeHandlersForTest(t, globals);
  const seen: string[] = [];
  const reason = {};
  const promise = errors.promise(reason);
  globals.onunhandledrejection = (event: Event) => {
    assert.ok(event instanceof globals.PromiseRejectionEvent);
    assert.equal(event.promise, promise);
    assert.equal(event.reason, reason);
    seen.push(event.type);
    return false;
  };
  globals.onrejectionhandled = (event: Event) => { seen.push(event.type); };
  hooks.hostPromiseRejectionTracker(promise, "reject");
  assert.equal(errors.events.length, 0);
  assert.equal(errors.tasks.length, 0);
  hooks.notifyRejectedPromises();
  assert.equal(errors.tasks.length, 1);
  errors.task();
  assert.deepEqual(seen, ["unhandledrejection"]);
  assert.equal(errors.rejections.length, 0);
  errors.promises.get(promise)!.handled = true;
  hooks.hostPromiseRejectionTracker(promise, "handle");
  errors.task();
  assert.deepEqual(seen, ["unhandledrejection", "rejectionhandled"]);
  assert.equal("hostPromiseRejectionTracker" in globals, false);
  assert.equal("notifyRejectedPromises" in globals, false);
});

test("captured Performance and Navigator values remain scoped to their runtime", (t) => {
  const a = environment(t);
  const first = a.runtime.bootstrapGlobals(a.capabilities);
  const b = environment(t);
  b.state.now = 800;
  b.state.agent = "OtherEnvironment/1";
  const second = b.runtime.bootstrapGlobals(b.capabilities);
  assert.notEqual(first, second);
  assert.notEqual(first.globals.performance, second.globals.performance);
  assert.notEqual(first.globals.navigator, second.globals.navigator);
  assert.equal(first.globals.performance.now(), 150.125);
  assert.equal(second.globals.performance.now(), 800);
  assert.equal(first.globals.navigator.userAgent, "BootstrapFixture/1");
  assert.equal(second.globals.navigator.userAgent, "OtherEnvironment/1");
});

test("global bootstrap does not replace an explicitly initialized Performance", (t) => {
  const { runtime, capabilities } = environment(t);
  const standalone = createPerformance(runtime, capabilities.performance);
  const mark = standalone.mark("existing", { startTime: 1 });
  assert.throws(() => runtime.bootstrapGlobals(capabilities), /Performance is already installed/);
  assert.equal(standalone.getEntries()[0], mark);
  assert.throws(() => getURLPatternURLCapability(runtime), URLPatternCapabilityError);
});

test("a closed runtime cannot bootstrap source globals", async (t) => {
  const { runtime, capabilities } = environment(t);
  await runtime.close();
  assert.throws(() => runtime.bootstrapGlobals(capabilities), /runtime is closed/);
  assert.throws(() => getURLPatternURLCapability(runtime), URLPatternCapabilityError);
});
