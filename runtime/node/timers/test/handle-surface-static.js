"use strict";

// What a `Timeout` and an `Immediate` are, as objects.
//
// Node returns a real object from `setTimeout`, with `ref`, `unref`, `hasRef`
// and `refresh` that all return the handle itself so they chain. Its own tests
// check that the functions *exist*; that each returns `this` rather than
// `undefined` is what makes `setTimeout(f, 1).unref().ref()` work, and nothing
// upstream asserts it because upstream there is one implementation returning
// `this` from one place.
//
// **`Symbol.toPrimitive` is a §13 row, asserted as one.** Node's `Timeout` has
// one, so `+setTimeout(f, 0)` yields the timer id and `clearTimeout(id)` works
// on a number. `docs/conformance/typescript.md` §13 lists `Symbol.toPrimitive`
// among the "hooks that redirect built-in operations at run time", so it is
// absent here by decision. If §13 ever admits it, this row fails and says so.
//
// **Deliberately not asserted: the relative order of a timer and an immediate.**
// Node is stable across five runs — all expired timers, then the immediate. This
// profile is *not*: three runs gave two different orders, because the stand-in
// arms one host timer for the whole queue and re-arms after each drain, so a
// timer that becomes due during a drain can land after an immediate that was
// queued before it. That is a real divergence and it is recorded in
// `docs/conformance/nodejs.md` rather than pinned here, because a test that
// asserts an order this implementation does not yet guarantee is a flaky test,
// and a flaky test is worse than a documented gap.

const assert = require("node:assert");

const t = setTimeout(() => {}, 0);
assert.strictEqual(typeof t, "object", "setTimeout returns an object");
assert.strictEqual(t.hasRef(), true, "a fresh timer is referenced");
assert.strictEqual(t.unref(), t, "unref returns the handle");
assert.strictEqual(t.hasRef(), false, "unref clears the reference");
assert.strictEqual(t.ref(), t, "ref returns the handle");
assert.strictEqual(t.hasRef(), true, "ref restores the reference");
assert.strictEqual(t.refresh(), t, "refresh returns the handle");
assert.strictEqual(typeof t[Symbol.toPrimitive], "undefined", "§13: see the header");
clearTimeout(t);

const i = setImmediate(() => {});
assert.strictEqual(typeof i, "object", "setImmediate returns an object");
assert.strictEqual(i.hasRef(), true, "a fresh immediate is referenced");
assert.strictEqual(i.unref(), i, "unref returns the handle");
assert.strictEqual(i.ref(), i, "ref returns the handle");
clearImmediate(i);

// Clearing something that is not a handle is a no-op that answers `undefined`,
// not a throw. Node accepts anything here.
assert.strictEqual(clearTimeout(undefined), undefined);
assert.strictEqual(clearTimeout(1), undefined);
assert.strictEqual(clearImmediate(undefined), undefined);
assert.strictEqual(clearInterval(undefined), undefined);
