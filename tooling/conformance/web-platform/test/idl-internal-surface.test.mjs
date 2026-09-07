// The internal machinery that is publicly reachable, pinned so it cannot grow.
//
// This test does not fix anything. It measures a deviation and stops it getting worse,
// which is the honest thing to do with a gap too large to close in passing.
//
// Web IDL says an interface prototype carries the interface's members and nothing else.
// These classes carry sixty-three more: `AbortSignal.prototype.trigger` is publicly
// callable, `ReadableStream.prototype.markDisturbed` is publicly callable, and so on.
// They are internal wiring between modules in this runtime, reachable because they are
// ordinary public methods.
//
// **Why they are not simply made private.** `#private` fields are not free here -- the
// frontier already carries refusals for properties of unrepresentable private type -- so
// "make them private" is a decision about compiler cost, not a tidy-up, and it belongs to
// whoever knows what that cost is. Until then the surface is written down.
//
// The rule this enforces: **the list may shrink, never grow.** A new public method on an
// interface prototype fails here and has to be justified, which is the same shape as the
// error taxonomy gate -- a check whose whole value is refusing to let a default happen
// quietly.
//
// The oracle is node's prototype for each interface, so the list is exactly "members this
// runtime exposes that a conformant implementation does not". Interfaces node does not
// implement are absent from the table for that reason, not because they are clean.
import assert from "node:assert/strict";
import test from "node:test";

import * as api from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);

/** Web IDL constants legitimately appear on the interface prototype object. */
const IDL_CONSTANTS = new Set([
  "NONE",
  "CAPTURING_PHASE",
  "AT_TARGET",
  "BUBBLING_PHASE",
  "CONNECTING",
  "OPEN",
  "CLOSING",
  "CLOSED",
]);

/**
 * Members this runtime exposes on an interface prototype that Web IDL does not define.
 *
 * Sixty-three of them. Shrinking this table is progress; growing it is a regression.
 */
const INTERNAL_PROTOTYPE_MEMBERS = {
  AbortSignal: [
    "addDependentSignal",
    "addSourceSignal",
    "detachFromSources",
    "markAborted",
    "markDependentsAborted",
    "observeListener",
    "reference",
    "releaseDependentSignal",
    "removeAlgorithm",
    "removeDependentSignal",
    "retainDependentSignal",
    "runAbortSteps",
    "subscribe",
    "trigger",
    "updateSourceRetention",
  ],
  Event: [
    "applyConvertedEventInit",
    "begin",
    "end",
    "initialize",
    "setPassiveListener",
    "stopped",
    "stoppedBeforeTarget",
  ],
  EventTarget: [
    "compactListeners",
    "dispatchTrustedEvent",
    "removeRecord",
    "reportError",
    "setErrorReporter",
    "setHandler",
    "setListenerObserver",
  ],
  Headers: ["isImmutable", "makeImmutable", "raw", "sorted", "writable"],
  ReadableStream: [
    "attach",
    "attachBYOB",
    "byteStream",
    "canCloseOrEnqueue",
    "cancelInternal",
    "desiredSize",
    "disturbed",
    "enqueue",
    "fail",
    "finishByteStream",
    "markDisturbed",
    "queuedSize",
    "read",
    "readInto",
    "release",
    "releaseBYOB",
    "requestClose",
  ],
  Request: ["contentType"],
  Response: ["contentType"],
  TextDecoder: ["decodeUTF16", "replacement", "resetSequence", "utf16Error"],
  WebSocket: ["closeForRuntime", "connect", "fail", "finish", "readLoop", "unregister"],
};

function internalMembers(name) {
  const mine = Object.getOwnPropertyNames(api[name].prototype).filter(
    (key) => key !== "constructor" && !IDL_CONSTANTS.has(key),
  );
  const conformant = new Set(Object.getOwnPropertyNames(globalThis[name].prototype));
  return mine.filter((key) => !conformant.has(key)).sort();
}

suite("the non-standard prototype surface is exactly what is written down", () => {
  for (const [name, expected] of Object.entries(INTERNAL_PROTOTYPE_MEMBERS)) {
    assert.equal(typeof globalThis[name], "function", `${name} needs a conformant oracle`);
    assert.deepEqual(
      internalMembers(name),
      expected,
      `${name}: this list may shrink, never grow -- see the header`,
    );
  }
});

suite("no other interface has grown one", () => {
  // The table above only lists interfaces that already deviate. This catches a *new*
  // deviation on an interface that is currently clean, which the table alone cannot.
  const clean = ["Blob", "File", "FormData", "URLSearchParams", "TextEncoder", "MessageEvent",
    "CloseEvent", "DOMException", "AbortController", "WritableStream", "TransformStream"];
  const grown = [];
  for (const name of clean) {
    if (typeof globalThis[name] !== "function" || typeof api[name] !== "function") continue;
    const extra = internalMembers(name);
    if (extra.length > 0) grown.push(`${name}: ${extra.join(" ")}`);
  }
  assert.deepEqual(grown, []);
});

suite("the count is stated, so shrinking it is visible", () => {
  const total = Object.values(INTERNAL_PROTOTYPE_MEMBERS).reduce((n, list) => n + list.length, 0);
  // Written as a number rather than derived, so that removing an entry has to change this
  // line too and cannot pass unnoticed as a no-op.
  assert.equal(total, 63);
});

suite("interface members are not enumerable, which Web IDL requires them to be", () => {
  // A second deviation, recorded rather than fixed. Web IDL gives operations
  // `{ writable: true, enumerable: true, configurable: true }` and attribute accessors
  // `{ enumerable: true, configurable: true }`; ES class members are non-enumerable, so
  // every member here is. The consequence is that `for (const k in headers)` yields
  // nothing where a conformant implementation enumerates the prototype's members.
  //
  // Not fixed in passing because a blanket pass would also enumerate the sixty-three
  // internal members above, making a second deviation worse to improve the first. The
  // two have to be closed in that order.
  const descriptor = Object.getOwnPropertyDescriptor(api.Headers.prototype, "append");
  assert.equal(descriptor.enumerable, false, "if this is true, the deviation is fixed");
  assert.equal(
    Object.getOwnPropertyDescriptor(globalThis.Headers.prototype, "append").enumerable,
    true,
    "and this is what it should be",
  );
});
