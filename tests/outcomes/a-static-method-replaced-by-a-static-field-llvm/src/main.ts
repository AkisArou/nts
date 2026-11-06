// run: check
// backend: llvm
// The LLVM arm of a-static-method-replaced-by-a-static-field: `methodReplaced`
// reads a static field that replaced a method of the same name, and
// `fieldFromAnotherMethod` is the control, a field set from a method with
// another name.
export { methodReplaced, fieldFromAnotherMethod } from "./case.js";
