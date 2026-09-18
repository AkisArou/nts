// A module-scope `var` can be declared more than once, and each declaration is
// an assignment at the position it is written.
//
// This compiler treated the *symbol* as the unit. `collect_module_scope` gave
// each declaration its own global and pointed the symbol at the last one, so
// the earlier storage was written and never read again; and a declaration whose
// initializer folded to a constant emitted no code at all, on the grounds that
// the value was already in `Global.initial` -- which is written once, before any
// statement runs. For a second declaration that is the wrong position:
//
//   var a = 5;
//   a = 99;
//   var a = 5;   // node: 5.  this compiler, until the fix: 99
//
// Silently, on every backend, with no diagnostic. The same shape inside a
// *function* has always been right, which is why 58 differential cases over the
// function form never saw it: a function's redeclaration is one local written
// twice, and locals have no `initial` to fold into.
//
// It was found by running a test262 file about the `+` operator
// (`language/expressions/addition/S11.6.1_A2.4_T1.js`), which redeclares its
// subject partway through and never mentions redeclaration.
//
// # Why this is an example and not only a unit test
//
// The defect is a wrong *value*, not a missing function. A test that asserts the
// store exists checks the shape, and the shape was right in three of the four
// cases below -- what was wrong was which storage it named and when it ran. Only
// running the program against node separates those.

// **The store is skipped.** Both initializers fold, so before the fix neither
// declaration emitted code and `initial` carried 5 from program start -- leaving
// the assignment between them as the last write.
var a = 5;
a = 99;
var a = 5;

export function readA(): number {
  return a;
}

// **Two declarations, two values.** `deferred` is keyed by symbol and holds one
// initializer, so lowering the node from the map wrote the *last* declaration's
// value at both positions.
//
// The capture is what makes this an arm at all. An exported `readB()` returning
// `b` is called *after* module evaluation, when both node and this compiler have
// run every statement -- so both answer 2 whatever happened in between, and the
// arm agrees on a compiler that gets the order completely wrong. It did: the
// first version of this file exported two readers of `b` and they agreed on the
// broken binary. A check whose answer does not depend on what it is checking is
// not a check. Reading the value *into* a module-scope const at the position is
// what records the intermediate state for a caller to see.
var b = 1;
const bFirst = b;
var b = 2;
const bSecond = b;

export function readBFirst(): number {
  return bFirst;
}

export function readBSecond(): number {
  return bSecond;
}

// **A second declaration with no initializer leaves the value alone.** This is
// the arm that catches the duplicate *global*: before the fix this declaration
// pushed a second storage location whose `initial` was the type's zero, and
// pointed the symbol at it, so the 7 above became unreachable and `readC`
// answered 0.
var c = 7;
var c: number;

export function readC(): number {
  return c;
}

// **The case that already worked**, and it is here because a fixture whose arms
// all fail before and pass after cannot show that the fix left the working path
// alone. `d + 1` is not a constant, so this declaration was already deferred and
// already lowered from its own node.
var d = 3;
d = 41;
var d = d + 1;

export function readD(): number {
  return d;
}
