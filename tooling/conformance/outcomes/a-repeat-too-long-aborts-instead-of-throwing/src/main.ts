// **`String.prototype.repeat` past the maximum string length aborts; JavaScript
// throws a catchable `RangeError`.** `"ab".repeat(1e30)` is "Invalid string length"
// in node, and a `catch` sees it. nts's `nts_str_repeat` refuses a result longer
// than 2^32-1 with `abort()`, so the `try` below ends the process instead.
//
// The same family as the count guard 0e5676b60 fixed -- a throw the language
// makes observable, implemented as an abort. Found by the compiler lane when its
// repeat example aborted and became an eleventh partial comparison, failing a
// gate on three steps; the example was reshaped (2cf9a6ea7), and this is where
// the boundary lives now. The `fits` arm is the control on node's side; on nts
// the abort ends the program before `done()` reports anything, which is why
// the record is the abort itself. On the day the runtime throws, this flips to
// FIXED.
observe("fits", "ab".repeat(3));
let caught = "none";
try {
  "ab".repeat(1e30);
} catch (e) {
  caught = e instanceof RangeError ? "RangeError" : "other";
}
observe("too long", caught);
done();
