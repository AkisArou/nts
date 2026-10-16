// run: check
// Each var control changes only the lexical declaration kind. The let binding
// is uninitialized throughout evaluation of the loop source expression.
export { forOfHead, forOfHeadControl, forInHead, forInHeadControl } from "./case.js";
