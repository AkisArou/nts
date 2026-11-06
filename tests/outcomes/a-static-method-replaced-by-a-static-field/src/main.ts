// A static field may replace a static method of the same name: static fields
// are defined after the methods, the initializer calls the method through
// `this`, and its answer replaces the method, so node reads 45. The compiled
// program keeps the method: `C.g` prints as a function. The control arm, `D`,
// sets the same field from a method with another name and agrees. Found while
// reducing test262 static-field-redeclaration (census of 2026-11-06, pin
// e0395d27506b), whose class does both this and a-static-field-defined-twice.
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
