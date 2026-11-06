// The control for a-class-with-two-getters-of-one-name-stops-the-build: the
// same class with only the definition that wins, the second. It compiles and
// prints "second", as node does.
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
