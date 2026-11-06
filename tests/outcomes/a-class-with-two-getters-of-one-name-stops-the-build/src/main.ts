// A class body may define a getter twice: the later definition replaces the
// earlier one, so node prints "second". nts lowers both definitions as
// functions of one name, and its own verifier rejects the program
// (DuplicateFunction "C#get a"). Two plain `get a()` definitions stop the same
// way. TypeScript reports the duplicate (TS2300), so the case is plain
// JavaScript. From test262 language/computed-property-names/class/accessor/
// getter-duplicates and setter-duplicates (census of 2026-11-06 on pin
// e0395d27506b). The control, a-class-with-two-getters-of-one-name-stops-the-build-control,
// defines the getter once and agrees. The defect stops the build, so the
// control is a fixture of its own.
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
