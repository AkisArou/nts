// A `var` declared twice with object literals whose function-valued fields
// answer different types is one variable, typed by the first declaration:
// the checker says `object.valueOf` returns a number. The second literal is
// stored into that slot unchecked (JavaScript, `checkJs` off), and the call
// site unerases what the uniform entry answers as a double -- so a string
// pointer's bits are read as one. node: "10"; nts: a denormal near 4.66e-310.
// test262's ES5-era files redeclare `var object` this way throughout
// (S9.1_A1_T3 is one), which is how ToPrimitive through a field found it.
//
// The control is `sameType`: the same two declarations whose `valueOf`s
// answer one type, which agrees.
//
// **Since 2026-10-20 the second literal is refused, by name**: "a function
// answering a string where a function answering a number is wanted". The
// record is a guard now -- `redeclared` refused, `sameType` agreeing -- and a
// change that admits the store again shows here as a wrong answer.

var object = { valueOf: function () { return 1; } };
var object = { valueOf: function () { return "1"; } };

var same = { valueOf: function () { return 1; } };
var same = { valueOf: function () { return 2; } };

/** @param {number} n @returns {string} */
export function redeclared(n) {
  return String(object.valueOf() + 0) + (n & 0);
}

/** @param {number} n @returns {string} */
export function sameType(n) {
  return String(same.valueOf() + 0) + (n & 0);
}
