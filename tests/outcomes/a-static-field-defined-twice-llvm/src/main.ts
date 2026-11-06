// run: check
// backend: llvm
// The LLVM arm of a-static-field-defined-twice: the second definition's
// initializer reads the first value through `this`, which node answers as
// "test". The control is a-static-field-defined-twice-control-on-llvm.
export { definedTwice } from "./case.js";
