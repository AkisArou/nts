// `events`' exported names, and the two identities that are not names.
//
// The module compiles and publishes **zero**. Its wrapper diagnostics split
// 7 / 7: seven the backend cannot name -- `EventEmitter`,
// `EventEmitterAsyncResource` and the rest -- and seven functions that were
// never compiled. Both arms, in equal measure, in one module.
//
// It matters more here than anywhere else in the profile: `stream`, `net`,
// `http`, `readline`, `process` and `zlib` all subclass `EventEmitter`, so a
// surface that is wrong here is wrong in six other modules, and the failure
// arrives as "a listener was called 0 times" somewhere far away.
//
// `prototype-surface-static.js` beside this checks the *prototype*; this checks
// the *module*. They are different directions and neither implies the other: a
// class can be absent from the surface with a perfect prototype, and present
// with an empty one.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:events")` and `require("events")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const events = require("events");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:events")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:events"))' +
    '.map((k) => [k, typeof require("node:events")[k]]))',
);

assert.ok(
  expected.length >= 10,
  `node's events exports ${expected.length} names, too few to be real`,
);

// `init` is `EventEmitter.init`: node's own constructor-body helper, attached
// as a static so its internals can call it. Excluded, and checked before
// excluding -- it appears in no documentation, and the only pinned test that
// mentions it (`test-domain-ee.js`) does so **in a comment** and never calls it.
// Implementing it would be reproducing node's internals rather than its API,
// which is the same line the prototype test beside this draws around `_events`,
// `_eventsCount` and `_maxListeners`.
//
// By name rather than by a heuristic. There is no prefix or shape that
// separates `init` from the API around it, and a rule that guessed would
// silently stop checking a name that matters later.
const internals = new Set(["init"]);

const actual = new Set(Object.keys(events));
const missing = expected.filter((name) => !actual.has(name) && !internals.has(name));
assert.deepStrictEqual(missing, [], `events is missing name(s) node has: ${missing.join(", ")}`);

for (const name of expected) {
  if (internals.has(name)) continue;
  assert.strictEqual(
    typeof events[name],
    nodeTypes[name],
    `events.${name} is ${typeof events[name]}, node's is ${nodeTypes[name]}`,
  );
}

// **The module *is* `EventEmitter`.** `require("events") === require("events").EventEmitter`
// in node, a self-reference nothing in a key list can see. A surface that
// published the class as a separate object would satisfy every check above and
// break `class X extends require("events")`, which is how most of node's own
// code subclasses it.
assert.strictEqual(events, events.EventEmitter, "the module is not EventEmitter");

// `errorMonitor` and `captureRejectionSymbol` are **symbols**, and
// `Object.keys` cannot see either their presence or their identity. A published
// string of the same name would pass a naive check.
assert.strictEqual(typeof events.errorMonitor, "symbol");
assert.strictEqual(typeof events.captureRejectionSymbol, "symbol");
assert.notStrictEqual(events.errorMonitor, events.captureRejectionSymbol);

// And that an instance actually dispatches, so a class of the right shape and
// inert cannot pass.
const emitter = new events.EventEmitter();
let seen = 0;
emitter.on("probe", (n) => { seen += n; });
emitter.emit("probe", 2);
assert.strictEqual(seen, 2, "emit did not reach the listener");
assert.strictEqual(emitter.listenerCount("probe"), 1);

// `usingDomains` is a value, and the key comparison above only proves a name.
//
// It was supplied by `shape.mjs` until 2026-09-09, which meant the name was
// present, the value was right, and neither came from the module -- the
// compiled addon could have published anything, or nothing, and every check in
// this file would still have passed. `shape-blindspot.mjs` is what noticed;
// the class now carries `static usingDomains = false` as node does in
// `lib/events.js:222`.
//
// Node has no reason to assert any of this: on node the property cannot be
// absent, cannot hold another value, and cannot be non-writable.
assert.strictEqual(
  events.usingDomains,
  fromRealNode('require("node:events").usingDomains'),
  "usingDomains does not match node's value",
);

// Writable, because `domain` assigns `true` to it. A `readonly` field or an
// accessor without a setter satisfies the value check above and then throws or
// silently discards here.
const descriptor = Object.getOwnPropertyDescriptor(events, "usingDomains");
assert.notStrictEqual(descriptor, undefined, "usingDomains is not an own property");
assert.strictEqual(descriptor.writable, true, "usingDomains is not writable");
events.usingDomains = true;
assert.strictEqual(events.usingDomains, true, "usingDomains did not accept a write");
events.usingDomains = false;
