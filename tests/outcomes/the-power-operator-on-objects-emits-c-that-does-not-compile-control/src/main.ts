// The control for the-power-operator-on-objects-emits-c-that-does-not-compile:
// the same objects, with the conversion `**` would make written out as a call
// to each one's `valueOf`. It compiles and answers 9, as node does.
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
