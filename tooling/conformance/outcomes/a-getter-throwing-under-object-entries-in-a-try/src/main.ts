// A getter that throws, reached by Object.entries enumerating its object
// inside a `try`: the throw escapes the handler and ends the program
// ("uncaught RangeError: from the getter"), where node catches it. The
// accessor is called by the runtime's own Object.entries, not by a call this
// program writes, so no raising copy is on the path. Found by test262's
// built-ins/Object/{entries,values}/exception-during-enumeration.js, the
// only two recorded fails ending in an uncaught error other than
// Test262Error. An escape erases every arm, so the control -- the same object
// with a quiet getter -- is outcomes/object-entries-of-an-object-with-a-getter.
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
