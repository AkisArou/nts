// expect: NTS1001 an erased value where a concrete representation is wanted
//
// `~` of an object. Until 093733f2d this emitted C that did not compile
// (`incompatible type for argument 1 of 'nts_to_int32'`) and was an outcomes
// record; since `any` is Erased and every operation on one owes its evidence,
// it refuses, and this blocker holds the refusal. Found by test262's
// expressions/bitwise-not/S11.4.8_A3_T5.js.
const o = {};
if (~o !== -1) throw new Error("~o");
