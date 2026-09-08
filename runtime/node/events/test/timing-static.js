"use strict";

// `EventEmitter` where the answer depends on *when* something happened.
//
// Node keeps one listener array per event and copies it before emitting, so
// upstream every question about mutation-during-emit has one implementation and
// one answer. Here the list is a class with its own copy-on-emit discipline, and
// each of these is a separate decision it could get wrong independently.
//
// The cases are the ones whose answer is not derivable from the documentation:
//
//   a listener removed *during* an emit still runs that time
//   a listener added during an emit does *not* run that time
//   `removeAllListeners` mid-emit still lets the already-copied ones run
//   `on(f); on(f); removeListener(f)` removes one, not both
//   `listeners()` returns a copy, so mutating it changes nothing
//   `newListener` fires *before* the listener is added, `removeListener` after
//   `eventNames()` keeps insertion order and mixes strings with symbols
//
// **One row is a §13 decision rather than a defect.** Node's `once` wrapper
// carries a `.listener` property pointing at the original function, so
// `rawListeners(e)[0].listener` is a function there and `undefined` here.
// `docs/conformance/typescript.md` §13 states it directly -- *"a function here
// is a C function, not an object with properties"* -- so the relationship is a
// typed record (`ListenerRecord.original`) rather than a property on a callable.
//
// It is asserted, not omitted, for the reason
// `runtime/node/buffer/test/input-forms-static.js` records: a test may pin a
// divergence that §13 declares. If §13 ever admits properties on functions, this
// row fails and says so.

const assert = require("node:assert");
const { EventEmitter } = require("node:events");

const EXPECTED = [
  ["remove-during-emit", "a,b,a"],
  ["add-during-emit", "a,a,new"],
  ["once-order", "1,2,3,2"],
  ["prepend", "c,b,a,b,a"],
  ["removeAll-during-emit", "a,b|0"],
  ["removeListener-self-twice", "1"],
  ["emit-no-listener", "false"],
  ["emit-error-no-handler", "THROW:Error"],
  ["listeners-is-copy", "1"],
  ["rawListeners-once-wrapper", "undefined"],  // §13, see the header — node gives "function"
  ["symbol-event", "1|Symbol(s)"],
  ["setMaxListeners-zero", "0"],
  ["newListener-fires-before", "new:x"],
  ["removeListener-event", "rm:x"],
  ["emit-returns", "true|false"],
  ["on-returns-this", "true"],
  ["eventNames-order", "b,a,Symbol(z)"],
];

const rows = [];
const record = (label, fn) => {
  try {
    rows.push([label, String(fn())]);
  } catch (e) {
    rows.push([label, "THROW:" + (e.code || e.constructor.name)]);
  }
};

// Removing a listener while emitting: node copies the array first, so a
// listener removed during emit still runs this time.
record("remove-during-emit", () => {
  const e = new EventEmitter();
  const seen = [];
  const b = () => seen.push("b");
  e.on("x", () => { seen.push("a"); e.removeListener("x", b); });
  e.on("x", b);
  e.emit("x");
  e.emit("x");
  return seen.join(",");
});
// Adding during emit: the new listener must NOT run this time.
record("add-during-emit", () => {
  const e = new EventEmitter();
  const seen = [];
  e.on("x", () => { seen.push("a"); e.on("x", () => seen.push("new")); });
  e.emit("x");
  e.emit("x");
  return seen.join(",");
});
// once inside emit.
record("once-order", () => {
  const e = new EventEmitter();
  const seen = [];
  e.once("x", () => seen.push("1"));
  e.on("x", () => seen.push("2"));
  e.once("x", () => seen.push("3"));
  e.emit("x");
  e.emit("x");
  return seen.join(",");
});
record("prepend", () => {
  const e = new EventEmitter();
  const seen = [];
  e.on("x", () => seen.push("a"));
  e.prependListener("x", () => seen.push("b"));
  e.prependOnceListener("x", () => seen.push("c"));
  e.emit("x");
  e.emit("x");
  return seen.join(",");
});
record("removeAll-during-emit", () => {
  const e = new EventEmitter();
  const seen = [];
  e.on("x", () => { seen.push("a"); e.removeAllListeners("x"); });
  e.on("x", () => seen.push("b"));
  e.emit("x");
  return seen.join(",") + "|" + e.listenerCount("x");
});
record("removeListener-self-twice", () => {
  const e = new EventEmitter();
  const f = () => {};
  e.on("x", f); e.on("x", f);
  e.removeListener("x", f);
  return e.listenerCount("x");
});
record("emit-no-listener", () => new EventEmitter().emit("x"));
record("emit-error-no-handler", () => new EventEmitter().emit("error", new Error("boom")));
record("listeners-is-copy", () => {
  const e = new EventEmitter();
  const f = () => {};
  e.on("x", f);
  const l = e.listeners("x");
  l.push(() => {});
  return e.listenerCount("x");
});
record("rawListeners-once-wrapper", () => {
  const e = new EventEmitter();
  e.once("x", () => {});
  const raw = e.rawListeners("x")[0];
  return typeof raw.listener;
});
record("symbol-event", () => {
  const e = new EventEmitter();
  const s = Symbol("s");
  let hit = 0;
  e.on(s, () => hit++);
  e.emit(s);
  return hit + "|" + String(e.eventNames()[0]);
});
record("setMaxListeners-zero", () => {
  const e = new EventEmitter();
  e.setMaxListeners(0);
  return e.getMaxListeners();
});
record("newListener-fires-before", () => {
  const e = new EventEmitter();
  const seen = [];
  e.on("newListener", (n) => seen.push("new:" + String(n)));
  e.on("x", () => {});
  return seen.join(",");
});
record("removeListener-event", () => {
  const e = new EventEmitter();
  const seen = [];
  const f = () => {};
  e.on("removeListener", (n) => seen.push("rm:" + String(n)));
  e.on("x", f);
  e.removeListener("x", f);
  return seen.join(",");
});
record("emit-returns", () => {
  const e = new EventEmitter();
  e.on("x", () => {});
  return String(e.emit("x")) + "|" + String(e.emit("y"));
});
record("on-returns-this", () => {
  const e = new EventEmitter();
  return String(e.on("x", () => {}) === e);
});
record("eventNames-order", () => {
  const e = new EventEmitter();
  const s = Symbol("z");
  e.on("b", () => {}); e.on("a", () => {}); e.on(s, () => {});
  return e.eventNames().map(String).join(",");
});

assert.strictEqual(rows.length, EXPECTED.length, "every case was reached");
for (let i = 0; i < EXPECTED.length; i++) {
  assert.strictEqual(rows[i][0], EXPECTED[i][0], `case ${i} label`);
  assert.strictEqual(rows[i][1], EXPECTED[i][1], rows[i][0]);
}
