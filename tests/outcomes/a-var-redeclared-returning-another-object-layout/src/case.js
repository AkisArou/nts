// A `var` declared twice with object literals whose method answers objects of
// **different layouts** is one variable, typed by the first declaration: the
// checker says `o.make()` answers `{ a: number, b: string }`. The second
// literal's `make` answers `{ b: string }`, stored unchecked (JavaScript,
// `checkJs` off), and the call site reads the answer at the first layout:
// `b` is the second field there and the first here, so the read lands past
// the object it has. node: "y0"; nts: killed by SIGSEGV.
//
// The sibling outcome a-var-redeclared-at-another-function-type is the same
// store answering another *kind* (a string read as a number); this one answers
// the same kind, a reference, at another layout.
//
// The control is `sameLayout`: the same two declarations whose `make`s answer
// one layout, which agrees.
//
// **Since 2026-10-20 the second literal is refused, by name**: "a function's
// answer: the anonymous `{ b }` where the anonymous `{ a, b }` is wanted".
// The record is a guard now -- `anotherLayout` refused, `sameLayout`
// agreeing -- and a change that admits the store again shows here as a crash.

var o = { make: function () { return { a: 1, b: "x" }; } };
var o = { make: function () { return { b: "y" }; } };

var same = { make: function () { return { a: 1, b: "x" }; } };
var same = { make: function () { return { a: 2, b: "y" }; } };

/** @param {number} n @returns {string} */
export function anotherLayout(n) {
  return o.make().b + (n & 0);
}

/** @param {number} n @returns {string} */
export function sameLayout(n) {
  return same.make().b + (n & 0);
}
