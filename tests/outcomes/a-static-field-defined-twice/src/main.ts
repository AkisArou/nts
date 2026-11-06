// A class may define one static field twice: the second definition replaces
// the first, and its initializer reads the first value through `this`, so
// node answers "test262". The compiled program exits on a signal before it
// reports anything (SIGSEGV on C). From test262 static-field-redeclaration
// (language/statements and language/expressions class elements, census of
// 2026-11-06 on pin e0395d27506b: four no-verdict cases). The control,
// a-static-field-defined-twice-control, gives the second field another name
// and agrees. The defect aborts the program, so the control is a fixture of
// its own.
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
