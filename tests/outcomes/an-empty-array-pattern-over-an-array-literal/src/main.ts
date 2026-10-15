// run: check
// The program is `case.js`: unchecked JavaScript, as test262 is.
//
// A function whose parameter is the empty array pattern `[]`, called with an
// array literal, is invalid HIR on every backend (CallArgumentType in
// module#init). The control, tests/programs/an-elision-pattern-over-an-array,
// differs only in the pattern (`[,]`).
export { probe } from "./case.js";
