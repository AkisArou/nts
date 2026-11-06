// run: check
// backend: jvm
// The JVM arm of a-static-field-defined-twice: the second definition's
// initializer reads the first value through `this`, which node answers as
// "test". The control is a-static-field-defined-twice-control-on-jvm.
export { definedTwice } from "./case.js";
