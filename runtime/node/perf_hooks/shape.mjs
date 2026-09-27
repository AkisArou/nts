// The object node's tests see as `require('perf_hooks')`, and the globals.
//
// The implementation is TypeScript classes, and four things node's tests can
// see are not class syntax: which members are enumerable (node marks the Web
// IDL attributes and operations so, as the Web does), the `Symbol.toStringTag`
// data property each interface carries, the arity of the few methods that
// take their arguments as a rest tuple so they can tell `mark()` from
// `mark(undefined)`, and the frozen `supportedEntryTypes` array. All three are function- and prototype-object metadata,
// which belongs at the host boundary rather than in the compiled
// implementation -- the same place `events/shape.mjs` sets enumerability and
// `timers/shape.mjs` sets `promisify.custom`.
//
// Applied once per module object: the prototypes are shared by every shape of
// the same exports.

const shaped = new WeakSet();

function enumerable(target, names) {
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (descriptor !== undefined) {
      Object.defineProperty(target, name, { ...descriptor, enumerable: true });
    }
  }
}

function toStringTag(target, value) {
  Object.defineProperty(target, Symbol.toStringTag, {
    configurable: true,
    enumerable: false,
    writable: false,
    value,
  });
}

function arity(fn, length) {
  Object.defineProperty(fn, "length", { configurable: true, enumerable: false, writable: false, value: length });
}

/** Node's `kEnumerableProperty` members and `toStringTag`s, interface by interface. */
function applyDescriptors(exports) {
  const {
    Performance,
    PerformanceEntry,
    PerformanceMark,
    PerformanceMeasure,
    PerformanceObserver,
    PerformanceObserverEntryList,
    PerformanceResourceTiming,
    performance,
  } = exports;

  enumerable(PerformanceEntry.prototype, ["name", "entryType", "startTime", "duration", "toJSON"]);

  for (const Class of [PerformanceMark, PerformanceMeasure]) {
    enumerable(Class.prototype, ["detail"]);
    toStringTag(Class.prototype, Class.name);
  }
  arity(PerformanceMark, 1);

  enumerable(PerformanceObserver.prototype, ["observe", "disconnect", "takeRecords"]);
  Object.freeze(PerformanceObserver.supportedEntryTypes);
  toStringTag(PerformanceObserver.prototype, "PerformanceObserver");

  enumerable(PerformanceObserverEntryList.prototype, [
    "getEntries",
    "getEntriesByType",
    "getEntriesByName",
  ]);
  arity(PerformanceObserverEntryList.prototype.getEntriesByType, 1);
  arity(PerformanceObserverEntryList.prototype.getEntriesByName, 1);
  toStringTag(PerformanceObserverEntryList.prototype, "PerformanceObserverEntryList");

  enumerable(PerformanceResourceTiming.prototype, [
    "initiatorType",
    "nextHopProtocol",
    "workerStart",
    "redirectStart",
    "redirectEnd",
    "fetchStart",
    "domainLookupStart",
    "domainLookupEnd",
    "connectStart",
    "connectEnd",
    "secureConnectionStart",
    "requestStart",
    "responseStart",
    "responseEnd",
    "transferSize",
    "encodedBodySize",
    "decodedBodySize",
    "deliveryType",
    "responseStatus",
    "toJSON",
  ]);
  toStringTag(PerformanceResourceTiming.prototype, "PerformanceResourceTiming");

  const proto = Performance.prototype;
  enumerable(proto, [
    "clearMarks",
    "clearMeasures",
    "clearResourceTimings",
    "getEntries",
    "getEntriesByName",
    "getEntriesByType",
    "mark",
    "measure",
    "now",
    "setResourceTimingBufferSize",
    "timeOrigin",
    "toJSON",
    "onresourcetimingbufferfull",
  ]);
  for (const name of ["getEntriesByName", "getEntriesByType", "mark", "measure", "setResourceTimingBufferSize"]) {
    arity(proto[name], 1);
  }
  toStringTag(proto, "Performance");
  // Node's own extensions are writable data properties holding the module's
  // values -- `performance.timerify === perf_hooks.timerify`, and a caller may
  // replace them -- and are not enumerable, being outside the Web interface.
  const nodeTiming = performance.nodeTiming;
  for (const [name, value] of [
    ["eventLoopUtilization", exports.eventLoopUtilization],
    ["nodeTiming", nodeTiming],
    ["markResourceTiming", performance.markResourceTiming],
    ["timerify", exports.timerify],
  ]) {
    Object.defineProperty(proto, name, { configurable: true, enumerable: false, writable: true, value });
  }

  // `nodeTiming`'s fields are its own properties, as node defines them, so
  // spreading it copies them: `{ ...performance.nodeTiming }` is how node's own
  // test takes a snapshot. The three constant ones are values, the rest getters
  // read live.
  const timingProto = Object.getPrototypeOf(nodeTiming);
  for (const name of ["name", "entryType", "startTime"]) {
    Object.defineProperty(nodeTiming, name, {
      configurable: true,
      enumerable: true,
      writable: false,
      value: nodeTiming[name],
    });
  }
  for (const name of [
    "duration",
    "nodeStart",
    "v8Start",
    "environment",
    "loopStart",
    "loopExit",
    "bootstrapComplete",
    "idleTime",
    "uvMetricsInfo",
  ]) {
    Object.defineProperty(nodeTiming, name, {
      configurable: true,
      enumerable: true,
      get: Object.getOwnPropertyDescriptor(timingProto, name).get,
    });
  }
}

export function shape(exports) {
  // A compiled module may publish none of this yet; guarded so each test fails
  // saying which export it wanted rather than "the module did not load".
  if (exports.performance === undefined || exports.PerformanceEntry === undefined) return {};
  if (!shaped.has(exports)) {
    shaped.add(exports);
    applyDescriptors(exports);
  }
  const module = {
    Performance: exports.Performance,
    PerformanceEntry: exports.PerformanceEntry,
    PerformanceMark: exports.PerformanceMark,
    PerformanceMeasure: exports.PerformanceMeasure,
    PerformanceObserver: exports.PerformanceObserver,
    PerformanceObserverEntryList: exports.PerformanceObserverEntryList,
    PerformanceResourceTiming: exports.PerformanceResourceTiming,
    monitorEventLoopDelay: exports.monitorEventLoopDelay,
    eventLoopUtilization: exports.eventLoopUtilization,
    timerify: exports.timerify,
    createHistogram: exports.createHistogram,
    performance: exports.performance,
  };
  Object.defineProperty(module, "constants", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: exports.constants,
  });
  return module;
}

/**
 * Replace node's `performance` and the timeline's classes with ours.
 *
 * All of them together: a mark made through our `performance` and checked
 * with node's `PerformanceEntry` would fail `instanceof` for a reason that has
 * nothing to do with the mark. `performance` is an accessor on node's global
 * object, and is replaced as one, so assigning to it still works.
 */
export function installGlobals(perfHooks) {
  if (perfHooks.performance === undefined) return;
  let performance = perfHooks.performance;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    enumerable: true,
    get: () => performance,
    set: (value) => {
      performance = value;
    },
  });
  for (const name of [
    "Performance",
    "PerformanceEntry",
    "PerformanceMark",
    "PerformanceMeasure",
    "PerformanceObserver",
    "PerformanceObserverEntryList",
    "PerformanceResourceTiming",
  ]) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: perfHooks[name],
    });
  }
}
