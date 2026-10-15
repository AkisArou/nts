// run: check
// The program is `case.js`: unchecked JavaScript, as test262 is.
//
// A generator function whose parameter is `[]`, called with an array, is
// invalid HIR on every backend (StoreType: its resume reads the parameter
// field as an array of i32 where an object is declared). The control,
// tests/programs/an-elision-pattern-of-a-generator-function, differs only in
// the pattern (`[,]`).
export { probe } from "./case.js";
