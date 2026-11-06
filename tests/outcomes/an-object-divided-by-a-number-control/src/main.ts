// The control for an-object-divided-by-a-number: the same object, with the
// conversion `/` would make written out as a call to its `valueOf`. It
// compiles and answers 1, as node does.
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
