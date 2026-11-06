// run: check
// backend: jvm
// The control for a-static-field-defined-twice-jvm: the second field has
// another name, so nothing is defined twice. It agrees with node.
export { definedOnceEach } from "./case.js";
