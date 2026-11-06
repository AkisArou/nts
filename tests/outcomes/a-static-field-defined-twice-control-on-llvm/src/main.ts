// run: check
// backend: llvm
// The control for a-static-field-defined-twice-llvm: the second field has
// another name, so nothing is defined twice. It agrees with node.
export { definedOnceEach } from "./case.js";
