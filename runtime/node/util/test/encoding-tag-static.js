// `TextDecoder` and `TextEncoder` describe themselves, and nothing here asserted
// it.
//
// `util.TextDecoder` and `util.TextEncoder` are re-exported from the
// web-platform lane's `core/encoding.ts` rather than reimplemented, so their
// surface shape is that lane's to get right — and Web IDL requires
// `@@toStringTag` as a **data** property on the prototype, not an accessor and
// not absent. `Object.prototype.toString.call(new TextDecoder())` is
// `[object TextDecoder]` on node.
//
// None of node's pinned tests for this profile covers it: the
// `test-whatwg-encoding-*` files are not in `util`'s applicable set, so nothing
// on this side would notice the tag disappearing, changing to an accessor, or
// coming back with the wrong string. The web-platform lane found fourteen of its
// interfaces with no tag at all and twenty-one more carrying it as an accessor,
// which is the "right string, wrong shape" case that every behavioural test
// passes through unharmed.
//
// The descriptor is asserted rather than only the string, because that is the
// half a behavioural test cannot see. An accessor returning "TextDecoder" makes
// `Object.prototype.toString` answer identically and is still wrong.
//
// Constructor arity is here for the trap that came with it: these classes take
// `...args` so an omitted argument stays distinguishable from an explicit
// `undefined`, and a rest parameter makes `Function.length` zero. That is the
// correct value here — Web IDL gives both constructors only optional arguments —
// but it is correct by accident of the idiom rather than by intent, so it is
// worth pinning against the day someone writes the parameters out.
"use strict";

require("../common");

const assert = require("assert");
const util = require("util");

for (const [name, make] of [
  ["TextDecoder", () => new util.TextDecoder()],
  ["TextEncoder", () => new util.TextEncoder()],
]) {
  const Ctor = util[name];
  assert.strictEqual(typeof Ctor, "function", `util.${name} is missing`);

  // The observable answer.
  assert.strictEqual(
    Object.prototype.toString.call(make()),
    `[object ${name}]`,
    `${name} does not describe itself as a ${name}`,
  );

  // The shape behind it, which the answer above cannot distinguish.
  const descriptor = Object.getOwnPropertyDescriptor(Ctor.prototype, Symbol.toStringTag);
  assert.notStrictEqual(descriptor, undefined, `${name}.prototype has no @@toStringTag`);
  assert.strictEqual(descriptor.value, name, `${name}'s @@toStringTag is not "${name}"`);
  assert.strictEqual(
    typeof descriptor.get,
    "undefined",
    `${name}'s @@toStringTag is an accessor; Web IDL requires a data property`,
  );
  assert.strictEqual(descriptor.writable, false, `${name}'s @@toStringTag is writable`);
  assert.strictEqual(descriptor.enumerable, false, `${name}'s @@toStringTag is enumerable`);
  assert.strictEqual(descriptor.configurable, true, `${name}'s @@toStringTag is not configurable`);

  // Web IDL gives both constructors only optional arguments.
  assert.strictEqual(Ctor.length, 0, `util.${name}.length is not 0`);
}

// And they still work, so none of the above can pass on a broken class.
assert.strictEqual(
  new util.TextDecoder().decode(new util.TextEncoder().encode("café")),
  "café",
  "TextEncoder and TextDecoder do not round-trip",
);
