// A getter that throws, reached by Object.entries enumerating its object
// inside a `try`: the throw escapes the handler and ends the program
// ("uncaught RangeError: from the getter"), where node catches it. The
// accessor is called by the runtime's own Object.entries, not by a call this
// program writes, so no raising copy is on the path. Found by test262's
// built-ins/Object/{entries,values}/exception-during-enumeration.js, the
// only two recorded fails ending in an uncaught error other than
// Test262Error. An escape erases every arm, so the control -- the same object
// with a quiet getter -- is outcomes/object-entries-of-an-object-with-a-getter.
//
// **A narrow gap, and why.** Of twelve runtime helpers that run program code
// (probed 2026-10-01, each its own program), the array ones -- map, forEach,
// filter, find, reduce, Array.from with a map function -- catch the throw,
// because their callbacks are lowered as call nodes. Only Object.entries and
// Object.values escape: the runtime enumerating properties calls the accessor,
// and no call node exists. Four more would be this same escape if they
// compiled, and are sound only because they refuse: JSON.stringify through
// toJSON, "abc".replace(..., fn), an object spread of a getter, and
// Object.assign from a getter source. **The day any of them lands, it
// inherits this item** -- the fix is the helper propagating a raise.
const trapped = {
  get a(): number {
    throw new RangeError("from the getter");
  },
};
let seen = "none";
try {
  Object.entries(trapped);
} catch (e) {
  seen = e instanceof RangeError ? "RangeError" : "another error";
}
observe("entries of a throwing getter", seen);
done();
