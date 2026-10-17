// run: check
// A case jump skips the declaration. Only the switch discriminant differs
// from the control, whose fallthrough initializes x before the same store.
export { skipped, initialized } from "./case.js";
